/* ==========================================================================
   BlastBet — Homepage logic
   Converted from Homepage.jsx (React) to vanilla JS.
   Built on theme.css: badges/buttons reuse .badge / .btn, and every
   color reference below is a var(--token) from theme.css. Cards are
   flat (no gradient background) — each game's only per-instance value
   is its --accent custom property, set on the card element for
   blastbet.css to read.
   ========================================================================== */

(function () {
  "use strict";

  function kes(n) {
    return `KES ${Math.round(n).toLocaleString("en-KE")}`;
  }

  const CATEGORIES = [
    { id: "all", label: "All games", icon: "grid-3x3" },
    { id: "originals", label: "Originals", icon: "sparkles" },
    { id: "table", label: "Table games", icon: "spade" },
    { id: "trending", label: "Trending", icon: "flame" },
  ];

  // accent values reference theme.css tokens by name, and are limited
  // to the black/white/yellow/green palette (no more per-game gradient
  // backgrounds — cards are flat now, see blastbet.css .game-card).
  const GAMES = [
    {
      id: "crash",
      name: "Crash",
      tag: "HOT",
      category: "originals",
      icon: "rocket",
      accent: "var(--amber)",
      players: 1284,
      minBet: 50,
      href: "games/crash.html",
    },
    {
      id: "aviator-x",
      name: "Aviator X",
      tag: "NEW",
      category: "originals",
      icon: "plane",
      accent: "var(--green)",
      players: 942,
      minBet: 50,
      href: "games/aviator-x.html",
      comingSoon: true,
    },
    {
      id: "mines",
      name: "Mines",
      tag: null,
      category: "originals",
      icon: "bomb",
      accent: "var(--amber)",
      players: 611,
      minBet: 20,
      href: "games/mines.html",
      comingSoon: true,
    },
    {
      id: "dice",
      name: "Dice",
      tag: null,
      category: "originals",
      icon: "dices",
      accent: "var(--green)",
      players: 503,
      minBet: 20,
      href: "games/dice.html",
      comingSoon: true,
    },
    {
      id: "plinko",
      name: "Plinko",
      tag: "HOT",
      category: "originals",
      icon: "circle-dot",
      accent: "var(--amber)",
      players: 728,
      minBet: 20,
      href: "games/plinko.html",
      comingSoon: true,
    },
    {
      id: "blackjack",
      name: "Blackjack",
      tag: null,
      category: "table",
      icon: "spade",
      accent: "var(--text)",
      players: 356,
      minBet: 100,
      href: "games/blackjack.html",
      comingSoon: true,
    },
    {
      id: "roulette",
      name: "Roulette",
      tag: null,
      category: "table",
      icon: "circle-dot",
      accent: "var(--green)",
      players: 401,
      minBet: 50,
      href: "games/roulette.html",
      comingSoon: true,
    },
    {
      id: "gem-hunt",
      name: "Gem Hunt",
      tag: "NEW",
      category: "trending",
      icon: "gem",
      accent: "var(--amber)",
      players: 289,
      minBet: 30,
      href: "#",
      comingSoon: true,
    },
  ];

  let state = {
    category: "all",
    query: "",
  };

  function icon(name, size, extraAttrs) {
    return `<i data-lucide="${name}" style="width:${size}px;height:${size}px;" ${extraAttrs || ""}></i>`;
  }

  function renderCategoryTabs() {
    const wrap = document.getElementById("categoryTabs");
    wrap.innerHTML = CATEGORIES.map((c) => {
      const active = state.category === c.id;
      return `
        <button class="category-tab${active ? " active" : ""}" data-category="${c.id}">
          ${icon(c.icon, 14)}
          ${c.label}
        </button>
      `;
    }).join("");

    wrap.querySelectorAll(".category-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.category = btn.getAttribute("data-category");
        renderCategoryTabs();
        renderGames();
      });
    });
  }

  function getFiltered() {
    return GAMES.filter((g) => {
      const inCategory = state.category === "all" || g.category === state.category;
      const inSearch = g.name.toLowerCase().includes(state.query.toLowerCase());
      return inCategory && inSearch;
    });
  }

  function gameCardHtml(game) {
    const displayTag = game.comingSoon ? "SOON" : game.tag;
    const badgeClass = displayTag === "SOON" ? "badge-amber" : "badge-green";
    const tagHtml = displayTag
      ? `<div class="game-tag-pos"><span class="badge ${badgeClass}">${
          displayTag === "HOT" ? icon("flame", 11) : ""
        }${displayTag}</span></div>`
      : "";

    const cardStyle = `--accent:${game.accent};`;
    const tagName = game.comingSoon ? "div" : "a";
    const hrefAttr = game.comingSoon ? "" : `href="${game.href}"`;

    return `
      <${tagName} class="game-card${game.comingSoon ? " is-disabled" : ""}" ${hrefAttr} style="${cardStyle}">
        ${tagHtml}
        <div class="game-icon-wrap">
          ${icon(game.icon, 52, 'stroke-width="1.6"')}
        </div>
        <div class="game-info">
          <div class="game-name">${game.name}</div>
          <div class="game-meta">
            <div class="game-players">${icon("users", 12)}${game.players.toLocaleString()}</div>
            <div class="game-minbet mono">Min ${kes(game.minBet)}</div>
          </div>
        </div>
        <div class="game-overlay">
          <button class="game-play-btn" ${game.comingSoon ? "disabled" : ""}>${game.comingSoon ? "Coming soon" : "Play now"}</button>
        </div>
      </${tagName}>
    `;
  }

  function renderGames() {
    const filtered = getFiltered();
    const grid = document.getElementById("gamesGrid");
    const empty = document.getElementById("emptyState");
    const titleEl = document.getElementById("sectionTitle");
    const countEl = document.getElementById("sectionCount");

    const catLabel = state.category === "all" ? "All games" : CATEGORIES.find((c) => c.id === state.category)?.label;
    titleEl.textContent = catLabel;
    countEl.textContent = `(${filtered.length})`;

    if (filtered.length === 0) {
      grid.style.display = "none";
      empty.style.display = "block";
      empty.textContent = `No games match "${state.query}"`;
    } else {
      empty.style.display = "none";
      grid.style.display = "grid";
      grid.innerHTML = filtered.map(gameCardHtml).join("");
    }

    if (window.lucide) window.lucide.createIcons();
  }

  function init() {
    document.getElementById("walletBalance").textContent = kes(10000);

    const searchInput = document.getElementById("searchInput");
    searchInput.addEventListener("input", (e) => {
      state.query = e.target.value;
      renderGames();
    });

    renderCategoryTabs();
    renderGames();
  }

  document.addEventListener("DOMContentLoaded", init);
})();