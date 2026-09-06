/**
 * server.js - Advanced JSON File System Version (No MongoDB)
 * - Includes: Support Chat, Admin Logs, Withdrawals, Activity Tracking
 * - UPDATED: Admin Stats & Real-Time Support Chat Routes
 * - UPDATED: Added Unread Count Logic & Mark-Read Route
 * - FIXED: Added RoundEngine listener to broadcast ROUND_START and ROUND_CRASH
 * - FIXED: Corrected WebSocket authorization token logic
 * - FIXED: Broadcasts PREDICTION to authorized clients on every new round
 * - UPDATED: 10-Second Betting Window (PREDICTING_DURATION_MS)
 * - FIXED: Paystack deposit email retrieval (fetched from database instead of frontend)
 * - UPDATED: Persistent crash history stored in history.json
 */
require("dotenv").config();

const express = require("express");
const http = require("http");
const { WebSocketServer } = require("ws");
const url = require("url");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const helmet = require("helmet");

const { RoundEngine, multiplierAtElapsed, PREDICTING_DURATION_MS } = require("./roundEngine");
const userStore = require("./userStore");

const PORT = process.env.PORT || 3000;
const PREDICTOR_TOKEN = process.env.PREDICTOR_TOKEN || "change-me-secret-123";
const GROWTH_RATE = 0.1; 

// 🔥 File paths
const TX_FILE = path.join(__dirname, "transactions.json");
const SUPPORT_FILE = path.join(__dirname, "support_messages.json");
const LOG_FILE = path.join(__dirname, "activity_logs.json");
const WITHDRAW_FILE = path.join(__dirname, "withdrawal_requests.json");
// 🔥 NEW: History file path
const HISTORY_FILE = path.join(__dirname, "history.json");

// 🔥 Helper functions to read/write JSON
function readJSON(file) {
  if (!fs.existsSync(file)) return [];
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    return [];
  }
}

function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// 🔥 Transaction helpers
function readTransactions() { return readJSON(TX_FILE); }
function writeTransaction(tx) { const txs = readTransactions(); txs.push(tx); writeJSON(TX_FILE, txs); }
function findTransaction(ref) { return readTransactions().find(tx => tx.reference === ref); }

// 🔥 Activity Logger
function logActivity(userId, action, details = "") {
  const logs = readJSON(LOG_FILE);
  logs.push({ id: crypto.randomUUID(), userId, action, details, timestamp: new Date().toISOString() });
  writeJSON(LOG_FILE, logs);
}

// 🔥 NEW HELPER: Fetch the user's real email from the database
function getUserEmail(userId) {
    const users = userStore.getAllUsers();
    const user = users.find(u => u.id === userId);
    return user ? user.email : null;
}

// 🔥 NEW: Persistent History Functions
function readHistory() { return readJSON(HISTORY_FILE); }
function writeHistory(data) { writeJSON(HISTORY_FILE, data); }
let crashHistory = readHistory(); // Load existing history on startup!

const app = express();
const server = http.createServer(app);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

/* =========================================================
   AUTHENTICATION ROUTES
   ========================================================= */

app.post("/api/auth/register", async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "").trim();
  const name = req.body.name ? String(req.body.name).trim() : undefined;

  if (!email || !password) return res.status(400).json({ success: false, message: "Valid email and password required." });
  const result = await userStore.registerUser(email, password, name);
  if (result.success) logActivity(result.user.id, "REGISTER", email);
  res.json(result);
});

app.post("/api/auth/login", async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "").trim();

  if (!email || !password) return res.status(400).json({ success: false, message: "Email and password required." });
  const result = await userStore.loginUser(email, password);
  if (result.success) logActivity(result.user.id, "LOGIN", email);
  res.json(result);
});

/* =========================================================
   WALLET BALANCE & ROUTES
   ========================================================= */

