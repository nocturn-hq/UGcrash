/* ============================================================
   currency.js — country -> currency mapping.
   Used by signup.html (to preview currency as the player picks
   a country) and by wallet.js (to format every balance/payout).
   Add more countries here as you expand markets.
   ============================================================ */

const CURRENCY_BY_COUNTRY = {
  KE: { name: "Kenya", code: "KES", symbol: "KSh" },
  TZ: { name: "Tanzania", code: "TZS", symbol: "TSh" },
  UG: { name: "Uganda", code: "UGX", symbol: "USh" },
  NG: { name: "Nigeria", code: "NGN", symbol: "\u20A6" },
  GH: { name: "Ghana", code: "GHS", symbol: "GH\u20B5" },
  ZA: { name: "South Africa", code: "ZAR", symbol: "R" },
  ZM: { name: "Zambia", code: "ZMW", symbol: "ZK" },
  RW: { name: "Rwanda", code: "RWF", symbol: "FRw" },
  US: { name: "United States", code: "USD", symbol: "$" },
  GB: { name: "United Kingdom", code: "GBP", symbol: "\u00A3" },
};

const DEFAULT_COUNTRY = "KE";

function getCurrency(countryCode) {
  return CURRENCY_BY_COUNTRY[countryCode] || CURRENCY_BY_COUNTRY[DEFAULT_COUNTRY];
}

// Formats a number as "KES 1,234" style text for the given country.
function formatMoney(amount, countryCode) {
  const currency = getCurrency(countryCode);
  const rounded = Math.round(amount).toLocaleString("en-US");
  return `${currency.code} ${rounded}`;
}

// Populates a <select> with every supported country.
function populateCountrySelect(selectEl) {
  Object.entries(CURRENCY_BY_COUNTRY).forEach(([code, info]) => {
    const opt = document.createElement("option");
    opt.value = code;
    opt.textContent = info.name;
    if (code === DEFAULT_COUNTRY) opt.selected = true;
    selectEl.appendChild(opt);
  });
}