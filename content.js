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

  let nextDueAt = 0;
  let nudgeCount = 0;
  let currentRangeKey = DEF.defaultRange;

  // ---------------------------------------------------------------- scheduling

  // Randomised interval, so requests never arrive on a predictable cadence that
  // a fraud/automation heuristic could latch onto.
  function rollNextDelay(rangeKey) {
    const r = DEF.ranges[rangeKey] || DEF.ranges[DEF.defaultRange];
    const ms = (r.min + Math.random() * (r.max - r.min)) * 60 * 1000;
    return Math.round(ms);
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
    // A bare path (or the origin root) is a plain, idempotent GET.
    if (location.search) return location.origin + '/';
    return location.origin + location.pathname;
  }

  async function keepaliveFetch() {
    const url = keepaliveTarget();
    try {
      const res = await fetch(url, {
        credentials: 'include',
        // Critical: without no-store the browser may serve this from disk cache
        // and never touch the server, which would defeat the entire point.
        cache: 'no-store',
        redirect: 'follow',
        method: 'GET'
      });
      // If we got bounced to a login page, the session is already gone.
      const loggedOut = /login|signin|sign-in|identity/i.test(res.url) && res.url !== url;
      report({ type: 'KEEPALIVE_RESULT', ok: res.ok && !loggedOut, status: res.status, loggedOut, url });
    } catch (e) {
      report({ type: 'KEEPALIVE_RESULT', ok: false, status: 0, loggedOut: false, url, error: String(e) });
    }
  }

  // ------------------------------------------------------------------ runner

  function report(payload) {
    try {
      chrome.runtime.sendMessage({ site: SITE_ID, ...payload });
    } catch (e) { /* extension reloaded — ignore */ }
  }

  async function fire() {
    nudgeCount++;

    if (DEF.useEvents) sendActivityEvents();

    let didFetch = false;
    if (DEF.useKeepaliveFetch && nudgeCount % (DEF.fetchEveryNthNudge || 3) === 0) {
      didFetch = true;
      keepaliveFetch();
    }

    report({ type: 'DID_NUDGE', didFetch });
    reschedule(currentRangeKey);
  }

  async function tick() {
    const all = await chrome.storage.local.get(defaultSettings());
    const cfg = all[SITE_ID] || { enabled: true, range: DEF.defaultRange };
    if (!cfg.enabled) { nextDueAt = 0; return; }

    if (cfg.range !== currentRangeKey || !nextDueAt) {
      reschedule(cfg.range);
      return;
    }
    if (Date.now() >= nextDueAt) fire();
  }

  // Driven from two directions: alarms in the service worker (which keep firing
  // when the tab is backgrounded and setInterval gets throttled), and a local
  // timer (which covers the gaps when the service worker has been torn down).
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'KEEPALIVE_TICK') tick();
  });
  setInterval(tick, 20000);
  tick();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[SITE_ID]) {
      const next = changes[SITE_ID].newValue;
      if (next && next.enabled) reschedule(next.range);
      else nextDueAt = 0;
    }
  });
})();