app.get("/api/wallet/balance", async (req, res) => {
  const userId = req.query.userId;
  const balance = await userStore.getBalance(userId);
  if (balance === null) return res.status(404).json({ success: false, message: "User not found." });
  res.json({ success: true, balance });
});

app.post("/api/wallet/credit", async (req, res) => {
  const userId = String(req.body.userId || "").trim();
  const amount = Number(req.body.amount);
  const result = await userStore.updateBalance(userId, amount);
  if (result.success) logActivity(userId, "ADMIN_CREDIT", `Amount: ${amount}`);
  res.json(result);
});

// 🔥 User requests a withdrawal
app.post("/api/wallet/withdraw-request", async (req, res) => {
  const { userId, amount, method } = req.body;
  const numericAmount = Number(amount);
  
  if (!userId || isNaN(numericAmount) || numericAmount <= 0) return res.status(400).json({ success: false, message: "Invalid request." });
  if (numericAmount < 50) return res.status(400).json({ success: false, message: "Minimum withdrawal is 50." });

  const balance = await userStore.getBalance(userId);
  if (balance < numericAmount) return res.status(400).json({ success: false, message: "Insufficient balance." });

  const withdrawals = readJSON(WITHDRAW_FILE);
  withdrawals.push({ id: crypto.randomUUID(), userId, amount: numericAmount, method: method || "M-Pesa", status: "pending", date: new Date().toISOString() });
  writeJSON(WITHDRAW_FILE, withdrawals);

  await userStore.updateBalance(userId, -numericAmount);
  logActivity(userId, "WITHDRAW_REQUEST", `Amount: ${numericAmount}`);

  res.json({ success: true, message: "Withdrawal requested! You will receive it in 5 minutes." });
});

/* =========================================================
   ADMIN STATS & GRAPH DATA
   ========================================================= */

app.get("/api/admin/stats", async (req, res) => {
  const users = userStore.getAllUsers();
  const txs = readTransactions();
  const messages = readJSON(SUPPORT_FILE);
  const withdrawals = readJSON(WITHDRAW_FILE);

  const totalDeposits = txs.filter(tx => tx.type === 'deposit').reduce((sum, tx) => sum + tx.amount, 0);
  const totalPayouts = txs.filter(tx => tx.type === 'win').reduce((sum, tx) => sum + tx.amount, 0);
  const totalBets = txs.filter(tx => tx.type === 'bet').reduce((sum, tx) => sum + tx.amount, 0);
  const earnings = totalDeposits - totalPayouts;

  const today = new Date().toISOString().split('T')[0];
  const loggedToday = users.filter(u => u.lastLogin && u.lastLogin.split('T')[0] === today).length;

  const currentlyPlayingSet = global.currentlyPlayingSet || new Set();
  const currentlyPlayingIds = Array.from(currentlyPlayingSet);

  const usersData = users.map(u => ({
    id: u.id, email: u.email, name: u.name, balance: u.balance, lastLogin: u.lastLogin,
    isPlaying: currentlyPlayingIds.includes(u.id)
  }));

  const dailyStats = [];
  for (let i = 6; i >= 0; i--) {
    const date = new Date(); date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split('T')[0];
    const dayDeposits = txs.filter(tx => tx.type === 'deposit' && tx.date && tx.date.split('T')[0] === dateStr).reduce((s, tx) => s + tx.amount, 0);
    const dayPayouts = txs.filter(tx => tx.type === 'win' && tx.date && tx.date.split('T')[0] === dateStr).reduce((s, tx) => s + tx.amount, 0);
    dailyStats.push({ date: dateStr, deposits: dayDeposits, earnings: dayDeposits - dayPayouts });
  }

  res.json({
    loggedToday, totalDeposits, totalPayouts, totalBets, earnings, currentlyPlaying: currentlyPlayingIds.length,
    users: usersData, supportMessages: messages, withdrawals,
    dailyStats
  });
});

/* =========================================================
   ADMIN LOGS VIEWER
   ========================================================= */

