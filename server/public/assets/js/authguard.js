/* ============================================================
   auth-guard.js — include this on every page that should be
   unreachable without logging in first (index.html, every game
   page, admin.html).

   IMPORTANT — this is a stub. window.__session only lives in this
   page's memory, so on a real reload it resets to logged-out. That
   means right now the guard will bounce you to login.html every
   time you open a "protected" page directly, which is expected and
   fine while there's no backend.

   When you add a backend:
     - Real login state should come from a server-validated session
       (an httpOnly cookie the server checks), not client JS.
     - If you need a lightweight client-side flag in the meantime,
       sessionStorage.getItem("loggedIn") is the normal choice —
       just don't treat it as security, only as a UX shortcut. The
       server must still verify every request independently.
   ============================================================ */

window.__session = window.__session || { loggedIn: false, phone: null, countryCode: null };

function requireLogin() {
  if (!window.__session.loggedIn) {
    window.location.href = "login.html";
  }
}