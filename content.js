// Session Keeper — content script
//
// Runs on the QuickBooks Online and Xero apps only. Detects which site it's on
// and applies that site's strategy.
//
// It never types a printable character and never reloads the page, so work in
// progress is never lost.
//
// There is exactly ONE click: the "Continue working" button on the idle-timeout
// dialog. See "layer D" below for the conditions that must all hold before that
// happens. It cannot press "Sign out", and it cannot touch any other dialog or
// control on the site.

(() => {
  const SITE_ID = siteIdForHost(location.hostname);
  if (!SITE_ID) return;
  const DEF = SITE_DEFS[SITE_ID];

  // ------------------------------------------------------ generation takeover
  //
  // Reloading or updating the extension ORPHANS any content script already
  // running in an open tab: its code and timers keep going, but every chrome.*
  // call now throws "Extension context invalidated". A generation counter lets
  // the newest injection win and every older instance stand itself down.

  const MY_GEN = (window.__sessionKeeperGen = (window.__sessionKeeperGen || 0) + 1);

  // All content scripts of this extension share one isolated world, so a new
  // copy can tear down the previous copy's timer AND its MutationObserver
  // immediately. Leaving an old observer attached to a heavy SPA is a genuine
  // leak: each one keeps receiving every subtree mutation for the life of the
  // page. Only resources this extension created are ever touched.
  window.__sessionKeeperTeardown = window.__sessionKeeperTeardown || [];
  for (const teardown of window.__sessionKeeperTeardown.splice(0)) {
    try { teardown(); } catch (e) { /* no-op */ }
  }

  // Backwards compatibility: <=3.2.0 registered bare timer IDs under a
  // different global. On the first upgrade inside a live page that older copy
  // is the one still running, so clear its timer too.
  if (Array.isArray(window.__sessionKeeperTimers)) {
    for (const old of window.__sessionKeeperTimers.splice(0)) {
      try { clearInterval(old); } catch (e) { /* no-op */ }
    }
  }

  // Last line of defence: an orphaned instance can have a promise in flight
  // when its context dies, which surfaces as a page-level "Uncaught (in
  // promise)". Suppress ONLY that error; everything else, including the host
  // page's own rejections, is left alone.
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
  let observer = null;
  let stopped = false;

  // Settings are cached in memory and refreshed via chrome.storage.onChanged.
  // Previously every 20s tick — and every dialog check — did its own
  // chrome.storage.local.get(), i.e. an IPC round trip per tab, forever. Now
  // there is one read at startup and one per actual settings change.
  let cfg = null;

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
    if (stopped) return;
    stopped = true;
    if (timerId) { clearInterval(timerId); timerId = null; }
    if (observer) { try { observer.disconnect(); } catch (e) {} observer = null; }
    nextDueAt = 0;
    cfg = null;
  }

  function guard(p) {
    if (p && typeof p.catch === 'function') {
      p.catch((e) => { if (isInvalidated(e)) shutdown(); });
    }
    return p;
  }

  if (!contextAlive()) return;

  // ------------------------------------------------------------------ settings

  function normaliseCfg(raw) {
    return {
      enabled: !!(raw && raw.enabled),
      range: (raw && raw.range) || DEF.defaultRange,
      autoDismiss: !(raw && raw.autoDismiss === false),
      // User-controllable per site. Off for QuickBooks by default, because the
      // fetch writes a "Signed In." row to the Audit Log every time.
      useFetch: raw && typeof raw.useFetch === 'boolean'
        ? raw.useFetch
        : !!DEF.useKeepaliveFetch
    };
  }

  async function loadSettings() {
    if (!alive()) return shutdown();
    try {
      const all = await chrome.storage.local.get(defaultSettings());
      if (!alive()) return shutdown();
      cfg = normaliseCfg(all[SITE_ID]);
      if (cfg.enabled && !nextDueAt) reschedule(cfg.range);

      // The dialog may already be on screen — after a re-injection, or if the
      // script loaded while it was showing. The observer only sees nodes added
      // from now on, so do one scan immediately rather than waiting for a tick.
      if (cfg.enabled && cfg.autoDismiss !== false) fullScan();
    } catch (e) {
      if (isInvalidated(e)) shutdown();
    }
  }

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

    // Focus / visibility — what many SaaS idle detectors actually watch. These
    // dispatch event OBJECTS; they do not call focus() and cannot raise the
    // window or move the OS cursor.
    safeDispatch(window, new Event('focus'));
    safeDispatch(document, new Event('visibilitychange'));

    // Zero-distance scroll.
    try {
      window.scrollBy(0, 0);
      safeDispatch(document, new Event('scroll', { bubbles: true }));
    } catch (e) { /* no-op */ }
  }

  // ------------------------------------------------- layer C: keepalive fetch
  // A server-side session clock does not care about mouse movement. This makes
  // the same server round-trip an F5 would, as a background fetch whose
  // response is thrown away — the page is never re-rendered.

  function keepaliveTarget() {
    // Avoid replaying a URL with a query string: params can carry actions.
    if (location.search) return location.origin + '/';
    return location.origin + location.pathname;
  }

  // A same-origin 200 means healthy. Only two things count as signed out:
  // an HTTP 401/403, or a bounce to a DIFFERENT origin that is an auth host.
  function classifyResponse(res) {
    if (res.status === 401 || res.status === 403) {
      return { ok: false, loggedOut: true };
    }
    try {
      const finalUrl = new URL(res.url);
      const crossOrigin = finalUrl.origin !== location.origin;
      const isAuthHost = /^(accounts?|login|signin|sign-in|identity|auth)\./i.test(finalUrl.hostname);
      if (crossOrigin && isAuthHost) return { ok: false, loggedOut: true };
    } catch (e) { /* unparseable — fall through */ }

    return { ok: res.ok, loggedOut: false };
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
      const verdict = classifyResponse(res);
      payload = {
        type: 'KEEPALIVE_RESULT',
        ok: verdict.ok, status: res.status, loggedOut: verdict.loggedOut, url
      };
    } catch (e) {
      payload = { type: 'KEEPALIVE_RESULT', ok: false, status: 0, loggedOut: false, url, error: String(e) };
    }
    report(payload);
  }

  // ------------------------------------------- layer D: idle-dialog dismissal
  //
  // The one place this extension clicks. QuickBooks ignores synthetic input and
  // shows an "Are you still working?" dialog; leaving it unanswered signs you
  // out, so it has to be answered.
  //
  // Conditions, all required:
  //   1. the button's normalised label is in this site's exact-match allowlist
  //   2. that label is not in the deny list (sign out / log out / cancel / no)
  //   3. an ancestor's text matches this site's idle-prompt wording
  //   4. the button is visible and enabled
  //
  // Performance note: label reading uses textContent, never innerText.
  // innerText forces a layout reflow, and the old code read it for every button
  // on the page on every scan — by far the most expensive thing here. Labels
  // are normalised (lowercase, letters only) so a label split across nested
  // spans still matches.

  const BTN_SEL = 'button, [role="button"], input[type="button"], input[type="submit"], a[role="button"]';
  let lastDismissAt = 0;
  let lastObserverScanAt = 0;

  function isVisible(el) {
    try {
      const cs = getComputedStyle(el);
      // Style checks are layout-independent, so these always apply.
      if (cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0') return false;

      // Geometry is NOT reliable when the tab is hidden or the window is
      // minimized — Chrome may skip layout and report 0x0 for everything.
      // Enforcing a size there would discard the dialog precisely when we most
      // need to answer it.
      if (document.visibilityState === 'hidden' || document.hidden) return true;

      const r = el.getBoundingClientRect();
      return r.width >= 1 && r.height >= 1;
    } catch (e) { return false; }
  }

  function labelOf(el) {
    // textContent does not trigger layout; aria-label / value cover inputs.
    return normLabel(el.textContent || el.value || el.getAttribute('aria-label') || '');
  }

  function inIdleDialog(btn) {
    const cfg2 = DEF.idleDialog;
    let node = btn.parentElement;
    let hops = 0;
    while (node && hops++ < 8) {
      const text = node.textContent || '';
      if (text.length < 4000 && cfg2.match.test(text)) return true;
      node = node.parentElement;
    }
    return false;
  }

  function tryButtons(buttons) {
    const d = DEF.idleDialog;
    if (!d) return false;

    for (const btn of buttons) {
      const label = labelOf(btn);
      if (!label) continue;
      if (!d.confirmSet.has(label)) continue;   // 1
      if (d.denySet.has(label)) continue;       // 2
      if (!inIdleDialog(btn)) continue;         // 3
      if (btn.disabled || !isVisible(btn)) continue; // 4

      try { btn.click(); } catch (e) { return false; }
      lastDismissAt = Date.now();
      report({ type: 'DIALOG_DISMISSED', label: btn.textContent ? String(btn.textContent).trim().slice(0, 60) : label });
      return true;
    }
    return false;
  }

  function dismissAllowed() {
    if (!DEF.idleDialog || !cfg || !cfg.enabled || cfg.autoDismiss === false) return false;
    return Date.now() - lastDismissAt >= 3000; // never machine-gun clicks
  }

  // Full-document scan. Bounded to the tick cadence (~20s), never driven by
  // mutations, so page churn cannot turn this into a hot loop.
  function fullScan() {
    if (!dismissAllowed()) return false;
    return tryButtons(document.querySelectorAll(BTN_SEL));
  }

  // Cheap incremental scan: only the nodes that were just added, not the whole
  // document. This is what makes the observer affordable on an SPA.
  function scanAddedNode(node) {
    if (node.nodeType !== 1) return false;
    const found = [];
    try {
      if (node.matches && node.matches(BTN_SEL)) found.push(node);
      if (node.querySelectorAll) {
        for (const b of node.querySelectorAll(BTN_SEL)) found.push(b);
      }
    } catch (e) { return false; }
    return found.length ? tryButtons(found) : false;
  }

  if (DEF.idleDialog) {
    observer = new MutationObserver((records) => {
      if (!alive()) { shutdown(); return; }
      if (!dismissAllowed()) return;

      // Guard against pathological mutation storms; the tick-driven fullScan()
      // is the safety net for anything skipped here.
      const now = Date.now();
      if (now - lastObserverScanAt < 250) return;
      lastObserverScanAt = now;

      for (const rec of records) {
        const added = rec.addedNodes;
        for (let i = 0; i < added.length; i++) {
          if (scanAddedNode(added[i])) return;
        }
      }
    });
    try {
      observer.observe(document.documentElement || document.body, { childList: true, subtree: true });
    } catch (e) { observer = null; }
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
    if (cfg && cfg.useFetch && nudgeCount % (DEF.fetchEveryNthNudge || 3) === 0) {
      didFetch = true;
      guard(keepaliveFetch());
    }

    report({ type: 'DID_NUDGE', didFetch });
    reschedule(currentRangeKey);
  }

  function tick() {
    if (!alive()) return shutdown();
    if (!cfg) { guard(loadSettings()); return; }
    if (!cfg.enabled) { nextDueAt = 0; return; }

    // Safety net for a dialog that appeared while the observer was throttled.
    if (cfg.autoDismiss !== false) fullScan();

    if (cfg.range !== currentRangeKey || !nextDueAt) {
      reschedule(cfg.range);
      return;
    }
    if (Date.now() >= nextDueAt) fire();
  }

  try {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg && msg.type === 'KEEPALIVE_TICK') tick();
    });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (!alive()) return shutdown();
      if (area !== 'local' || !changes[SITE_ID]) return;

      const next = normaliseCfg(changes[SITE_ID].newValue);
      const rangeChanged = next.range !== (cfg ? cfg.range : null);
      const wasEnabled = !!(cfg && cfg.enabled);
      cfg = next;

      if (!next.enabled) { nextDueAt = 0; return; }
      // Only re-roll the schedule when it actually needs to change. Previously
      // ANY settings write (including ticking the auto-answer checkbox) reset
      // the nudge timer and delayed the next nudge.
      if (rangeChanged || !wasEnabled || !nextDueAt) reschedule(next.range);
    });
  } catch (e) {
    if (isInvalidated(e)) return shutdown();
  }

  timerId = setInterval(tick, 20000);
  window.__sessionKeeperTeardown.push(() => {
    if (timerId) clearInterval(timerId);
    if (observer) { try { observer.disconnect(); } catch (e) {} }
  });

  guard(loadSettings());
})();
