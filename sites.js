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
    // Strategy: idle-dialog dismissal. NO keepalive fetch.
    //
    // The keepalive fetch was removed in 3.4.0. Requesting the app document
    // with credentials made QBO record a **"Signed In." entry in the Audit
    // Log** every time — roughly ten an hour, multiplied by the number of open
    // tabs. That is an accounting audit trail, and polluting it is far worse
    // than the problem the fetch was solving.
    //
    // It was also unnecessary. QBO's "Notify me if inactive for: 1 hour"
    // setting means idle detection is client-side and it *asks* before signing
    // you out, so answering that dialog is the entire mechanism. The fetch was
    // guarding against a server-side clock QBO does not appear to use.
    //
    // Synthetic events are kept because they cost nothing and generate no
    // network traffic, but field testing showed QBO ignores them (they carry
    // isTrusted: false), so nothing depends on them.
    useEvents: true,
    useKeepaliveFetch: false,
    // Nudges are near-free and QBO ignores them anyway, so there's no reason to
    // run them often. Dialog watching is driven by the observer and the 20s
    // tick, neither of which depends on this interval.
    defaultRange: '8-10',
    // Surfaced in the popup if the fetch is ever switched back on.
    fetchAuditWarning: 'Creates a "Signed In." entry in the QuickBooks Audit Log each time.',
    idleDialog: {
      // ALL THREE must match before anything is clicked.
      match: /are you still working|haven'?t been active|still there\?/i,
      // Exact-match allowlist, compared after normalising (lowercase, strip
      // everything that isn't a letter). Replaces the old regex-on-innerText
      // approach: reading innerText forces a layout reflow, and doing that for
      // every button on a page this large was the single most expensive thing
      // the extension did. Normalising also makes matching immune to a label
      // split across nested spans, which textContent would otherwise mangle
      // into "Continueworking".
      //
      // Bare "Continue" is deliberately NOT accepted here: QBO's button is
      // labelled "Continue working", so allowing the generic word would only
      // widen the blast radius for no benefit.
      confirmLabels: ['Continue working', 'Keep working', "I'm still here", "I'm still working", 'Stay signed in'],
      denyLabels: ['Sign out', 'Log out', 'Cancel', 'No', 'No thanks', 'Not now']
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
    // Xero keeps the fetch: its 60-minute cap is genuinely server-side and
    // mouse movement does not touch it. Whether Xero records these in its own
    // login history the way QuickBooks does is UNVERIFIED — if you find it
    // does, switch the fetch off here too and rely on the dialog alone.
    fetchAuditWarning: 'May show up in Xero login history — unverified. Switch off if it does.',
    idleDialog: {
      match: /are you still (there|working)|haven'?t been active|session.{0,20}(expire|time ?out)/i,
      confirmLabels: [
        'Continue', 'Continue working', 'Keep working', 'Stay signed in',
        "I'm still here", "I'm still working", 'Yes, keep me signed in'
      ],
      denyLabels: ['Sign out', 'Log out', 'Logout', 'Cancel', 'No', 'No thanks', 'Not now']
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
const DEFAULTS_VERSION = 6;

// Both sites start switched OFF. Nothing touches QuickBooks or Xero until you
// deliberately turn it on.
function defaultSettings() {
  const s = {};
  for (const [id, def] of Object.entries(SITE_DEFS)) {
    s[id] = {
      enabled: false,
      range: def.defaultRange,
      autoDismiss: true,
      // Per-site and user-controllable, because on QuickBooks the fetch writes
      // to the Audit Log. Defaults to whatever the site definition says.
      useFetch: !!def.useKeepaliveFetch,
      // Reloading a discarded tab is a fresh authenticated app load, which on
      // QuickBooks writes another "Signed In." row. Defaults off wherever the
      // fetch is off, i.e. wherever we're being audit-log careful. A discarded
      // tab reloads itself when you next focus it anyway.
      reviveDiscarded: !!def.useKeepaliveFetch
    };
  }
  return s;
}

// Every URL pattern a site should be queried/injected for.
function globsFor(def) {
  return [def.urlGlob].concat(def.extraGlobs || []);
}

// Lowercase, letters only. "Continue working", "continue  working" and
// "Continueworking" all collapse to the same key.
function normLabel(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/[^a-z]/g, '');
}

// Precompute normalised label sets once, rather than per scan.
for (const def of Object.values(SITE_DEFS)) {
  if (!def.idleDialog) continue;
  def.idleDialog.confirmSet = new Set((def.idleDialog.confirmLabels || []).map(normLabel));
  def.idleDialog.denySet = new Set((def.idleDialog.denyLabels || []).map(normLabel));
}

if (typeof module !== 'undefined') {
  module.exports = {
    SITE_DEFS, siteIdForHost, defaultSettings, DEFAULTS_VERSION,
    globsFor, SKIP_HOST, normLabel
  };
}
