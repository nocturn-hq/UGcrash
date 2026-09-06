/**
 * assets/js/wallet.js
 * -----------------------------------------------------------------------
 * Master BlastBet Wallet: Combines global window.wallet API, cubic ease-out 
 * counter animations, localStorage persistence, reset capabilities, and multi-tab sync.
 * -----------------------------------------------------------------------
 */
(function (global) {
  'use strict';

  const STORAGE_KEY = 'blastbet_wallet_balance';
  const DEFAULT_BALANCE = 1000;
  const EVENT_NAME = 'blastbet:wallet:change';
  const DEFAULT_COUNTRY = typeof global.DEFAULT_COUNTRY !== 'undefined' ? global.DEFAULT_COUNTRY : 'KE';

  function round8(n) {
    return Math.round((n + Number.EPSILON) * 1e8) / 1e8;
  }

  function readBalance() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return DEFAULT_BALANCE;
    const value = parseFloat(raw);
    return Number.isFinite(value) ? value : DEFAULT_BALANCE;
  }

  function writeBalance(value) {
    const rounded = round8(value);
    localStorage.setItem(STORAGE_KEY, String(rounded));
    return rounded;
  }

  // Helper: Cubic Ease-Out Counting Animation
  function animateCount(el, from, to, { duration = 700, countryCode = DEFAULT_COUNTRY, onDone } = {}) {
    if (!el) return;
    const start = performance.now();
    
    function frame(now) {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3); // Ease-out cubic
      const value = from + (to - from) * eased;
      
      if (typeof global.formatMoney === 'function') {
        el.textContent = global.formatMoney(value, countryCode);
      } else {
        el.textContent = value.toFixed(2);
      }

      if (t < 1) {
        requestAnimationFrame(frame);
      } else {
        if (typeof global.formatMoney === 'function') {
          el.textContent = global.formatMoney(to, countryCode);
        } else {
          el.textContent = to.toFixed(2);
        }
        if (onDone) onDone();
      }
    }
    requestAnimationFrame(frame);
  }

  let currentBalance = readBalance();
  let prevBalance = currentBalance;

  // Ensure storage is initialized
  if (localStorage.getItem(STORAGE_KEY) === null) {
    writeBalance(currentBalance);
  }

  const wallet = {
    getBalance() {
      return currentBalance;
    },

    hasEnough(amount) {
      return currentBalance >= (Number(amount) || 0);
    },

    /** Deducts a stake. Returns false if funds are insufficient. */
    subtract(amount) {
      amount = Number(amount) || 0;
      if (amount <= 0) return true;
      if (currentBalance < amount) return false;
      
      currentBalance = writeBalance(currentBalance - amount);
      wallet._notify(currentBalance);
      return true;
    },

    /** Credits a payout. */
    add(amount) {
      amount = Number(amount) || 0;
      if (amount < 0) return currentBalance;
      
      currentBalance = writeBalance(currentBalance + amount);
      wallet._notify(currentBalance);
      return currentBalance;
    },

    /** Resets the balance back to default (1000) for testing */
    reset() {
      currentBalance = writeBalance(DEFAULT_BALANCE);
      wallet._notify(currentBalance);
      return currentBalance;
    },

    /** Subscribe to balance changes */
    onChange(callback) {
      if (typeof callback !== 'function') return () => {};
      const handler = (e) => callback(e.detail.balance);
      document.addEventListener(EVENT_NAME, handler);
      return () => document.removeEventListener(EVENT_NAME, handler);
    },

    /** Bind a DOM element to display the animated balance automatically */
    bindDisplay(elementOrId, countryCode = DEFAULT_COUNTRY) {
      const el = typeof elementOrId === 'string' ? document.getElementById(elementOrId) : elementOrId;
      if (!el) return;

      // Initial static render
      if (typeof global.formatMoney === 'function') {
        el.textContent = global.formatMoney(readBalance(), countryCode);
      } else {
        el.textContent = readBalance().toFixed(2);
      }

      // Animate automatically whenever balance updates
      return wallet.onChange((newBalance) => {
        animateCount(el, prevBalance, newBalance, { countryCode });
      });
    },

    _notify(balance) {
      document.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { balance } }));
      document.dispatchEvent(new CustomEvent('wallet:update', { detail: { balance } }));
      prevBalance = balance;
    }
  };

  // Keep balance in sync across open tabs
  window.addEventListener('storage', (e) => {
    if (e.key !== STORAGE_KEY) return;
    currentBalance = readBalance();
    wallet._notify(currentBalance);
  });

  global.wallet = wallet;
})(window);