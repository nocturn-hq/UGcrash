/**
 * predictor.js
 * ---------------- 
 * Premium version with Splash, Welcome Panel, and Background Animation.
 */

(function () {
  "use strict";

  const WAIT_SECONDS = 10;
  // Must match roundEngine.js's and crash.js's EXACT two-stage formula.
  const RATE1 = 0.09;
  const KNEE = 3.0;
  const RATE2 = 0.04;
  const T_KNEE = Math.log(KNEE) / RATE1;

  function multiplierAtElapsedSec(t) {
    return t <= T_KNEE ? Math.exp(RATE1 * t) : KNEE * Math.exp(RATE2 * (t - T_KNEE));
  }
  const PREDICTOR_TOKEN = "change-me-secret-123";
  const WS_URL = (location.protocol === "https:" ? "wss://" : "ws://") + location.host;

  // Elements
  const splashScreen = document.getElementById("splashScreen");
  const welcomePanel = document.getElementById("welcomePanel");
  const predictionScreen = document.getElementById("predictionScreen");
  const statusDot = document.getElementById("statusDot");
  const phaseLabel = document.getElementById("phaseLabel");
  const predictionValue = document.getElementById("predictionValue");
  const subLabel = document.getElementById("subLabel");
  const barFill = document.getElementById("barFill");

  // Splash Timer (20 seconds)
  setTimeout(() => {
    splashScreen.classList.add("hidden");
    welcomePanel.classList.remove("hidden");
  }, 20000);

  // Show prediction screen after clicking "Start Predicting"
  document.getElementById("startPredictingBtn").addEventListener("click", () => {
    welcomePanel.classList.add("hidden");
    predictionScreen.classList.remove("hidden");
    // Start WebSocket connection immediately after user clicks
    connect();
  });

  let round = { runStart: null, crashPoint: null, crashAt: null };

  function handleRoundStart(data) {
    round = { runStart: data.runStart, crashPoint: null, crashAt: null };
  }
  function handlePrediction(data) {
    round.crashPoint = data.crashPoint;
  }
  // FIX: this is now the ONLY place round.crashAt ever gets set — driven
  // purely by the server's real, authoritative message. Previously,
  // render() also guessed its own crash time from a formula, which drifted
  // from the server's actual setTimeout firing by enough to visibly crash
  // "before" the real game did. One source of truth, no more guessing.
  function handleRoundCrash(data) {
    round.crashPoint = data.crashPoint;
    round.crashAt = data.crashAt;
  }

  function connect() {
    const ws = new WebSocket(`${WS_URL}?token=${encodeURIComponent(PREDICTOR_TOKEN)}`);

    ws.onopen = () => statusDot.classList.add("connected");
    ws.onclose = () => {
      statusDot.classList.remove("connected");
      setTimeout(connect, 1500);
    };
    ws.onerror = () => {};

    ws.onmessage = (event) => {
      let data;
      try { data = JSON.parse(event.data); } catch { return; }
      if (data.type === "ROUND_START") handleRoundStart(data);
      else if (data.type === "PREDICTION") handlePrediction(data);
      else if (data.type === "ROUND_CRASH") handleRoundCrash(data);
    };
  }

  function render() {
    const now = Date.now();

    if (round.crashAt !== null) {
      phaseLabel.textContent = "Crashed at";
      predictionValue.textContent = `${round.crashPoint.toFixed(2)}x`;
      predictionValue.className = "prediction crashed";
      subLabel.textContent = "Next prediction in a moment…";
      barFill.style.width = "0%";
    } else if (round.runStart !== null && now < round.runStart) {
      phaseLabel.textContent = "Predicted crash point";
      predictionValue.textContent = round.crashPoint !== null ? `${round.crashPoint.toFixed(2)}x` : "--.--x";
      predictionValue.className = "prediction predicting";
      const msRemaining = round.runStart - now;
      subLabel.textContent = `Launching in ${(msRemaining / 1000).toFixed(1)}s`;
      const pct = 100 - (msRemaining / (WAIT_SECONDS * 1000)) * 100;
      barFill.style.width = `${Math.min(100, Math.max(0, pct))}%`;
      barFill.style.background = "#ffb020";
    } else if (round.runStart !== null) {
      // FIX: no more self-predicted crash detection here. This branch now
      // ONLY displays the live climbing multiplier — it never decides on
      // its own that the round has crashed. That decision comes exclusively
      // from the real ROUND_CRASH message via handleRoundCrash() above,
      // which is what keeps this in perfect sync with the actual game.
      const elapsedSec = (now - round.runStart) / 1000;
      const liveMultiplier = multiplierAtElapsedSec(elapsedSec);

      phaseLabel.textContent = "Live — will crash at";
      predictionValue.textContent = round.crashPoint !== null ? `${round.crashPoint.toFixed(2)}x` : "--.--x";
      predictionValue.className = "prediction running";
      subLabel.textContent = `Currently at ${liveMultiplier.toFixed(2)}x`;
      barFill.style.width = "100%";
      barFill.style.background = "#4ade80";
    } else {
      phaseLabel.textContent = "Connecting…";
      predictionValue.textContent = "--.--x";
      subLabel.textContent = "Syncing live round…";
    }

    requestAnimationFrame(render);
  }

  // Background Particle Animation
  const canvas = document.getElementById("bgCanvas");
  const ctx = canvas.getContext("2d");
  let particles = [];

  function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  window.addEventListener("resize", resizeCanvas);
  resizeCanvas();

  function createParticles() {
    const num = 50;
    for (let i = 0; i < num; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        size: Math.random() * 4 + 1,
        speedX: (Math.random() - 0.5) * 1.5,
        speedY: (Math.random() - 0.5) * 1.5,
      });
    }
  }

  function drawParticles() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles.forEach(p => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
      ctx.fill();
      p.x += p.speedX;
      p.y += p.speedY;
      if (p.x < 0 || p.x > canvas.width) p.speedX *= -1;
      if (p.y < 0 || p.y > canvas.height) p.speedY *= -1;
    });
    requestAnimationFrame(drawParticles);
  }

  createParticles();
  drawParticles();
  render();

  // Initialize Lucide Icons
  if (window.lucide) window.lucide.createIcons();
})();
