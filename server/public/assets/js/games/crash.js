/* ==========================================================================
   BlastBet — Crash game logic (server-authoritative)
   ========================================================================== */

(function () {
  "use strict";

  const PHASE = { WAITING: "WAITING", RUNNING: "RUNNING", CRASHED: "CRASHED" };

  // UPDATED: Changed from 5 to 10 to match roundEngine.js
  const WAIT_SECONDS = 10;
  const CRASH_DISPLAY_MS = 2000;
  const GROWTH_RATE = 0.1; // matches server's roundEngine.js — real Aviator-paced climb
  const STARTING_BALANCE = 0; // Server provides real balance from users.json
  const MIN_STAKE = 10;
  const WS_URL = (location.protocol === "https:" ? "wss://" : "ws://") + location.host;

  let THEME = null;
  function readThemeColors() {
    const s = getComputedStyle(document.documentElement);
    const v = (name) => s.getPropertyValue(name).trim();
    return {
      text: v("--text"),
      textMuted: v("--text-muted"),
      green: v("--green"),
      red: v("--red"),
      amber: v("--amber"),
      blue: v("--blue"),
      purple: v("--purple"),
    };
  }

  // 🔥 UPDATED: Helper to get the User ID from the new Email/Password system
  function getCurrentUserId() {
    try {
      const user = JSON.parse(localStorage.getItem('blastbet_user'));
      return user ? user.id : null;
    } catch (e) {
      return null;
    }
  }

  // 🔥 UPDATED: Fixed, synced "Fake Odds" for everyone
  const FAKE_NAMES = ["Kai_88", "Nia_bet", "Theo_x", "Zara_99", "Milo_go", "Ana_vip", "Ravi_pro", "Luca_win", "Ines_fx", "Omar_23"];
  const FAKE_MULTIPLIERS = [2.14, 5.32, 1.87, 12.45, 3.20, 8.91, 4.55, 6.12, 7.22, 9.99];
  const FAKE_AMOUNTS = [1500, 3500, 500, 12000, 2200, 8000, 4500, 3000, 6200, 15000];
  let fakeIndex = 0;

  function fmt(n, d = 2) {
    return n.toFixed(d);
  }

  function kes(n) {
    return `KES ${Math.round(n).toLocaleString("en-KE")}`;
  }

  function crashBadgeClass(v) {
    if (v < 2) return "badge-neutral";
    if (v <= 10) return "badge-green";
    return "badge-amber";
  }

  function makeInitialBet() {
    return { amount: 10, placed: false, pending: false, cashedOut: null, autoCashout: false, autoTarget: 2.0, autoCashoutSent: false };
  }

  const sound = (function () {
    const s = { ctx: null, osc: null, gain: null, muted: false };

    function ensureCtx() {
      if (!s.ctx) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return null;
        s.ctx = new Ctx();
      }
      if (s.ctx.state === "suspended") s.ctx.resume();
      return s.ctx;
    }

    function startLaunch() {
      if (s.muted) return;
      const ctx = ensureCtx();
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sawtooth";
      osc.frequency.value = 85;
      gain.gain.value = 0;
      osc.connect(gain).connect(ctx.destination);
      gain.gain.linearRampToValueAtTime(0.05, ctx.currentTime + 0.2);
      osc.start();
      s.osc = osc;
      s.gain = gain;
    }

    function updatePitch(multiplier) {
      if (!s.osc || !s.ctx) return;
      const freq = 85 + Math.min(520, Math.log(multiplier + 1) * 230);
      s.osc.frequency.setTargetAtTime(freq, s.ctx.currentTime, 0.08);
    }

    function stopLaunch() {
      if (!s.osc || !s.ctx) return;
      const now = s.ctx.currentTime;
      s.gain.gain.cancelScheduledValues(now);
      s.gain.gain.setValueAtTime(s.gain.gain.value, now);
      s.gain.gain.linearRampToValueAtTime(0, now + 0.06);
      s.osc.stop(now + 0.08);
      s.osc = null;
      s.gain = null;
    }

    function playCrash() {
      if (s.muted) return;
      const ctx = ensureCtx();
      if (!ctx) return;
      const now = ctx.currentTime;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      osc.frequency.setValueAtTime(220, now);
      osc.frequency.exponentialRampToValueAtTime(35, now + 0.35);
      gain.gain.setValueAtTime(0.22, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.42);

      const bufferSize = Math.floor(ctx.sampleRate * 0.3);
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
      const noise = ctx.createBufferSource();
      noise.buffer = buffer;
      const noiseGain = ctx.createGain();
      noiseGain.gain.setValueAtTime(0.16, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
      noise.connect(noiseGain).connect(ctx.destination);
      noise.start(now);
    }

    function playCashout() {
      if (s.muted) return;
      const ctx = ensureCtx();
      if (!ctx) return;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(520, now);
      osc.frequency.exponentialRampToValueAtTime(1040, now + 0.18);
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.12, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.24);
    }

    function setMuted(m) {
      s.muted = m;
      if (m) stopLaunch();
    }

    return { ensureCtx, startLaunch, updatePitch, stopLaunch, playCrash, playCashout, setMuted };
  })();

  const flightCanvas = (function () {
    let canvas, ctx;
    let dpr = 1;
    let lastTip = [0, 0];
    let lastAngle = -Math.PI / 2;

    function drawRocket(x, y, angle, opts) {
      const { flame, dim, alpha = 1, scale = 1.6 } = opts;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(x, y);
      ctx.rotate(angle + Math.PI / 2);
      ctx.scale(scale, scale);

      const bodyColor = dim ? "#8a8f9c" : "#f4f6fb";
      const noseColor = dim ? "#6b707c" : THEME.amber;
      const finColor = dim ? "#5a5f6b" : THEME.amber;

      if (flame) {
        const flick = Math.sin(Date.now() / 45) * 3 + Math.sin(Date.now() / 17) * 2;
        ctx.beginPath();
        ctx.moveTo(-5, 12);
        ctx.quadraticCurveTo(0, 26 + flick, 5, 12);
        ctx.closePath();
        const outerFlame = ctx.createLinearGradient(0, 12, 0, 30);
        outerFlame.addColorStop(0, "rgba(255,176,32,0.95)");
        outerFlame.addColorStop(1, "rgba(255,77,77,0)");
        ctx.fillStyle = outerFlame;
        ctx.fill();

        ctx.beginPath();
        ctx.moveTo(-2.5, 12);
        ctx.quadraticCurveTo(0, 20 + flick * 0.6, 2.5, 12);
        ctx.closePath();
        const innerFlame = ctx.createLinearGradient(0, 12, 0, 20);
        innerFlame.addColorStop(0, "rgba(255,255,255,0.95)");
        innerFlame.addColorStop(1, "rgba(255,176,32,0.2)");
        ctx.fillStyle = innerFlame;
        ctx.fill();
      }

      [-1, 1].forEach((side) => {
        ctx.beginPath();
        ctx.moveTo(side * 5, 3);
        ctx.lineTo(side * 9, 9);
        ctx.lineTo(side * 9, 12);
        ctx.lineTo(side * 5, 8);
        ctx.closePath();
        ctx.fillStyle = finColor;
        ctx.fill();
      });

      const bodyGrad = ctx.createLinearGradient(-6, -16, 6, 10);
      bodyGrad.addColorStop(0, bodyColor);
      bodyGrad.addColorStop(1, dim ? "#4a4f5a" : "#c7ccd8");
      ctx.beginPath();
      ctx.moveTo(0, -16);
      ctx.quadraticCurveTo(6.5, -4, 6, 6);
      ctx.quadraticCurveTo(6, 9, 3, 10);
      ctx.lineTo(-3, 10);
      ctx.quadraticCurveTo(-6, 9, -6, 6);
      ctx.quadraticCurveTo(-6.5, -4, 0, -16);
      ctx.closePath();
      ctx.fillStyle = bodyGrad;
      ctx.fill();
      ctx.lineWidth = 0.6;
      ctx.strokeStyle = dim ? "rgba(0,0,0,0.3)" : "rgba(0,0,0,0.25)";
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(0, -16);
      ctx.quadraticCurveTo(3, -8, 2.6, -3);
      ctx.quadraticCurveTo(0, -5, -2.6, -3);
      ctx.quadraticCurveTo(-3, -8, 0, -16);
      ctx.closePath();
      ctx.fillStyle = noseColor;
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(-5.5, 4);
      ctx.lineTo(-11, 13);
      ctx.lineTo(-3, 9.5);
      ctx.closePath();
      ctx.fillStyle = finColor;
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(5.5, 4);
      ctx.lineTo(11, 13);
      ctx.lineTo(3, 9.5);
      ctx.closePath();
      ctx.fill();

      ctx.beginPath();
      ctx.arc(0, 0, 2.6, 0, Math.PI * 2);
      ctx.fillStyle = dim ? "#3a3f4a" : "#1b2740";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(0, 0, 2.6, 0, Math.PI * 2);
      ctx.strokeStyle = dim ? "#9a9fac" : "#8fd1ff";
      ctx.lineWidth = 0.7;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(-0.8, -0.8, 0.8, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(-6, 3);
      ctx.lineTo(6, 3);
      ctx.lineTo(6, 4.4);
      ctx.lineTo(-6, 4.4);
      ctx.closePath();
      ctx.fillStyle = noseColor;
      ctx.fill();

      ctx.restore();
    }

    function draw() {
      if (!canvas) return;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      ctx.strokeStyle = "rgba(255,255,255,0.04)";
      ctx.lineWidth = 1;
      for (let gx = 0; gx <= w; gx += w / 8) {
        ctx.beginPath();
        ctx.moveTo(gx, 0);
        ctx.lineTo(gx, h);
        ctx.stroke();
      }
      for (let gy = 0; gy <= h; gy += h / 6) {
        ctx.beginPath();
        ctx.moveTo(0, gy);
        ctx.lineTo(w, gy);
        ctx.stroke();
      }

      const phaseNow = game.phase;
      const multiplierNow = game.multiplier;

      if (phaseNow === PHASE.WAITING) return;

      const padX = Math.max(24, w * 0.04);
      const padY = Math.max(24, h * 0.08);
      const rocketScale = Math.max(1.0, Math.min(2.2, h / 190));
      const topRocketMargin = 20 * rocketScale;
      const usableW = w - padX * 2;
      const usableH = h - padY - Math.max(padY, topRocketMargin);
      const norm = Math.min(1, Math.log(Math.max(1, multiplierNow)) / Math.log(30));

      const points = [];
      const steps = 60;
      for (let i = 0; i <= steps; i++) {
        const t = (i / steps) * norm;
        const x = padX + t * usableW;
        const curveY = Math.pow(t, 1.6);
        const y = h - padY - curveY * usableH;
        points.push([x, y]);
      }

      const isCrashed = phaseNow === PHASE.CRASHED;
      const crashElapsed = isCrashed && game.crashedAt ? (Date.now() - game.crashedAt) / 1000 : 0;
      const flashPhase = isCrashed && crashElapsed < 0.18;

      const lineColor = isCrashed ? "#5a5f6b" : THEME.amber;
      const fillTop = isCrashed ? "rgba(122,127,140,0.14)" : "rgba(255,214,10,0.28)";
      const fillBottom = "rgba(255,214,10,0.0)";

      const grad = ctx.createLinearGradient(0, padY, 0, h - padY);
      grad.addColorStop(0, fillTop);
      grad.addColorStop(1, fillBottom);
      ctx.beginPath();
      ctx.moveTo(points[0][0], h - padY);
      points.forEach(([x, y]) => ctx.lineTo(x, y));
      ctx.lineTo(points[points.length - 1][0], h - padY);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(points[0][0], points[0][1]);
      points.forEach(([x, y]) => ctx.lineTo(x, y));
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 3;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.stroke();

      const [tipX, tipY] = points[points.length - 1];
      const [prevX, prevY] = points[Math.max(0, points.length - 3)];
      const travelAngle = Math.atan2(tipY - prevY, tipX - prevX);

      if (!isCrashed) {
        lastTip = [tipX, tipY];
        lastAngle = travelAngle;
        drawRocket(tipX, tipY, travelAngle, { flame: true, dim: false, scale: rocketScale });
      } else {
        const [lx, ly] = lastTip;
        const angle = lastAngle;
        const dist = 220 * crashElapsed + 260 * crashElapsed * crashElapsed;
        const ex = lx + Math.cos(angle) * dist;
        const ey = ly + Math.sin(angle) * dist;
        const alpha = Math.max(0, 1 - crashElapsed / 1.3);

        ctx.save();
        ctx.globalAlpha = alpha * 0.5;
        ctx.beginPath();
        ctx.moveTo(lx, ly);
        ctx.lineTo(ex, ey);
        ctx.strokeStyle = "#5a5f6b";
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 6]);
        ctx.stroke();
        ctx.restore();

        if (alpha > 0.02) {
          drawRocket(ex, ey, angle, { flame: crashElapsed < 0.5, dim: true, alpha, scale: rocketScale });
        }
      }

      if (flashPhase) {
        const flashAlpha = (1 - crashElapsed / 0.18) * 0.35;
        ctx.fillStyle = `rgba(255,77,77,${flashAlpha})`;
        ctx.fillRect(0, 0, w, h);
      }
    }

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = canvas.clientWidth * dpr;
      canvas.height = canvas.clientHeight * dpr;
    }

    function init(canvasEl) {
      canvas = canvasEl;
      ctx = canvas.getContext("2d");
      resize();
      const ro = new ResizeObserver(resize);
      ro.observe(canvas);

      function loop() {
        draw();
        requestAnimationFrame(loop);
      }
      requestAnimationFrame(loop);
    }

    return { init };
  })();

  const game = {
    phase: PHASE.WAITING,
    multiplier: 1.0,
    countdown: WAIT_SECONDS,
    crashedAt: 0,
    history: [],
    balance: STARTING_BALANCE,
    bets: [makeInitialBet(), makeInitialBet()],
    feed: [],
    myBetsLog: [],
    muted: false,
    sideTab: "all",
    // 🔥 UPDATED: Static leaderboard for everyone
    leaderboard: Array.from({ length: 8 }, (_, i) => ({
      name: FAKE_NAMES[i],
      amount: FAKE_AMOUNTS[i],
      multiplier: FAKE_MULTIPLIERS[i],
      result: "win",
    })).sort((a, b) => b.amount * b.multiplier - a.amount * a.multiplier),
    currentRound: null,
  };

  const el = {};

  function q(id) {
    return document.getElementById(id);
  }

  function renderWallet() {
    el.walletBalance.textContent = kes(game.balance);
  }

  function renderMute() {
    el.muteBtn.setAttribute("aria-label", game.muted ? "Unmute" : "Mute");
    el.muteBtn.innerHTML = game.muted
      ? '<i data-lucide="volume-x" style="width:16px;height:16px;"></i>'
      : '<i data-lucide="volume-2" style="width:16px;height:16px;"></i>';
    if (window.lucide) window.lucide.createIcons();
  }

  function renderHistory() {
    if (game.history.length === 0) {
      el.historyBar.innerHTML = '<span class="empty">Round history will appear here</span>';
      return;
    }
    el.historyBar.innerHTML = game.history
      .map((h) => `<div class="badge ${crashBadgeClass(h)} mono">${fmt(h)}x</div>`)
      .join("");
  }

  function renderSideList() {
    let rows = [];
    if (game.sideTab === "all") rows = game.feed;
    if (game.sideTab === "mine") rows = game.myBetsLog;
    if (game.sideTab === "top") rows = game.leaderboard;

    el.sidePanel.querySelectorAll(".side-tab").forEach((t) => {
      t.classList.toggle("active", t.getAttribute("data-tab") === game.sideTab);
    });

    if (rows.length === 0) {
      el.sideRows.innerHTML = '<div class="empty">Nothing here yet</div>';
      return;
    }

    el.sideRows.innerHTML = rows
      .map((r) => {
        const multClass = r.result === "win" ? "win" : r.result === "loss" ? "loss" : "pending";
        return `
          <div class="side-row">
            <span class="name">${r.name}</span>
            <span class="amount mono">${kes(r.amount)}</span>
            <span class="mult mono ${multClass}">${r.multiplier ? `${fmt(r.multiplier)}x` : "—"}</span>
          </div>
        `;
      })
      .join("");
  }

  function pushFeedEntry(entry) {
    game.feed = [entry, ...game.feed].slice(0, 30);
    if (game.sideTab === "all") renderSideList();
  }

  function betPanelHtml(index) {
    return `
      <div class="panel bet-panel" data-panel="${index}">
        <div class="bet-panel-header">
          <span class="label">Bet ${index + 1}</span>
          <span class="bet-status-badge badge" data-el="statusBadge"></span>
        </div>

        <div class="input-group">
          <span class="prefix">KES</span>
          <input type="number" data-el="amountInput" value="100" />
        </div>

        <div class="quick-btns">
          <button class="quick-btn" data-quick="50">+50</button>
          <button class="quick-btn" data-quick="200">+200</button>
          <button class="quick-btn" data-quick="500">+500</button>
          <button class="quick-btn" data-quick="double">2x</button>
          <button class="quick-btn" data-quick="min">Min</button>
        </div>
        <button class="quick-btn block" data-quick="max">Max</button>

        <div class="auto-cashout-row">
          <label>
            <input type="checkbox" data-el="autoCheckbox" />
            Auto cash out
          </label>
          <div class="auto-target-wrap">
            <input type="number" class="input-compact mono" step="0.1" min="1.01" data-el="autoTargetInput" value="2.0" />
            <span>x</span>
          </div>
        </div>

        <button class="btn btn-primary btn-block" data-el="placeBtn">Place bet</button>
        <button class="btn btn-cashout btn-block" data-el="cashoutBtn">
          <span>Cash out</span>
          <span class="amount mono" data-el="cashoutAmount">KES 0</span>
        </button>
      </div>
    `;
  }

  function refreshBetPanel(index) {
    const panel = document.querySelector(`.bet-panel[data-panel="${index}"]`);
    if (!panel) return;
    const bet = game.bets[index];
    const disabled = game.phase !== PHASE.WAITING;
    const isRunningAndPlaced = game.phase === PHASE.RUNNING && bet.placed && !bet.cashedOut;

    const amountInput = panel.querySelector('[data-el="amountInput"]');
    if (document.activeElement !== amountInput) amountInput.value = bet.amount;
    amountInput.disabled = disabled && !bet.placed;

    const autoCheckbox = panel.querySelector('[data-el="autoCheckbox"]');
    autoCheckbox.checked = bet.autoCashout;
    autoCheckbox.disabled = disabled && !bet.placed;

    const autoTargetInput = panel.querySelector('[data-el="autoTargetInput"]');
    if (document.activeElement !== autoTargetInput) autoTargetInput.value = bet.autoTarget;
    autoTargetInput.disabled = disabled && !bet.placed;

    panel.querySelectorAll(".quick-btn").forEach((b) => (b.disabled = disabled));

    const badge = panel.querySelector('[data-el="statusBadge"]');
    badge.classList.remove("badge-green", "badge-amber", "badge-red");
    if (bet.placed && game.phase !== PHASE.WAITING) {
      badge.style.display = "inline-flex";
      if (bet.cashedOut) {
        badge.classList.add("badge-green");
        badge.textContent = `Cashed ${fmt(bet.cashedOut)}x`;
      } else if (game.phase === PHASE.CRASHED) {
        badge.classList.add("badge-red");
        badge.textContent = "Lost";
      } else {
        badge.classList.add("badge-amber");
        badge.textContent = "In flight";
      }
    } else {
      badge.style.display = "none";
    }

    const placeBtn = panel.querySelector('[data-el="placeBtn"]');
    const cashoutBtn = panel.querySelector('[data-el="cashoutBtn"]');

    if (isRunningAndPlaced) {
      placeBtn.style.display = "none";
      cashoutBtn.style.display = "flex";
      const liveWin = bet.amount * game.multiplier;
      cashoutBtn.querySelector('[data-el="cashoutAmount"]').textContent = kes(liveWin);
    } else {
      cashoutBtn.style.display = "none";
      placeBtn.style.display = "block";
      const cannotPlace = disabled || bet.placed || bet.amount > game.balance || bet.amount < MIN_STAKE;
      placeBtn.disabled = cannotPlace;
      placeBtn.textContent = bet.placed
        ? "Bet placed — next round"
        : game.phase === PHASE.WAITING
        ? "Place bet"
        : "Betting closed";
    }
  }

  function refreshAllBetPanels() {
    refreshBetPanel(0);
    refreshBetPanel(1);
  }

  function updateLiveCashoutAmounts() {
    game.bets.forEach((bet, index) => {
      if (game.phase === PHASE.RUNNING && bet.placed && !bet.cashedOut) {
        const panel = document.querySelector(`.bet-panel[data-panel="${index}"]`);
        if (!panel) return;
        const amountEl = panel.querySelector('[data-el="cashoutAmount"]');
        if (amountEl) amountEl.textContent = kes(bet.amount * game.multiplier);
      }
    });
  }

  function setAmount(index, v) {
    const bet = game.bets[index];
    const clamped = Math.max(MIN_STAKE, Math.min(game.balance, Math.round(v)));
    bet.amount = clamped;
    refreshBetPanel(index);
  }

  function placeBet(index) {
    sound.ensureCtx();
    const bet = game.bets[index];
    if (game.phase !== PHASE.WAITING || bet.placed || bet.pending || bet.amount > game.balance || bet.amount < MIN_STAKE) return;
    bet.pending = true;
    refreshBetPanel(index);
    sendToServer({ type: "PLACE_BET", index, amount: bet.amount });
  }

  function cashOutBet(index) {
    const bet = game.bets[index];
    if (!bet.placed || bet.cashedOut || bet.pending) return;
    bet.pending = true;
    sendToServer({ type: "CASH_OUT", index });
  }

  function bindBetPanel(index) {
    const panel = document.querySelector(`.bet-panel[data-panel="${index}"]`);

    panel.querySelector('[data-el="amountInput"]').addEventListener("change", (e) => {
      setAmount(index, parseFloat(e.target.value) || 0);
    });

    panel.querySelectorAll("[data-quick]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const kind = btn.getAttribute("data-quick");
        const bet = game.bets[index];
        if (kind === "double") setAmount(index, bet.amount * 2);
        else if (kind === "min") setAmount(index, MIN_STAKE);
        else if (kind === "max") setAmount(index, game.balance);
        else setAmount(index, bet.amount + parseInt(kind, 10));
      });
    });

    panel.querySelector('[data-el="autoCheckbox"]').addEventListener("change", (e) => {
      game.bets[index].autoCashout = e.target.checked;
    });

    panel.querySelector('[data-el="autoTargetInput"]').addEventListener("change", (e) => {
      game.bets[index].autoTarget = parseFloat(e.target.value) || 1.01;
    });

    panel.querySelector('[data-el="placeBtn"]').addEventListener("click", () => placeBet(index));
    panel.querySelector('[data-el="cashoutBtn"]').addEventListener("click", () => cashOutBet(index));
  }

  function renderStage() {
    if (game.phase === PHASE.WAITING) {
      el.multiplierDisplay.style.display = "none";
      el.crashedLabel.style.display = "none";
      el.waitingBlock.style.display = "flex";
      el.statusLabel.textContent = `Round starts in ${fmt(game.countdown, 1)}s`;
      const progressPct = ((WAIT_SECONDS - game.countdown) / WAIT_SECONDS) * 100;
      el.progressFill.style.width = `${Math.min(100, Math.max(0, progressPct))}%`;
    } else if (game.phase === PHASE.RUNNING) {
      el.multiplierDisplay.style.display = "block";
      el.multiplierDisplay.classList.remove("crashed");
      el.multiplierDisplay.textContent = `${fmt(game.multiplier)}x`;
      el.crashedLabel.style.display = "none";
      el.waitingBlock.style.display = "none";
    } else {
      el.multiplierDisplay.style.display = "block";
      el.multiplierDisplay.classList.add("crashed");
      el.multiplierDisplay.textContent = `${fmt(game.multiplier)}x`;
      el.crashedLabel.style.display = "block";
      el.crashedLabel.textContent = "Flew away!";
      el.waitingBlock.style.display = "none";
    }
    refreshAllBetPanels();
  }

  function fullRender() {
    renderWallet();
    renderMute();
    renderHistory();
    renderStage();
    renderSideList();
  }

  // ✅ FIX APPLIED HERE: Force a UI refresh when bets reset to unlock buttons
  function resetForNextRound() {
    game.bets = game.bets.map((b) => ({ ...makeInitialBet(), amount: b.amount }));
    
    // FIX: The phase doesn't change (WAITING to WAITING), so tick() won't trigger fullRender().
    // We must explicitly call it to refresh the buttons immediately.
    fullRender();
  }

  function deriveDisplayState(now) {
    const r = game.currentRound;
    if (!r) {
      game.phase = PHASE.WAITING;
      game.countdown = WAIT_SECONDS;
      return;
    }

    if (r.crashPoint === null) {
      if (now < r.runStart) {
        game.phase = PHASE.WAITING;
        game.countdown = Math.max(0, (r.runStart - now) / 1000);
      } else {
        game.phase = PHASE.RUNNING;
        game.multiplier = Math.exp(((now - r.runStart) / 1000) * GROWTH_RATE);
      }
    } else {
      const roundEnd = r.crashAt + CRASH_DISPLAY_MS;
      if (now < roundEnd) {
        game.phase = PHASE.CRASHED;
        game.multiplier = r.crashPoint;
        game.crashedAt = r.crashAt;
      } else {
        game.phase = PHASE.WAITING;
        const estimatedRunStart = roundEnd + WAIT_SECONDS * 1000;
        game.countdown = Math.max(0, (estimatedRunStart - now) / 1000);
      }
    }
  }

  let lastPhase = null;

  function tick() {
    const now = Date.now();
    deriveDisplayState(now);

    if (game.phase !== lastPhase) {
      if (game.phase === PHASE.RUNNING) {
        sound.startLaunch();
        const botCount = 4 + Math.floor(Math.random() * 6);
        for (let i = 0; i < botCount; i++) {
          // 🔥 UPDATED: Uses the fixed array so everyone sees the same odds
          const currentIndex = (fakeIndex + i) % FAKE_NAMES.length;
          pushFeedEntry({
            name: FAKE_NAMES[currentIndex],
            amount: FAKE_AMOUNTS[currentIndex],
            multiplier: null,
            result: "pending",
          });
        }
        fakeIndex += botCount; // Moves to the next set of names
      } else if (game.phase === PHASE.CRASHED) {
        sound.stopLaunch();
        if (lastPhase === PHASE.RUNNING) sound.playCrash();
      }
      lastPhase = game.phase;
      fullRender();
    } else if (game.phase === PHASE.WAITING) {
      el.statusLabel.textContent = `Round starts in ${fmt(game.countdown, 1)}s`;
      const progressPct = ((WAIT_SECONDS - game.countdown) / WAIT_SECONDS) * 100;
      el.progressFill.style.width = `${Math.min(100, Math.max(0, progressPct))}%`;
    } else if (game.phase === PHASE.RUNNING) {
      game.bets.forEach((b, i) => {
        if (b.placed && !b.cashedOut && !b.pending && b.autoCashout && !b.autoCashoutSent && b.autoTarget <= game.multiplier) {
          b.autoCashoutSent = true;
          cashOutBet(i);
        }
      });
      sound.updatePitch(game.multiplier);
      el.multiplierDisplay.textContent = `${fmt(game.multiplier)}x`;
      updateLiveCashoutAmounts();
    }

    requestAnimationFrame(tick);
  }

  let liveSocket = null;

  function sendToServer(msg) {
    if (liveSocket && liveSocket.readyState === WebSocket.OPEN) {
      liveSocket.send(JSON.stringify(msg));
    }
  }

  function handleRoundStart(data) {
    const runStart = data.runStart;
    if (typeof runStart !== "number") return;

    game.currentRound = {
      idx: game.currentRound ? game.currentRound.idx + 1 : 0,
      runStart,
      crashPoint: null,
      crashAt: null,
    };
    resetForNextRound();
  }

  function handleRoundCrash(data) {
    if (!game.currentRound || game.currentRound.crashPoint !== null) return;

    const crashPoint = parseFloat(data.crashPoint);
    const crashAt = typeof data.crashAt === "number" ? data.crashAt : Date.now();

    game.currentRound.crashPoint = crashPoint;
    game.currentRound.crashAt = crashAt;

    game.history = [crashPoint, ...game.history].slice(0, 40);

    game.bets.forEach((b) => {
      if (b.placed && !b.cashedOut) {
        game.myBetsLog = [{ name: "You", amount: b.amount, multiplier: crashPoint, result: "loss" }, ...game.myBetsLog].slice(0, 30);
      }
    });
  }

  function handleWalletUpdate(data) {
    game.balance = data.balance;
    renderWallet();
    refreshAllBetPanels();
  }

  function handleBetUpdate(data) {
    data.bets.forEach((serverBet, index) => {
      const localBet = game.bets[index];
      const wasCashedOut = Boolean(localBet.cashedOut);
      localBet.pending = false;

      if (serverBet === null) {
        localBet.placed = false;
        localBet.cashedOut = null;
      } else {
        localBet.placed = true;
        const justCashedOut = serverBet.cashedOut && !wasCashedOut;
        localBet.cashedOut = serverBet.cashedOut ? serverBet.cashoutMultiplier : null;

        if (justCashedOut) {
          sound.playCashout();
          game.myBetsLog = [
            { name: "You", amount: serverBet.amount, multiplier: serverBet.cashoutMultiplier, result: "win" },
            ...game.myBetsLog,
          ].slice(0, 30);
          pushFeedEntry({ name: "You", amount: serverBet.amount, multiplier: serverBet.cashoutMultiplier, result: "win" });
          if (game.sideTab === "mine") renderSideList();
        }
      }
    });
    refreshAllBetPanels();
  }

  function handleBetRejected(data) {
    if (game.bets[data.index]) game.bets[data.index].pending = false;
    console.warn("[Bet rejected]", data.reason);
    refreshAllBetPanels();
  }

  function handleServerStatePayload(data) {
    if (!data || !data.type) return;
    if (data.type === "ROUND_START") handleRoundStart(data);
    else if (data.type === "ROUND_CRASH") handleRoundCrash(data);
    else if (data.type === "WALLET_UPDATE") handleWalletUpdate(data);
    else if (data.type === "BET_UPDATE") handleBetUpdate(data);
    else if (data.type === "BET_REJECTED") handleBetRejected(data);
  }

  // 🔥 UPDATED: Now reads userId from the new blastbet_user object
  function initGameServer() {
    const userId = getCurrentUserId(); 
    const wsUrl = userId ? `${WS_URL}?userId=${encodeURIComponent(userId)}` : WS_URL;

    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log("[GameServer] Connected to authoritative game server. User ID:", userId);
      liveSocket = ws;
      if (el.connectOverlay) el.connectOverlay.style.display = "none";
    };

    ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        handleServerStatePayload(payload);
      } catch (err) {
        console.error("[GameServer] Payload parse error:", err);
      }
    };

    ws.onclose = () => {
      liveSocket = null;
      if (el.connectOverlay) el.connectOverlay.style.display = "flex";
      // 🔥 UPDATED: Increased to 10 seconds to prevent browser inspector freezing
      setTimeout(initGameServer, 10000);
    };

    ws.onerror = () => {};

    return ws;
  }

  function init() {
    // 🔥 UPDATED: Checks the new object and redirects to open the Register modal
    if (!getCurrentUserId()) {
        window.location.href = "/index.html?openAuth=register";
        return;
    }

    THEME = readThemeColors();

    el.walletBalance = q("walletBalanceCrash");
    el.muteBtn = q("muteBtn");
    el.historyBar = q("historyBar");
    el.multiplierDisplay = q("multiplierDisplay");
    el.crashedLabel = q("crashedLabel");
    el.waitingBlock = q("waitingBlock");
    el.statusLabel = q("statusLabel");
    el.progressFill = q("progressFill");
    el.betPanels = q("betPanels");
    el.sidePanel = q("sidePanel");
    el.sideRows = q("sideRows");
    el.connectOverlay = q("connectOverlay");

    el.betPanels.innerHTML = betPanelHtml(0) + betPanelHtml(1);
    bindBetPanel(0);
    bindBetPanel(1);

    el.sidePanel.querySelectorAll(".side-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        game.sideTab = tab.getAttribute("data-tab");
        renderSideList();
      });
    });

    el.muteBtn.addEventListener("click", () => {
      game.muted = !game.muted;
      sound.setMuted(game.muted);
      renderMute();
    });

    flightCanvas.init(q("flightCanvas"));
    if (window.lucide) window.lucide.createIcons();

    initGameServer();

    fullRender();
    requestAnimationFrame(tick);
  }

  document.addEventListener("DOMContentLoaded", init);
})();