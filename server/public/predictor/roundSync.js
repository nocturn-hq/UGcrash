/**
 * roundSync.js
 * ----------------
 * Drop this file in as assets/js/games/roundSync.js and load it BEFORE
 * crash.js in your crash.html:
 *
 *   <script src="https://cdn.socket.io/4.7.5/socket.io.min.js"></script>
 *   <script src="../assets/js/games/roundSync.js"></script>
 *   <script src="../assets/js/games/crash.js"></script>
 *
 * This file does NOT touch your canvas drawing or sound — that's your
 * crash.js's job. Instead, it exposes a tiny event-based API so your
 * own code can react to what the server says:
 *
 *   RoundSync.on("predicting", ({ crashPoint, msRemaining }) => { ... show predictor ... })
 *   RoundSync.on("running",    ({ getMultiplier }) => { ... start animating ... })
 *   RoundSync.on("crashed",    ({ crashPoint }) => { ... show "Flew away!" ... })
 *
 * Point SERVER_URL at wherever server.js is running.
 */

// Auto-detects the server address from whatever URL the page was loaded
// from. Since both crash.html and the predictor page will be SERVED BY
// the same server.js (via express.static), this "just works" on any
// device — desktop uses localhost, phone uses your PC's LAN IP —
// without you ever having to hardcode or edit an IP address by hand.
const SERVER_URL = window.location.origin;

// This is the PREDICTOR's copy of roundSync.js — it carries the real
// secret token, so the server marks this connection as AUTHORIZED and
// sends the crash point early (during "predicting"), instead of waiting
// until "crashed" like the public game screen does.
//
// This value MUST exactly match PREDICTOR_TOKEN in server/server.js.
// Keep this out of a PUBLIC GitHub repo if you can — anyone who reads
// this file's source can extract the token and get early access too.
const AUTH_TOKEN = "change-me-secret-123";

const RoundSync = (() => {
  const listeners = { predicting: [], running: [], crashed: [] };
  let latestState = null;
  let serverClockOffsetMs = 0; // corrects for the client's clock not matching the server's

  const socket = io(SERVER_URL, { auth: { token: AUTH_TOKEN } });

  socket.on("connect", () => {
    console.log("[RoundSync] connected to server:", socket.id);
  });

  socket.on("syncState", (state) => {
    // Correct for clock drift between this device and the server, so
    // "elapsed time" calculations are accurate even if your phone's
    // clock is a few seconds off from your PC's.
    serverClockOffsetMs = state.serverNow - Date.now();
    latestState = state;
    _dispatch(state);
  });

  function _dispatch(state) {
    const now = Date.now() + serverClockOffsetMs;
    const elapsedMs = now - state.phaseStartedAt;

    if (state.phase === "predicting") {
      listeners.predicting.forEach((cb) =>
        cb({
          // crashPoint will be null here for unauthorized (public)
          // connections — the server withholds it until "crashed".
          crashPoint: state.crashPoint,
          msRemaining: Math.max(0, 5000 - elapsedMs), // matches PREDICTING_DURATION_MS
        })
      );
    } else if (state.phase === "running") {
      listeners.running.forEach((cb) =>
        cb({
          crashPoint: state.crashPoint, // still null for public here too
          elapsedMs,
          // Call this anytime to get the CURRENT correct multiplier,
          // whether you just connected mid-round or have been here
          // the whole time — same formula the server uses. This does
          // NOT depend on knowing the crash point, so it works the
          // same for public and authorized connections.
          getMultiplier: () => Math.round(Math.exp(0.06 * (elapsedMs / 1000)) * 100) / 100,
        })
      );
    } else if (state.phase === "crashed") {
      // Everyone gets the real crashPoint here — the outcome is public
      // once it's actually happened.
      listeners.crashed.forEach((cb) => cb({ crashPoint: state.crashPoint }));
    }
  }

  return {
    socket, // exposed so game-specific code (crash.js) can emit/listen for
            // events beyond round sync, e.g. socket.emit("placeBet", {...})
    on(phase, callback) {
      if (!listeners[phase]) throw new Error(`Unknown phase: ${phase}`);
      listeners[phase].push(callback);
      // If we already have state matching this phase (e.g. you just
      // registered a listener after connecting), fire it immediately
      // instead of waiting for the next server broadcast.
      if (latestState && latestState.phase === phase) _dispatch(latestState);
    },
    getLatestState: () => latestState,
  };
})();