app.get("/api/admin/logs", async (req, res) => {
  const userId = req.query.userId;
  let logs = readJSON(LOG_FILE);
  if (userId) logs = logs.filter(log => log.userId === userId);
  res.json(logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)));
});

/* =========================================================
   ADMIN WITHDRAWAL MANAGEMENT
   ========================================================= */

app.get("/api/admin/withdrawals", async (req, res) => {
  res.json(readJSON(WITHDRAW_FILE).sort((a, b) => new Date(b.date) - new Date(a.date)));
});

app.post("/api/admin/withdrawals/update", async (req, res) => {
  const { id, status } = req.body; // status = "approved" or "rejected"
  const withdrawals = readJSON(WITHDRAW_FILE);
  const index = withdrawals.findIndex(w => w.id === id);
  if (index === -1) return res.status(404).json({ success: false, message: "Withdrawal not found." });
  
  const request = withdrawals[index];
  request.status = status;
  writeJSON(WITHDRAW_FILE, withdrawals);

  if (status === "rejected") {
    await userStore.updateBalance(request.userId, request.amount); // Refund
    logActivity(request.userId, "WITHDRAW_REJECTED", `Amount: ${request.amount}`);
  } else {
    logActivity(request.userId, "WITHDRAW_APPROVED", `Amount: ${request.amount}`);
  }
  res.json({ success: true, status });
});

/* =========================================================
   SUPPORT CHAT (WHATSAPP STYLE)
   ========================================================= */

app.post("/api/support/send", async (req, res) => {
  const { userId, message } = req.body;
  if (!userId || !message) return res.status(400).json({ success: false, message: "Missing userId or message." });

  const messages = readJSON(SUPPORT_FILE);
  messages.push({ id: crypto.randomUUID(), userId, message, sender: "user", date: new Date().toISOString(), read: false });
  writeJSON(SUPPORT_FILE, messages);
  logActivity(userId, "SUPPORT_MESSAGE", message);
  res.json({ success: true });
});

app.get("/api/support/messages", async (req, res) => {
  const userId = req.query.userId;
  if (!userId) return res.status(400).json({ success: false, message: "Missing userId." });

  const messages = readJSON(SUPPORT_FILE).filter(m => m.userId === userId);
  const unreadCount = messages.filter(m => m.sender === "admin" && !m.read).length;

  res.json({ success: true, messages, hasNew: unreadCount > 0, unreadCount });
});

app.post("/api/support/mark-read", async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ success: false, message: "Missing userId." });

  const allMessages = readJSON(SUPPORT_FILE);
  let hasUpdated = false;
  allMessages.forEach(m => {
    if (m.userId === userId && m.sender === "admin" && !m.read) {
      m.read = true;
      hasUpdated = true;
    }
  });
  if (hasUpdated) writeJSON(SUPPORT_FILE, allMessages);
  
  res.json({ success: true });
});

app.get("/api/admin/support/chats", async (req, res) => {
  const messages = readJSON(SUPPORT_FILE);
  const uniqueUserIds = [...new Set(messages.map(m => m.userId))];
  const users = userStore.getAllUsers().filter(u => uniqueUserIds.includes(u.id));
  res.json(users);
});

app.post("/api/admin/support/reply", async (req, res) => {
  const { userId, message } = req.body;
  if (!userId || !message) return res.status(400).json({ success: false, message: "Missing userId or message." });

  const messages = readJSON(SUPPORT_FILE);
  messages.push({ id: crypto.randomUUID(), userId, message, sender: "admin", date: new Date().toISOString(), read: false });
  writeJSON(SUPPORT_FILE, messages);
  res.json({ success: true });
});

/* =========================================================
   PAYSTACK INTEGRATION (JSON Based)
   ========================================================= */

