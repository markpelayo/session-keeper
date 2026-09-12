// Shared site definitions. Loaded by content.js and popup.js.
//
// IMPORTANT — how the interval ceilings were chosen:
//
//   QuickBooks Online: signs you out after an idle period that the Master Admin
//   sets to 1, 2 or 3 hours. Even the 1-hour floor gives huge headroom, so the
//   10-minute ceiling here is comfortable.
//
//   Xero: TWO clocks. A ~10-minute inactivity prompt driven by mouse/keyboard
//   input, and a hard 60-minute session cap that Xero does not let you change.
//   The nudge interval must therefore stay meaningfully UNDER 10 minutes or the
//   "are you still there?" prompt appears — hence a max of 8, not 10.
//   The 60-minute cap is handled separately by the keepalive fetch.

const SITE_DEFS = {
  qbo: {
    label: 'QuickBooks Online',
    hostPattern: /(^|\.)intuit\.com$/i,
    urlGlob: 'https://*.intuit.com/*',
    // Strategy: synthetic activity events only.
    useEvents: true,
    useKeepaliveFetch: false,
    defaultRange: '5-8',
    ranges: {
      '2-5':  { label: '2–5 minutes',  min: 2,  max: 5  },
      '5-8':  { label: '5–8 minutes',  min: 5,  max: 8  },
      '8-10': { label: '8–10 minutes', min: 8,  max: 10 }
    },
    ceilingNote: 'Sign-out is 1–3 hours, so anything here is well inside the limit.'
  },
  xero: {
    label: 'Xero',
    hostPattern: /(^|\.)xero\.com$/i,
    urlGlob: 'https://*.xero.com/*',
    // Strategy: synthetic events for the 10-min prompt, PLUS a silent
    // same-origin fetch to reset the 60-min server session clock.
    useEvents: true,
    useKeepaliveFetch: true,
    // Fetch on every Nth nudge. At a 3–6 min range that lands every ~9–18 min,
    // comfortably inside the 60-minute cap without hammering the server.
    fetchEveryNthNudge: 3,
    defaultRange: '3-6',
    ranges: {
      '2-4': { label: '2–4 minutes', min: 2, max: 4 },
      '3-6': { label: '3–6 minutes', min: 3, max: 6 },
      '5-8': { label: '5–8 minutes', min: 5, max: 8 }
    },
    ceilingNote: 'Capped at 8 min — Xero prompts at ~10 min of no input.'
  }
};

function siteIdForHost(host) {
  for (const [id, def] of Object.entries(SITE_DEFS)) {
    if (def.hostPattern.test(host)) return id;
  }
  return null;
}

function defaultSettings() {
  const s = {};
  for (const [id, def] of Object.entries(SITE_DEFS)) {
    s[id] = { enabled: true, range: def.defaultRange };
  }
  return s;
}

if (typeof module !== 'undefined') module.exports = { SITE_DEFS, siteIdForHost, defaultSettings };
