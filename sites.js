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
    // Scoped to the QBO app itself, NOT all of intuit.com. Previously this
    // matched *.intuit.com, so it also ran on ProAdvisor pages, Intuit account
    // pages and so on — which both wasted nudges and let an unrelated tab
    // poison this site's shared stats.
    hostPattern: /(^|\.)qbo\.intuit\.com$/i,
    urlGlob: 'https://*.qbo.intuit.com/*',
    extraGlobs: ['https://qbo.intuit.com/*'],
    // Strategy: activity events + keepalive fetch + idle-dialog dismissal.
    //
    // Confirmed in the field (2026-09-16): QBO shows its own "Are you still
    // working?" dialog and does NOT count synthetic pointer/key events as
    // activity — almost certainly because they carry isTrusted: false. So the
    // event layer is kept (harmless, may still help) but is no longer relied on.
    useEvents: true,
    useKeepaliveFetch: true,
    fetchEveryNthNudge: 2,
    defaultRange: '2-5',
    idleDialog: {
      // ALL THREE must match before anything is clicked.
      match: /are you still working|haven'?t been active|still there\?/i,
      // Bare "Continue" is deliberately NOT accepted here: QBO's button is
      // labelled "Continue working", so allowing the generic word would only
      // widen the blast radius for no benefit.
      confirmText: /^(continue working|keep working|i'?m still (here|working)|stay signed in)$/i,
      denyText: /sign ?out|log ?out|cancel|no,?\s/i
    },
    ranges: {
      '2-5':  { label: '2–5 minutes',  min: 2,  max: 5  },
      '5-8':  { label: '5–8 minutes',  min: 5,  max: 8  },
      '8-10': { label: '8–10 minutes', min: 8,  max: 10 },
      // Widest band: runs right up towards the sign-out limit. Assumes the
      // shortest possible QBO setting (1 hour); 50 leaves a 10-minute buffer
      // for Chrome's background-timer throttling, which can delay a tick by
      // several minutes on a backgrounded tab.
      '3-50': {
        label: '3–50 minutes (max)', min: 3, max: 50,
        warn: 'Assumes your QBO sign-out is set to 1 hour or more. If you shortened it, pick a narrower range.'
      }
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
    defaultRange: '5-8',
    idleDialog: {
      match: /are you still (there|working)|haven'?t been active|session.{0,20}(expire|time ?out)/i,
      confirmText: /^(continue|continue working|keep working|stay signed in|i'?m still (here|working)|yes,? ?keep me signed in)$/i,
      denyText: /sign ?out|log ?out|cancel|no,?\s/i
    },
    ranges: {
      '2-4': { label: '2–4 minutes', min: 2, max: 4 },
      '3-6': { label: '3–6 minutes', min: 3, max: 6 },
      '5-8': { label: '5–8 minutes', min: 5, max: 8 },
      // Widest band Xero allows. The ceiling here is the ~10-minute inactivity
      // prompt, NOT the 60-minute sign-out — so there is only 1 minute of slack,
      // and a throttled tick can eat it.
      '3-9': {
        label: '3–9 minutes (max)', min: 3, max: 9,
        warn: 'Only ~1 min under Xero’s 10-min prompt. If the "still there?" dialog appears, drop to 5–8.'
      }
    },
    ceilingNote: 'Ceiling is Xero’s ~10-min inactivity prompt, not the 60-min sign-out.'
  }
};

// Sign-in / identity hosts. There's nothing to keep alive on a login page, and
// nudging one is how you get spurious "session appears signed out" readings.
const SKIP_HOST = /^(accounts?|login|signin|sign-in|identity|auth)\./i;

function siteIdForHost(host) {
  if (SKIP_HOST.test(host)) return null;
  for (const [id, def] of Object.entries(SITE_DEFS)) {
    if (def.hostPattern.test(host)) return id;
  }
  return null;
}

// Bump this when the shipped defaults change and you want them re-applied to
// existing installs (see applyDefaults() in background.js).
const DEFAULTS_VERSION = 4;

// Both sites start switched OFF. Nothing touches QuickBooks or Xero until you
// deliberately turn it on.
function defaultSettings() {
  const s = {};
  for (const [id, def] of Object.entries(SITE_DEFS)) {
    s[id] = { enabled: false, range: def.defaultRange, autoDismiss: true };
  }
  return s;
}

// Every URL pattern a site should be queried/injected for.
function globsFor(def) {
  return [def.urlGlob].concat(def.extraGlobs || []);
}

if (typeof module !== 'undefined') {
  module.exports = { SITE_DEFS, siteIdForHost, defaultSettings, DEFAULTS_VERSION, globsFor, SKIP_HOST };
}
