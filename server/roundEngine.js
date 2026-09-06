/**
 * roundEngine.js
 * ----------------
 * Same job as before: an infinite round loop, decided server-side,
 * with a crash point generated in advance. The timing constants here
 * are tuned to match crash.js's own constants EXACTLY, since that file
 * derives its multiplier locally from a shared growth formula — if
 * these drift apart, the visual multiplier and the real crash point
 * stop lining up.
 */

const EventEmitter = require("events");
const crypto = require("crypto");

const PHASE = {
  PREDICTING: "predicting", // matches crash.js's WAITING phase
  RUNNING: "running",
  CRASHED: "crashed",
};

// Must match crash.js's WAIT_SECONDS = 10 (changed from 5)
const PREDICTING_DURATION_MS = 10000;
// Must match crash.js's CRASH_DISPLAY_MS = 2000
const CRASHED_PAUSE_MS = 2000;
// (Growth is now defined by RATE1/KNEE/RATE2 below, replacing the old
// single GROWTH_RATE constant — see the two-stage formula.)

// Tunable knobs for how "risky" the game feels. Right now: roughly 2 in 5
// rounds crash low/fast (1.00x–1.80x, real tension), and the other 3 in 5
// are guaranteed to clear 1.80x before any chance of crashing — so it no
// longer feels like it "crashes in 1" most of the time.
const LOW_CRASH_PROBABILITY = 0.4;
const LOW_CRASH_MIN = 1.0;
const LOW_CRASH_MAX = 1.8;
const HEALTHY_ROUND_FLOOR = 1.8;

function generateCrashPoint() {
  const isLowRound = Math.random() < LOW_CRASH_PROBABILITY;

  if (isLowRound) {
    // A genuinely risky round — crashes somewhere in the low range.
    // This is what keeps the game feeling like a real crash game
    // instead of a guaranteed win every time.
    const value = LOW_CRASH_MIN + Math.random() * (LOW_CRASH_MAX - LOW_CRASH_MIN);
    return Math.round(value * 100) / 100;
  }

  // A "healthy" round — shifts the whole curve up by (floor - 1) instead
  // of clamping it. Clamping (Math.max(floor, raw)) was flattening every
  // roll that would've landed below the floor onto that exact number —
  // 27% of all rounds ended up at precisely 1.80x. Shifting preserves
  // the same shape and long tail (10x, 30x+ still possible) with no
  // pile-up: it only ever touches the floor at the single roll=0 point.
  const roll = crypto.randomInt(0, 10000) / 100;
  const raw = Math.max(1, 99 / (100 - roll));
  const value = HEALTHY_ROUND_FLOOR + (raw - 1);
  return Math.round(value * 100) / 100;
}

// Two-stage growth: normal pace up to KNEE (3.0x), then a deliberately
// gentler, slower-accelerating pace after that. A pure exponential's
// rate of change grows forever — this is what made high multipliers
// feel like they were racing, and made any small timing hiccup near
// a long round's end look like a bigger visible jump. This "locks"
// the pace down past the knee instead. Must match crash.js's and
// predictor.js's copies of this same formula EXACTLY.
const RATE1 = 0.09;
const KNEE = 3.0;
const RATE2 = 0.04;
const T_KNEE = Math.log(KNEE) / RATE1;

function multiplierAtElapsed(elapsedMs) {
  const t = elapsedMs / 1000;
  const value = t <= T_KNEE ? Math.exp(RATE1 * t) : KNEE * Math.exp(RATE2 * (t - T_KNEE));
  return Math.round(value * 100) / 100;
}

function msToReachMultiplier(target) {
  const seconds = target <= KNEE
    ? Math.log(target) / RATE1
    : T_KNEE + Math.log(target / KNEE) / RATE2;
  return seconds * 1000;
}

class RoundEngine extends EventEmitter {
  constructor() {
    super();
    this.roundId = 0;
    this.phase = PHASE.PREDICTING;
    this.crashPoint = generateCrashPoint();
    this.phaseStartedAt = Date.now();
    this._timer = null;
  }

  start() {
    this._scheduleNextPhase();
  }

  getState() {
    return {
      roundId: this.roundId,
      phase: this.phase,
      crashPoint: this.crashPoint,
      phaseStartedAt: this.phaseStartedAt,
      serverNow: Date.now(),
    };
  }

  _scheduleNextPhase() {
    clearTimeout(this._timer);

    if (this.phase === PHASE.PREDICTING) {
      this._timer = setTimeout(() => this._advanceToRunning(), PREDICTING_DURATION_MS);
    } else if (this.phase === PHASE.RUNNING) {
      const msUntilCrash = msToReachMultiplier(this.crashPoint) - (Date.now() - this.phaseStartedAt);
      this._timer = setTimeout(() => this._advanceToCrashed(), Math.max(0, msUntilCrash));
    } else if (this.phase === PHASE.CRASHED) {
      this._timer = setTimeout(() => this._advanceToPredicting(), CRASHED_PAUSE_MS);
    }
  }

  _advanceToRunning() {
    this.phase = PHASE.RUNNING;
    this.phaseStartedAt = Date.now();
    this.emit("phaseChange", this.getState());
    this._scheduleNextPhase();
  }

  _advanceToCrashed() {
    this.phase = PHASE.CRASHED;
    this.phaseStartedAt = Date.now();
    this.emit("phaseChange", this.getState());
    this._scheduleNextPhase();
  }

  _advanceToPredicting() {
    this.roundId += 1;
    this.phase = PHASE.PREDICTING;
    this.crashPoint = generateCrashPoint();
    this.phaseStartedAt = Date.now();
    this.emit("phaseChange", this.getState());
    this._scheduleNextPhase();
  }
}

module.exports = { RoundEngine, PHASE, multiplierAtElapsed, msToReachMultiplier, PREDICTING_DURATION_MS };
