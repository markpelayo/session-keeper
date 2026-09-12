// Session Keeper — content script
//
// Runs on intuit.com and xero.com tabs only. Detects which site it's on and
// applies that site's strategy.
//
// It NEVER dispatches click, mousedown, mouseup, or a printable keystroke, and
// it NEVER reloads the page. It cannot press a button, submit a form, save a
// transaction, type into a focused field, or discard unsaved work.

(() => {
  const SITE_ID = siteIdForHost(location.hostname);
  if (!SITE_ID) return;
  const DEF = SITE_DEFS[SITE_ID];

  // ------------------------------------------------------ generation takeover
  //
  // Reloading or updating the extension ORPHANS any content script already
  // running in an open tab: its code and timers keep going, but every chrome.*
  // call now throws "Extension context invalidated".
  //
  // A plain boolean "already active" flag was wrong here. The orphan had set it
  // to true and could only clear it on its next tick — so the freshly injected
  // copy saw the flag, assumed a healthy instance was running, and bailed out.
  // Net effect: the orphan kept throwing every 20s AND the tab was left with no
  // working keeper at all.
  //
  // A generation counter fixes both. The newest injection always wins, and every
  // older instance stands itself down the moment it notices it's been superseded.

  const MY_GEN = (window.__sessionKeeperGen = (window.__sessionKeeperGen || 0) + 1);

  // All content scripts belonging to this extension share one isolated world, so
  // a newly injected copy can reach the previous copy's timer and stop it RIGHT
  // NOW, rather than waiting up to 20s for that copy to notice it's superseded.
  // Only IDs this extension created are ever cleared — page timers are untouched.
  window.__sessionKeeperTimers = window.__sessionKeeperTimers || [];
  for (const oldTimer of window.__sessionKeeperTimers.splice(0)) {
    try { clearInterval(oldTimer); } catch (e) { /* no-op */ }
  }

  // Last line of defence. An orphaned instance can have a promise already in
  // flight when its context dies, and that surfaces as a page-level
  // "Uncaught (in promise)". Suppress ONLY that specific error — anything else,
  // including the host page's own rejections, is left completely alone.
  if (!window.__sessionKeeperRejectionHook) {
    window.__sessionKeeperRejectionHook = true;
    window.addEventListener('unhandledrejection', (ev) => {
      const reason = ev && ev.reason;
      const text = String(reason && reason.message ? reason.message : reason);
      if (/Extension context invalidated/i.test(text)) ev.preventDefault();
    });
  }

  let nextDueAt = 0;
  let nudgeCount = 0;
  let currentRangeKey = DEF.defaultRange;
  let timerId = null;
  let stopped = false;

  function contextAlive() {
    try { return !!(chrome && chrome.runtime && chrome.runtime.id); } catch (e) { return false; }
  }

  function superseded() { return window.__sessionKeeperGen !== MY_GEN; }

  function alive() { return !stopped && !superseded() && contextAlive(); }

  function isInvalidated(err) {
    return /context invalidated|Extension context|message port closed|receiving end does not exist/i
      .test(String(err && err.message ? err.message : err));
  }

  function shutdown() {
    stopped = true;
    if (timerId) clearInterval(timerId);
    timerId = null;
    nextDueAt = 0;
  }

  // Every async call goes through this. An orphaned instance can still have a
  // promise in flight when the context dies; without this it surfaces as an
  // "Uncaught (in promise)" in the page console.
  function guard(p) {
    if (p && typeof p.catch === 'function') {
      p.catch((e) => { if (isInvalidated(e)) shutdown(); });
    }
    return p;
  }

  if (!contextAlive()) return;

  // ---------------------------------------------------------------- scheduling

  // Randomised interval, so requests never arrive on a predictable cadence that
  // a fraud/automation heuristic could latch onto.
  function rollNextDelay(rangeKey) {
    const r = DEF.ranges[rangeKey] || DEF.ranges[DEF.defaultRange];
    return Math.round((r.min + Math.random() * (r.max - r.min)) * 60 * 1000);
  }

  function reschedule(rangeKey) {
    currentRangeKey = rangeKey;
    nextDueAt = Date.now() + rollNextDelay(rangeKey);
  }

  // ------------------------------------------------------- layer A+B: activity

  const safeDispatch = (target, event) => {
    try { target.dispatchEvent(event); } catch (e) { /* no-op */ }
  };

  function sendActivityEvents() {
    const x = Math.floor(window.innerWidth / 2) + Math.floor(Math.random() * 40 - 20);
    const y = Math.floor(window.innerHeight / 2) + Math.floor(Math.random() * 40 - 20);
    const mouseInit = {
      bubbles: true, cancelable: true, view: window,
      clientX: x, clientY: y, screenX: x, screenY: y, buttons: 0
    };

    // Pointer activity — resets pointer-based idle timers.
    safeDispatch(document, new PointerEvent('pointermove', { ...mouseInit, pointerType: 'mouse' }));
    safeDispatch(document, new MouseEvent('mousemove', mouseInit));

    // Modifier-only keystroke. Shift inserts no text and activates nothing.
    const keyInit = { bubbles: true, cancelable: true, key: 'Shift', code: 'ShiftLeft', keyCode: 16, which: 16 };
    safeDispatch(document, new KeyboardEvent('keydown', keyInit));
    safeDispatch(document, new KeyboardEvent('keyup', keyInit));

    // Focus / visibility — what many SaaS idle detectors actually watch.
    safeDispatch(window, new Event('focus'));
    safeDispatch(document, new Event('visibilitychange'));

    // Zero-distance scroll.
    try {
      window.scrollBy(0, 0);
      safeDispatch(document, new Event('scroll', { bubbles: true }));
    } catch (e) { /* no-op */ }
  }

  // ------------------------------------------------- layer C: keepalive fetch
  // Xero's 60-minute session cap is server-side and does not care about mouse
  // movement. This performs the same server round-trip an F5 would, but as a
  // background fetch whose response is thrown away — the page is never
  // re-rendered and nothing in progress is lost.

  function keepaliveTarget() {
    // Avoid replaying a URL with a query string: params can carry actions.
    if (location.search) return location.origin + '/';
    return location.origin + location.pathname;
  }

  async function keepaliveFetch() {
    if (!alive()) return shutdown();
    const url = keepaliveTarget();
    let payload;
    try {
      const res = await fetch(url, {
        credentials: 'include',
        // Critical: without no-store the browser may serve this from disk cache
        // and never touch the server, which would defeat the entire point.
        cache: 'no-store',
        redirect: 'follow',
        method: 'GET'
      });
      const loggedOut = /login|signin|sign-in|identity/i.test(res.url) && res.url !== url;
      payload = { type: 'KEEPALIVE_RESULT', ok: res.ok && !loggedOut, status: res.status, loggedOut, url };
    } catch (e) {
      payload = { type: 'KEEPALIVE_RESULT', ok: false, status: 0, loggedOut: false, url, error: String(e) };
    }
    report(payload);
  }

  // ------------------------------------------------------------------ runner

  function report(payload) {
    if (!alive()) return shutdown();
    try {
      guard(chrome.runtime.sendMessage({ site: SITE_ID, ...payload }));
    } catch (e) {
      if (isInvalidated(e)) shutdown();
    }
  }

  function fire() {
    if (!alive()) return shutdown();
    nudgeCount++;

    if (DEF.useEvents) sendActivityEvents();

    let didFetch = false;
    if (DEF.useKeepaliveFetch && nudgeCount % (DEF.fetchEveryNthNudge || 3) === 0) {
      didFetch = true;
      guard(keepaliveFetch());
    }

    report({ type: 'DID_NUDGE', didFetch });
    reschedule(currentRangeKey);
  }

  async function tick() {
    // Cheap synchronous checks first. An orphaned or superseded instance never
    // reaches a chrome.* call, which is what used to throw here.
    if (!alive()) return shutdown();

    let all;
    try {
      all = await chrome.storage.local.get(defaultSettings());
    } catch (e) {
      if (isInvalidated(e)) return shutdown();
      return; // transient storage error — retry next tick
    }

    if (!alive()) return shutdown(); // context may have died during the await

    // Fail closed: if settings are somehow missing, stay off rather than on.
    const cfg = all[SITE_ID] || { enabled: false, range: DEF.defaultRange };
    if (!cfg.enabled) { nextDueAt = 0; return; }

    if (cfg.range !== currentRangeKey || !nextDueAt) {
      reschedule(cfg.range);
      return;
    }
    if (Date.now() >= nextDueAt) fire();
  }

  try {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg && msg.type === 'KEEPALIVE_TICK') guard(tick());
    });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (!alive()) return shutdown();
      if (area === 'local' && changes[SITE_ID]) {
        const next = changes[SITE_ID].newValue;
        if (next && next.enabled) reschedule(next.range);
        else nextDueAt = 0;
      }
    });
  } catch (e) {
    if (isInvalidated(e)) return shutdown();
  }

  timerId = setInterval(() => guard(tick()), 20000);
  window.__sessionKeeperTimers.push(timerId);
  guard(tick());
})();