app.use("/api/paystack/webhook", express.raw({ type: "application/json" }));
app.post("/api/paystack/verify", async (req, res) => {
  const reference = String(req.body.reference || "").trim();
  const userId = String(req.body.userId || "").trim();
  if (!reference || !userId) return res.status(400).json({ success: false, message: "Missing reference or userId" });
  try {
    if (findTransaction(reference)) return res.status(400).json({ success: false, message: "Transaction reference already processed." });
    const paystackSecret = process.env.PAYSTACK_SECRET_KEY;
    if (!paystackSecret) return res.status(500).json({ success: false, message: "Server configuration error." });
    const response = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, { headers: { Authorization: `Bearer ${paystackSecret}` } });
    const paystackData = await response.json();
    if (paystackData.status && paystackData.data.status === "success") {
      const creditedAmount = paystackData.data.amount / 100;
      writeTransaction({ reference, userId, amount: creditedAmount, type: "deposit", status: "success", date: new Date().toISOString() });
      const updateResult = await userStore.updateBalance(userId, creditedAmount);
      logActivity(userId, "DEPOSIT", `Amount: ${creditedAmount}`);
      return res.json({ success: true, newBalance: updateResult.newBalance });
    }
    return res.status(400).json({ success: false, message: "Payment verification failed." });
  } catch (err) { res.status(500).json({ success: false, message: "Server error." }); }
});

app.post("/api/paystack/webhook", async (req, res) => {
  const paystackSecret = process.env.PAYSTACK_SECRET_KEY;
  const rawBody = req.body.toString("utf8");
  const hash = crypto.createHmac("sha512", paystackSecret).update(rawBody).digest("hex");
  if (hash !== req.headers["x-paystack-signature"]) return res.status(400).send("Invalid signature");
  const event = JSON.parse(rawBody);
  if (event && event.event === "charge.success") {
    const reference = event.data.reference;
    const amount = event.data.amount / 100;
    const userId = event.data.metadata && event.data.metadata.userId;
    if (userId && amount > 0) {
      if (!findTransaction(reference)) {
        writeTransaction({ reference, userId, amount, type: "deposit", status: "success", date: new Date().toISOString() });
        await userStore.updateBalance(userId, amount);
        logActivity(userId, "DEPOSIT", `Amount: ${amount}`);
      }
    }
  }
  res.sendStatus(200);
});

/* =========================================================
   DIRECT STK PUSH & STATUS POLLING (NO REDIRECT)
   ========================================================= */
app.post("/api/deposit", async (req, res) => {
    const { amount, phoneNumber, provider, userId } = req.body; // Removed strict email requirement
    if (!amount || !phoneNumber || !provider || !userId) return res.status(400).json({ success: false, message: "Missing required fields." });
    if (amount < 100) return res.status(400).json({ success: false, message: "Minimum deposit is KES 100." });

    // 🔥 FIX: Get the email from the backend database, NOT the frontend
    const userEmail = getUserEmail(userId);
    
    // Validate the email from the database
    if (!userEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(userEmail)) {
        return res.status(400).json({ success: false, message: "Invalid email address. Please update your profile with a valid email." });
    }

    try {
        const paystackResponse = await fetch("https://api.paystack.co/charge", {
            method: "POST", headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({ 
                email: userEmail, // Sending the validated email from DB
                amount: Math.round(amount * 100), 
                currency: "KES", 
                mobile_money: { phone: phoneNumber, provider }, 
                metadata: { userId } 
            })
        });
        const data = await paystackResponse.json();
        if (data.status) {
            if (data.data.status === 'pay_offline' || data.data.status === 'pending' || data.data.status === 'send_otp') {
                logActivity(userId, "DEPOSIT_INITIATED", `Amount: ${amount}`);
                return res.json({ success: true, message: "STK Push sent. Enter PIN.", reference: data.data.reference });
            } else { return res.status(400).json({ success: false, message: data.message || "Payment failed." }); }
        } else { return res.status(400).json({ success: false, message: data.message || "Paystack error." }); }
    } catch (error) { return res.status(500).json({ success: false, message: "Server error." }); }
});

