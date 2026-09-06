/* ==========================================================================
   BlastBet — Crash game logic (server-authoritative)
   ========================================================================== */

(function () {
  "use strict";

  const PHASE = { WAITING: "WAITING", RUNNING: "RUNNING", CRASHED: "CRASHED" };

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

  function getCurrentUserId() {
    try {
      const user = JSON.parse(localStorage.getItem('blastbet_user'));
      return user ? user.id : null;
    } catch (e) {
      return null;
    }
  }

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

  /* ------------------------------------------------------------------
     SOUND — replaced entirely. Instead of per-event stingers (launch
     whoosh, crash bang, cashout chime), this is one gentle, continuous
     ambient loop: a soft pad chord plus a slow, quiet pulse — like a
     calm background beat, not a reactive sound effect. It starts on
     the first user interaction (browsers block audio before that) and
     just keeps looping regardless of round phase.
     ------------------------------------------------------------------ */
  const sound = (function () {
    const s = { ctx: null, muted: false, playing: false, padNodes: [], pulseTimer: null };

    function ensureCtx() {
      if (!s.ctx) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return null;
        s.ctx = new Ctx();
      }
      if (s.ctx.state === "suspended") s.ctx.resume();
      return s.ctx;
    }

    // A soft, slowly-shifting pad — two detuned sine tones a fifth
    // apart, very quiet, with a slow filter sweep so it breathes
    // instead of droning flatly.
    function startPad() {
      const ctx = s.ctx;
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 900;
      filter.connect(ctx.destination);

      const freqs = [110, 164.81]; // A2 and E3 — a calm, open fifth
      freqs.forEach((f, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = f;
        gain.gain.value = 0;
        osc.connect(gain).connect(filter);
        osc.start();
        gain.gain.linearRampToValueAtTime(0.035, ctx.currentTime + 2);
        s.padNodes.push({ osc, gain });
      });

      // slow, gentle filter sweep so the pad feels alive, not static
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      lfo.frequency.value = 0.05;
      lfoGain.gain.value = 250;
      lfo.connect(lfoGain).connect(filter.frequency);
      lfo.start();
      s.padNodes.push({ osc: lfo, gain: lfoGain });
      s.padFilter = filter;
    }

    // A very soft, slow pulse underneath the pad — like a gentle
    // heartbeat, not a percussive beat. Schedules itself repeatedly.
    function schedulePulse() {
      if (!s.playing || s.muted) return;
      const ctx = s.ctx;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = 110;
      gain.gain.value = 0;
      osc.connect(gain).connect(ctx.destination);
      const now = ctx.currentTime;
      gain.gain.linearRampToValueAtTime(0.05, now + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
      osc.start(now);
      osc.stop(now + 0.55);

      s.pulseTimer = setTimeout(schedulePulse, 1400);
    }

    function startMusic() {
      if (s.playing || s.muted) return;
      const ctx = ensureCtx();
      if (!ctx) return;
      s.playing = true;
      startPad();
      schedulePulse();
    }

    function stopMusic() {
      s.playing = false;
      clearTimeout(s.pulseTimer);
      if (s.ctx) {
        const now = s.ctx.currentTime;
        s.padNodes.forEach(({ osc, gain }) => {
          try {
            gain.gain.linearRampToValueAtTime(0, now + 0.4);
            osc.stop(now + 0.5);
          } catch (e) {}
        });
      }
      s.padNodes = [];
    }

    function setMuted(m) {
      s.muted = m;
      if (m) stopMusic();
      else startMusic();
    }

    return { ensureCtx, startMusic, stopMusic, setMuted };
  })();

  const flightCanvas = (function () {
    let canvas, ctx;
    let dpr = 1;
    let lastAnchor = [0, 0];
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
      // Smaller reference height specifically shrinks the rocket on
      // compact/mobile stages (h <= 260) without touching the desktop
      // scale at all (that branch is unchanged from before).
      const rocketScale = h <= 260
        ? Math.max(0.6, h / 320)
        : Math.max(1.0, Math.min(2.2, h / 190));

      const isCrashed = phaseNow === PHASE.CRASHED;

      // ------------------------------------------------------------------
      // The rocket now holds a FIXED screen position (roughly center)
      // while RUNNING, with a gentle float/bob — it no longer travels
      // toward an edge as the multiplier grows. Only at the moment of
      // CRASHED does it actually depart, launching from this same
      // comfortable center point instead of wherever a far-traveled
      // position used to be — which is also what was causing it to
      // visually "get stuck" in a corner on big multipliers before.
      // ------------------------------------------------------------------
      // ------------------------------------------------------------------
      // TWO-PHASE MOTION:
      // Phase 1 (launch, ~1.4s of real elapsed time): the rocket actually
      // travels from the bottom-left up to the center anchor point, at a
      // visible, eased "medium speed" pace — not an instant jump.
      // Phase 2 (float): once it arrives, it holds at the anchor with a
      // gentle bob for the rest of the flight, however high the
      // multiplier climbs, so it never travels toward an edge.
      // ------------------------------------------------------------------
      const LAUNCH_DURATION_SEC = 1.4;
      // Recovers real elapsed seconds from the multiplier formula itself
      // (multiplier = e^(rate*t)) — no extra state needs to be tracked.
      const elapsedSec = Math.log(Math.max(1, multiplierNow)) / GROWTH_RATE;
      const launchProgress = Math.min(1, elapsedSec / LAUNCH_DURATION_SEC);
      // Ease-out cubic: quick at first, smoothly decelerating into place —
      // this is the "medium speed, then settles" feel.
      const eased = 1 - Math.pow(1 - launchProgress, 3);

      const anchorX = w * 0.46;
      const anchorY = h * 0.5;
      const bobAmount = 5 * (rocketScale / 1.6);
      // Bob fades in as it arrives, rather than bobbing while still
      // traveling toward the anchor.
      const bob = isCrashed ? 0 : Math.sin(Date.now() / 480) * bobAmount * eased;

      const launchStartX = padX;
      const launchStartY = h - padY; // bottom-left of the usable stage

      const rocketX = isCrashed ? lastAnchor[0] : launchStartX + (anchorX - launchStartX) * eased;
      const rocketY = isCrashed ? lastAnchor[1] : launchStartY + (anchorY + bob - launchStartY) * eased;

      // The line's endpoint is now ALSO fixed at the rocket's anchor —
      // only its curvature (how sharply it bends) grows with the
      // multiplier, giving the impression of climbing without the
      // endpoint ever moving toward an edge.
      const bendAmount = Math.min(1, Math.log(Math.max(1, multiplierNow)) / Math.log(30));
      const startX = padX;
      const startY = h - padY;
      const cpX = startX + (rocketX - startX) * 0.5;
      const cpY = startY - bendAmount * (startY - rocketY) * 1.25;

      const points = [];
      const steps = 40;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const x = (1 - t) * (1 - t) * startX + 2 * (1 - t) * t * cpX + t * t * rocketX;
        const y = (1 - t) * (1 - t) * startY + 2 * (1 - t) * t * cpY + t * t * rocketY;
        points.push([x, y]);
      }

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
        lastAnchor = [rocketX, rocketY];
        lastAngle = travelAngle;
        drawRocket(rocketX, rocketY, travelAngle, { flame: true, dim: false, scale: rocketScale });
      } else {
        const [lx, ly] = lastAnchor;
        const angle = lastAngle;
        const crashElapsed = game.crashedAt ? (Date.now() - game.crashedAt) / 1000 : 0;
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

      // Red crash flash — kept on desktop for impact, removed on mobile
      // per request (w matches the CSS's own 480px mobile breakpoint).
      const crashElapsedForFlash = isCrashed && game.crashedAt ? (Date.now() - game.crashedAt) / 1000 : 0;
      const flashPhase = isCrashed && crashElapsedForFlash < 0.18 && w > 480;
      if (flashPhase) {
        const flashAlpha = (1 - crashElapsedForFlash / 0.18) * 0.35;
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
    sound.startMusic();
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

  function resetForNextRound() {
    game.bets = game.bets.map((b) => ({ ...makeInitialBet(), amount: b.amount }));
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
        const botCount = 4 + Math.floor(Math.random() * 6);
        for (let i = 0; i < botCount; i++) {
          const currentIndex = (fakeIndex + i) % FAKE_NAMES.length;
          pushFeedEntry({
            name: FAKE_NAMES[currentIndex],
            amount: FAKE_AMOUNTS[currentIndex],
            multiplier: null,
            result: "pending",
          });
        }
        fakeIndex += botCount;
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

    // Local fallback so history still shows something today. Once
    // server.js sends a HISTORY_UPDATE message (next file to update),
    // handleHistoryUpdate below will overwrite this with the real,
    // synced-across-devices list — this local push just covers the
    // gap until that server change is deployed.
    game.history = [crashPoint, ...game.history].slice(0, 40);

    game.bets.forEach((b) => {
      if (b.placed && !b.cashedOut) {
        game.myBetsLog = [{ name: "You", amount: b.amount, multiplier: crashPoint, result: "loss" }, ...game.myBetsLog].slice(0, 30);
      }
    });
  }

  // NEW: handles the synced history list once server.js is updated to
  // send it. Overwrites the local-fallback list above with the real,
  // server-authoritative one so every device shows the same history,
  // persisted across reconnects instead of resetting per-tab.
  function handleHistoryUpdate(data) {
    if (!Array.isArray(data.history)) return;
    game.history = data.history;
    renderHistory();
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
    else if (data.type === "HISTORY_UPDATE") handleHistoryUpdate(data);
  }

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
      setTimeout(initGameServer, 1500);
    };

    ws.onerror = () => {};

    return ws;
  }

  function init() {
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
