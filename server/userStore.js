const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");

const USERS_FILE = path.join(__dirname, "users.json");

// Helper to read users
function readUsers() {
  if (!fs.existsSync(USERS_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
  } catch (err) {
    console.error("Error reading users.json:", err);
    return [];
  }
}

// Helper to write users
function writeUsers(users) {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
  } catch (err) {
    console.error("Error writing users.json:", err);
  }
}

module.exports = {
  // 🔥 UPDATED: Uses Email instead of Phone
  async registerUser(email, password, name = "Player") {
    // Basic validation
    if (!email || !password || password.length < 6) {
      return { success: false, message: "Email and password (min 6 chars) are required" };
    }

    // Load users
    const users = readUsers();

    // Check existing
    const existing = users.find(u => u.email === email);
    if (existing) return { success: false, message: "Email already registered" };

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Create new user (uses random UUID instead of Mongo's _id)
    const newUser = {
      id: crypto.randomUUID(),
      email,
      password: hashedPassword, 
      name,
      balance: 0,
      lastLogin: new Date().toISOString() // ✅ Tracks the registration date as first login
    };

    users.push(newUser);
    writeUsers(users);

    return {
      success: true,
      user: { id: newUser.id, email: newUser.email, name: newUser.name, balance: newUser.balance }
    };
  },

  // 🔥 UPDATED: Uses Email instead of Phone
  async loginUser(email, password) {
    const users = readUsers();
    const user = users.find(u => u.email === email);

    // Check user exists
    if (!user) return { success: false, message: "Invalid email or password" };

    // Compare password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return { success: false, message: "Invalid email or password" };

    // ✅ Update the last login date so Admin Panel knows who is active today
    user.lastLogin = new Date().toISOString();
    writeUsers(users);

    return {
      success: true,
      user: { id: user.id, email: user.email, name: user.name, balance: user.balance }
    };
  },

  async getBalance(userId) {
    const users = readUsers();
    const user = users.find(u => u.id === userId);

    if (!user) return null; // User not found
    return user.balance;
  },

  async updateBalance(userId, amount) {
    // Validate amount
    const numAmount = Number(amount);
    if (isNaN(numAmount) || numAmount === 0) {
      return { success: false, message: "Invalid amount provided" };
    }

    const users = readUsers();
    const userIndex = users.findIndex(u => u.id === userId);

    if (userIndex === -1) {
      return { success: false, message: "User not found" };
    }

    const user = users[userIndex];

    // Check for negative balance (same logic as $gte)
    if (user.balance + numAmount < 0) {
      return { success: false, message: "Insufficient balance" };
    }

    // Update balance
    user.balance += numAmount;
    writeUsers(users);

    return { success: true, newBalance: user.balance };
  },

  // ✅ NEW: Get all users for the admin panel
  getAllUsers() {
    return readUsers();
  }
};