app.post("/api/paystack-webhook", async (req, res) => { res.sendStatus(200); });
app.get("/api/payment-status/:reference", async (req, res) => { /* existing logic */ });

/* =========================================================
   WEBSOCKET & GAME ENGINE
   ========================================================= */
const wss = new WebSocketServer({ server });
const clients = new Set();
global.currentlyPlayingSet = new Set();
const engine = new RoundEngine();
engine.start();
let currentRunStart = engine.phaseStartedAt + PREDICTING_DURATION_MS;
let activeBets = [null, null];

function send(ws, msg) { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg)); }
function broadcast(msg, onlyAuthorized = false) { for (const ws of clients) { if (onlyAuthorized && !ws.authorized) continue; send(ws, msg); } }
function broadcastBets() { broadcast({ type: "BET_UPDATE", bets: activeBets }); }

// ✅ CRITICAL FIX: Listen to the engine and broadcast to ALL clients!
engine.on("phaseChange", (state) => {
    if (state.phase === "predicting") {
        currentRunStart = state.phaseStartedAt + PREDICTING_DURATION_MS;
        activeBets = [null, null]; // Reset bets for the new round
        broadcastBets();
        broadcast({ type: "ROUND_START", runStart: currentRunStart });

        // ✅ FIXED: Broadcast the new prediction to all authorized predictor clients
        const predictionData = {
            type: "PREDICTION",
            crashPoint: state.crashPoint,
            crashAt: (Math.log(state.crashPoint) / GROWTH_RATE) * 1000 + currentRunStart
        };
        for (const ws of clients) {
            if (ws.authorized) send(ws, predictionData);
        }
    } else if (state.phase === "crashed") {
        broadcast({ type: "ROUND_CRASH", crashPoint: state.crashPoint, crashAt: state.phaseStartedAt });

        // 🔥 NEW: Save crash point to persistent history
        crashHistory = [state.crashPoint, ...crashHistory].slice(0, 40); // Keep last 40
        writeHistory(crashHistory);
    }
});

wss.on("connection", async (ws, req) => {
  const { query } = url.parse(req.url, true);
  
  // FIXED: Properly check the predictor token
  ws.authorized = (query.token === PREDICTOR_TOKEN);
  
  ws.userId = query.userId ? String(query.userId).trim() : null;
  clients.add(ws);
  if (ws.userId) global.currentlyPlayingSet.add(ws.userId);

  const state = engine.getState();

  // Send the current state to the newly connected client
  if (state.phase === "predicting") {
    send(ws, { type: "ROUND_START", runStart: state.phaseStartedAt + PREDICTING_DURATION_MS });
  } else if (state.phase === "running") {
    send(ws, { type: "ROUND_START", runStart: state.phaseStartedAt });
  } else if (state.phase === "crashed") {
    send(ws, { type: "ROUND_CRASH", crashPoint: state.crashPoint, crashAt: state.phaseStartedAt });
  }

  // Send prediction only if the client sent the correct token
  if (ws.authorized && state.phase !== "crashed") {
    let crashAt = null;
    if (state.phase === "predicting") crashAt = (Math.log(state.crashPoint) / GROWTH_RATE) * 1000 + currentRunStart;
    else if (state.phase === "running") crashAt = (Math.log(state.crashPoint) / GROWTH_RATE) * 1000 + state.phaseStartedAt;
    send(ws, { type: "PREDICTION", crashPoint: state.crashPoint, crashAt });
  }

  // ✅ RESTORED: Original balance logic - NEVER automatically adds or subtracts money
  if (ws.userId) { const balance = await userStore.getBalance(ws.userId); if (balance !== null) send(ws, { type: "WALLET_UPDATE", balance }); } 
  else send(ws, { type: "WALLET_UPDATE", balance: 0 });
  
  send(ws, { type: "BET_UPDATE", bets: activeBets });
  
  // 🔥 NEW: Send persistent history to new client
  send(ws, { type: "ROUND_HISTORY", history: crashHistory });

  ws.on("message", (raw) => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    if (msg.type === "PLACE_BET") handlePlaceBet(ws, msg);
    else if (msg.type === "CASH_OUT") handleCashOut(ws, msg);
  });
  
  ws.on("close", () => { clients.delete(ws); if (ws.userId) global.currentlyPlayingSet.delete(ws.userId); });
});

async function handlePlaceBet(ws, { index, amount }) {
  const state = engine.getState(); amount = Number(amount); index = Number(index);
  if (!ws.userId) return send(ws, { type: "BET_REJECTED", index, reason: "Not logged in." });
  if (index !== 0 && index !== 1) return send(ws, { type: "BET_REJECTED", index, reason: "Invalid slot." });
  if (state.phase !== "predicting") return send(ws, { type: "BET_REJECTED", index, reason: "Betting closed." });
  if (activeBets[index]) return send(ws, { type: "BET_REJECTED", index, reason: "Slot taken." });
  const currentBalance = await userStore.getBalance(ws.userId);
  if (currentBalance === null) return send(ws, { type: "BET_REJECTED", index, reason: "User not found." });
  if (amount <= 0 || amount > currentBalance) return send(ws, { type: "BET_REJECTED", index, reason: "Invalid amount." });
  const deduct = await userStore.updateBalance(ws.userId, -amount);
  if (!deduct.success) return send(ws, { type: "BET_REJECTED", index, reason: "Failed to deduct." });

  writeTransaction({ reference: `bet_${ws.userId}_${Date.now()}`, userId: ws.userId, amount, type: "bet", status: "success", date: new Date().toISOString() });
  logActivity(ws.userId, "PLACE_BET", `Amount: ${amount}, Slot: ${index}`);
  activeBets[index] = { amount, cashedOut: false, cashoutMultiplier: null, roundId: state.roundId, userId: ws.userId };
  await broadcastWallet(ws); broadcastBets();
}

async function handleCashOut(ws, { index }) {
  const state = engine.getState(); index = Number(index); const bet = activeBets[index];
  if (!ws.userId) return send(ws, { type: "BET_REJECTED", index, reason: "Not logged in." });
  if (!bet || bet.roundId !== state.roundId) return send(ws, { type: "BET_REJECTED", index, reason: "No bet." });
  if (bet.cashedOut) return send(ws, { type: "BET_REJECTED", index, reason: "Already cashed." });
  if (state.phase !== "running") return send(ws, { type: "BET_REJECTED", index, reason: "Not running." });

  const elapsedMs = Date.now() - state.phaseStartedAt;
  const multiplier = Math.exp((elapsedMs / 1000) * GROWTH_RATE);
  if (multiplier >= state.crashPoint) return send(ws, { type: "BET_REJECTED", index, reason: "Crashed." });

  const payout = Math.round(bet.amount * multiplier);
  const credit = await userStore.updateBalance(ws.userId, payout);
  if (!credit.success) return send(ws, { type: "BET_REJECTED", index, reason: "Failed to credit." });

  writeTransaction({ reference: `win_${ws.userId}_${Date.now()}`, userId: ws.userId, amount: payout, type: "win", status: "success", date: new Date().toISOString() });
  logActivity(ws.userId, "CASH_OUT", `Amount: ${payout}, Slot: ${index}`);

  bet.cashedOut = true; bet.cashoutMultiplier = multiplier;
  await broadcastWallet(ws); broadcastBets();
}

async function broadcastWallet(ws) { if (ws && ws.userId) { const balance = await userStore.getBalance(ws.userId); if (balance !== null) send(ws, { type: "WALLET_UPDATE", balance }); } }

server.listen(PORT, "0.0.0.0", () => { console.log(`Crash server running (Advanced Mode): http://localhost:${PORT}`); });