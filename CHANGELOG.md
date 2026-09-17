# Changelog

All notable changes to Session Keeper. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/); this project uses semantic
versioning.

---

## [3.5.0] — 2026-09-17

### Added

- **Version badge next to the extension name in the popup**, linking to the
  repository. The number is read from the manifest at runtime via
  `chrome.runtime.getManifest()` rather than written into the markup, so it
  can't drift out of sync after a version bump.
- **"by markpelayo"** byline under the tagline, same link.
- `homepage_url` in the manifest, so the `chrome://extensions` card links to the
  repo too.

Both links use `target="_blank"` with `rel="noopener noreferrer"`.

### Confirmed working

QuickBooks ran clean after 3.4.1 — no new "Signed In." entries in the Audit Log.

---

## [3.5.0] — 2026-09-17

### Added

- **Version badge** next to the title in the popup, and a **"by markpelayo"**
  byline. Both link to the GitHub repo and open in a new tab
  (`rel="noopener noreferrer"`).
- `homepage_url` in the manifest. The popup reads both the version and the repo
  URL back from the manifest at runtime, so neither can drift out of step with
  the build — and Chrome now shows the repo link on `chrome://extensions` too.

### Fixed

- The version-badge fallback called `.remove()` on the same element lookup that
  had just failed, which would itself throw. It now checks the element exists
  first.

### Confirmed in the field

No new "Signed In." entries in the QuickBooks Audit Log after 3.4.1. The
audit-log problem introduced in 3.0.0 is resolved.

---

## [3.4.1] — 2026-09-16

### Fixed — the last remaining Audit Log writer

3.4.0 removed the keepalive fetch, but missed a second source: when Chrome's
Memory Saver discarded a QuickBooks tab, the service worker reloaded it. A
reload is a fresh authenticated app load — the very thing that writes a
**"Signed In."** row. Sporadic rather than every few minutes, but still there.

It was also no longer justified. A discarded tab reloads itself when you next
focus it, and with no server-side clock to maintain for QBO there is nothing to
keep warm.

Reviving discarded tabs is now the per-site **"Reload tab if Chrome discards
it"** setting, off for QuickBooks and on for Xero (where a discarded tab can't
run the keepalive the 60-minute cap depends on).

**QuickBooks now makes no contact with Intuit's servers at all** — verified: no
`fetch`, no `XMLHttpRequest`, no `sendBeacon`, no reload. Nudges dispatch DOM
event objects inside the page and nothing else.

### Note

The nudge interval has no bearing on the Audit Log. With the fetch off, even a
2-minute interval writes nothing, because a nudge generates no network traffic.
8–10 minutes is about doing less pointless work, not about the log.

---

## [3.4.0] — 2026-09-16

### Fixed — the extension was polluting the QuickBooks Audit Log

Found in the field: the QBO Audit Log filled with **"Signed In." entries every
few minutes** — around 150 over one evening.

Cause: the keepalive fetch requested the app document (`location.pathname`)
with credentials, and QBO records a fresh authenticated app load as a sign-in.
Every keepalive wrote an audit row. The entries clustered in threes because
each open QBO tab ran its own keepalive independently.

This was worse than the problem it solved. An accounting audit trail is
evidence; an auditor seeing 150 sign-ins in an evening has a legitimate
question, and the answer "my browser extension did that" is not a good one.

**The keepalive fetch is now off for QuickBooks.** It was never needed there:
QBO's "Notify me if inactive for: 1 hour" setting means idle detection is
client-side and it *asks* before signing you out, so answering that dialog is
the whole mechanism. The fetch was defending against a server-side clock QBO
does not appear to use.

QuickBooks now generates **zero network requests** — it watches for the dialog
and answers it. Synthetic events are retained because they're free and produce
no traffic, but nothing depends on them (QBO ignores them).

Xero keeps its fetch: the 60-minute cap there is genuinely server-side. Whether
Xero logs those requests in its own login history is **unverified** — if it
does, switch the fetch off for Xero too and rely on the dialog alone.

### Added

- Per-site **Keepalive fetch** checkbox, with the audit-log consequence spelled
  out next to it. Off for QuickBooks, on for Xero.
- Site strategy line in the popup now leads with "answers the idle-timeout
  dialog", since that is what actually holds the session.

### Changed

- QuickBooks default interval **2–5 → 8–10 min**. With no fetch and events that
  QBO ignores, frequent nudges bought nothing. Dialog watching is driven by the
  observer and the 20s tick, neither of which depends on this interval.

### Note

Audit Log entries already written cannot be removed — the log is append-only by
design. The existing rows will stay; no new ones will be added.

---

## [3.3.0] — 2026-09-16

Performance and leak pass. No change to what the extension does.

### Fixed — memory leaks

- **Orphaned `MutationObserver`s accumulated.** Only the previous copy's timer
  was torn down on re-injection; its observer stayed attached and kept receiving
  every subtree mutation for the life of the page. Repeated extension reloads in
  one page session stacked them up. There is now a shared teardown registry, so
  a new copy disconnects the old observer *and* clears its timer immediately.
- **`shutdown()` leaked the observer.** It cleared the interval but never
  disconnected the observer or released the cached settings. It now releases
  everything and is idempotent.
- **A pending debounce timer could fire after shutdown.** The debounce is gone
  entirely (see below), so there is no longer any `setTimeout` to leak.

### Fixed — bugs

- **Any settings write re-rolled the nudge schedule.** Ticking the auto-answer
  checkbox reset the timer and delayed the next nudge. The schedule is now only
  re-rolled when the interval actually changes, or when a site is switched on.
- **A dialog already on screen could be missed for up to 20s.** The observer
  only sees nodes added after it attaches, so a dialog showing at injection time
  (or after a re-injection) waited for the next tick. One scan now runs as soon
  as settings load.
- **A label split across nested spans would not match.** `Continue` +
  `working` in separate spans reads as `Continueworking` via `textContent`.
  Labels are now normalised (lowercase, letters only), so all spacing variants
  match — and the allowlist is exact-match rather than a regex, which is both
  tighter and faster.

### Performance

- **No more forced reflows.** Label reading used `innerText`, which forces a
  layout, and did it for every button on the page on every scan. Now
  `textContent`, which does not.
- **Mutation handling is incremental.** The observer previously debounced and
  then re-scanned the entire document; it now inspects only the nodes that were
  just added, with a 250 ms floor and the tick-driven full scan as a safety net.
  This was the extension's single largest cost on a page as busy as QBO.
- **Settings are cached in memory**, refreshed via `chrome.storage.onChanged`.
  Every 20s tick and every dialog check previously did its own
  `chrome.storage.local.get()` — one IPC round trip per tab, indefinitely. Now
  one read at startup, plus one per actual change.
- **The 30s alarm only runs while a site is enabled.** It previously fired
  forever, waking the service worker ~2,880 times a day even with both toggles
  off and no QuickBooks tab open.
- **Stats writes cut from three storage operations to two.** The counter paths
  did their own `get()` and then called a `bumpStats()` that did a second one.
- **Popup does one storage read.** It was 1 + N sequential reads plus N
  sequential tab queries every 5 seconds while open; now a single read with the
  tab queries in parallel, and overlapping renders are prevented.

### Verified unchanged

The click gate was re-tested end to end: `Sign out`, `Continue` (for QBO),
`Cancel`, `Save and close`, `Delete` and `Yes, delete forever` are all still
rejected, as are delete-confirmation and unsaved-changes dialogs. Only
`Continue working` inside an idle-prompt dialog clicks.

---

## [3.2.0] — 2026-09-16

3.1.0 fixed *why* a bad health verdict was produced. This fixes the fact that
one could never go away once produced.

### Fixed

- **A health verdict never expired.** "failed (200) — session appears signed
  out" stayed on screen indefinitely, indistinguishable from an ongoing problem,
  even while QuickBooks was demonstrably working. A verdict is now expired after
  3× the expected keepalive interval (minimum 15 min) and shown as a grey
  "no recent check" instead of a red alarm.
- **Verdicts survived a browser restart.** After a macOS logout took Chrome with
  it, the popup still showed a red warning describing a session that no longer
  existed. `chrome.runtime.onStartup` now clears the volatile health fields
  (`lastFetchOk`, `lastFetchStatus`, `loggedOut`, `lastFetch`) and lets the next
  keepalive establish the truth. Cumulative counters are preserved.

### Added

- **Reset status** button per site, for clearing a stuck reading by hand.
- Failures now record the URL that produced them, and the popup shows
  "reported by &lt;host&gt;". A verdict written by some other tab is no longer
  anonymous — which is what made the earlier false positive so hard to place.

---

## [3.1.0] — 2026-09-16

### Fixed

- **False "failed (200) — session appears signed out".** Reported while the
  session was completely healthy and still usable. The logged-out check was:

  ```js
  /login|signin|sign-in|identity/i.test(res.url) && res.url !== url
  ```

  Both halves were unsound. `res.url !== url` is true for trivial reasons — a
  trailing slash or an appended query param counts — and the substring match
  hits plenty of healthy Intuit URLs. A 200 therefore got reported as a failure.

  A same-origin 200 now simply means healthy. Only two things count as signed
  out, both unambiguous: an HTTP **401/403**, or a redirect to a **different
  origin** whose hostname is an auth host (`accounts.`, `login.`, `signin.`,
  `identity.`, `auth.`). Verified against trailing-slash, query-param and
  `/app/identitysettings` responses (all healthy) versus a real bounce to
  `accounts.intuit.com` and 401/403 (all correctly flagged).

- **QuickBooks matched all of `*.intuit.com`.** It ran on ProAdvisor pages,
  Intuit account pages and the marketing site — wasting nudges and letting an
  unrelated tab poison QuickBooks' shared stats, which is the likeliest reason
  a bad reading appeared while the QBO tab itself was fine. Now scoped to
  `qbo.intuit.com` and `*.qbo.intuit.com`.

- Sign-in and identity hosts (`accounts.`, `login.`, `identity.`, …) are now
  skipped outright. There is nothing to keep alive on a login page, and nudging
  one produced exactly these spurious readings.

### Changed

- `sites.js` gained `extraGlobs` and `globsFor()` so a site can declare several
  URL patterns; tab queries use all of them.

---

## [3.0.1] — 2026-09-16

### Fixed

- **Dialog dismissal did not work when the window was minimized.** The
  visibility check rejected any button smaller than 1×1, but Chrome can skip
  layout entirely for a minimized or hidden tab, making every element report
  0×0. The dialog was found and then discarded as "invisible" — exactly when
  answering it matters most. Geometry is now only checked when the page is
  actually being rendered; style checks (`display`, `visibility`, `opacity`) are
  layout-independent and still apply always.

### Notes on minimized behaviour

Detection itself was already fine. The `MutationObserver` path has a 400 ms
debounce that Chrome throttles to as much as a minute in a hidden tab, but the
`chrome.alarms` path is not a page timer: it fires every 30 s in the service
worker and messages the content script, so the dialog is answered within ~30 s
even while minimized. `element.click()` needs neither focus nor visibility.

---

## [3.0.0] — 2026-09-16

Major version because the "never clicks anything" guarantee from 1.0.0 no longer
holds. It now clicks exactly one button, under tight conditions.

### Context

Field testing showed the earlier approach did not work on QuickBooks. With the
QBO toggle on and nudges firing, QBO still showed its **"Are you still working?"**
dialog. Two conclusions:

- QBO **ignores synthetic input events**, almost certainly because they carry
  `isTrusted: false` — the risk flagged in 1.0.0's limitations.
- QBO has a pre-sign-out idle prompt. Earlier versions incorrectly documented
  this as Xero-only. Leaving the dialog unanswered signs you out, so the dialog
  is the thing that actually has to be handled.

### Added

- **Idle-dialog dismissal ("layer D").** Detects the idle prompt via a
  `MutationObserver` plus a check on every tick, and clicks the session-extend
  button. Three independent conditions must all hold first:
  1. surrounding dialog text matches the site's idle-prompt wording
  2. the button label is an exact match for a session-extend label
  3. the label does not match the deny list (`sign out`, `log out`, `cancel`, `no…`)

  Bare "Continue" is rejected for QuickBooks — the real label is "Continue
  working", and accepting the generic word would only widen the blast radius.
  Verified against `Sign out`, `Delete`, `Save and close`, `Cancel`, `Yes`, and
  against delete-confirmation and unsaved-changes dialogs: all rejected.
- Clicks rate-limited to one per 3 seconds.
- Per-site **"Auto-answer the 'still working?' dialog"** checkbox, on by default.
- Popup now reports dialogs answered and when.

### Changed

- **QuickBooks now uses the keepalive fetch too** (every 2nd nudge), no longer
  relying on synthetic events that demonstrably don't register.
- QuickBooks default interval **8–10 → 2–5 min**. 8–10 sat right on top of the
  idle prompt.
- `manifest.json` description and `content.js` header no longer claim the
  extension never clicks, because that is no longer true.

### Still guaranteed

No printable keystroke, no `submit`, no `location.reload()`, and no click on
anything other than the one button described above.

---

## [2.6.0] — 2026-09-12

### Changed

- **Both sites now ship switched OFF.** Nothing touches QuickBooks or Xero until
  you deliberately enable it in the popup.
- Default interval is now the 3rd option on each menu: **8–10 min** for
  QuickBooks, **5–8 min** for Xero.
- Content script and popup now **fail closed** — if settings are missing or
  unreadable, they assume off rather than on.

### Added

- `DEFAULTS_VERSION` in `sites.js`. The service worker compares it against the
  stored value on update and re-applies shipped defaults once when it changes,
  so default changes reach existing installs instead of only fresh ones.

---

## [2.5.0] — 2026-09-12

### Fixed

- Superseded content scripts now die **immediately** rather than lingering up to
  20 seconds. Timer IDs are published on the shared isolated world so a newly
  injected copy clears the previous copy's `setInterval` on the spot. Only IDs
  this extension created are cleared; page timers are untouched.

### Added

- A narrowly-scoped `unhandledrejection` listener that suppresses **only**
  errors matching "Extension context invalidated". All other rejections,
  including the host page's own, pass through untouched.

### Known limitation

An already-orphaned script cannot be fixed by any later version — its code is
frozen in the page. A one-time hard refresh (⌘⇧R) is required after updating
from 2.4.0 or earlier.

---

## [2.4.0] — 2026-09-12

### Fixed

- **"Extension context invalidated", properly this time.** The 2.2.0 fix used a
  boolean `__sessionKeeperActive` flag, which was actively harmful: on an
  extension reload the orphan had already set the flag and could only clear it
  on its next tick, so the freshly injected copy saw it, assumed a healthy
  instance was running, and bailed out. The tab was left with a dead script
  throwing every 20s *and* no working keepalive. The console noise was the
  symptom; the silent failure was the real bug.
- Replaced with a **generation counter** (`__sessionKeeperGen`). Each injection
  claims the next number; every instance verifies it still owns the current
  generation before acting. Newest copy always wins.
- Every async entry point (`tick`, `fire`, `keepaliveFetch`, `report`) now runs
  through a `guard()` wrapper, so an in-flight promise can't surface as an
  uncaught rejection when the context dies.
- Liveness is re-checked after every `await`, since the context can die mid-call.

---

## [2.3.0] — 2026-09-12

### Added

- A widest "max" range at the bottom of each menu: **3–50 min** for QuickBooks,
  **3–9 min** for Xero. Wider bands make gaps look less machine-like.
- Selecting a max range shows an inline caution explaining its assumption.

### Notes

The two maxima differ because the ceilings are different kinds of limit.
QuickBooks' is a real sign-out (60 min at its shortest setting), so 50 leaves a
10-minute buffer for Chrome's background-timer throttling. Xero's is the ~10-min
inactivity prompt, so 9 leaves about a minute — but missing one is cosmetic,
since the keepalive fetch protects the actual session.

---

## [2.2.0] — 2026-09-12

### Added

- Service worker re-injects content scripts into already-open QuickBooks/Xero
  tabs on install and update. Chrome does not do this automatically, so an open
  tab previously had no keepalive at all until manually refreshed. Required the
  `scripting` permission.
- First attempt at orphan detection via `chrome.runtime.id`.

> Superseded by 2.4.0 — the guard flag introduced here caused a worse bug.

---

## [2.1.0] — 2026-09-12

### Fixed

- **Toggle switches were not clickable.** The slider was wrapped in a `<span>`
  instead of a `<label>`, so it was never bound to the hidden checkbox. Clicking
  did nothing in either direction; the switch only looked stuck "on" because on
  was the default.

### Added

- Extension icon set (16/32/48/128).

---

## [2.0.0] — 2026-09-12

### Added

- **Xero support**, with its own independent toggle, interval dropdown and stats.
- **Keepalive fetch** for Xero: a silent same-origin `GET` with
  `cache: 'no-store'`, response discarded. Resets the 60-minute server session
  clock without reloading the page, so unsaved work survives. `no-store` is
  essential — without it Chrome may answer from disk cache and never reach the
  server, silently defeating the whole mechanism.
- `sites.js` — all site definitions, ranges and strategies in one place. The
  popup builds its UI from it, so new sites need no UI work.

### Changed

- Per-site interval ranges. Xero caps at 8 min rather than 10, because its
  inactivity prompt fires at ~10.
- Renamed from "QBO Session Keeper" to "Session Keeper".

---

## [1.0.0] — 2026-09-12

### Added

- Initial release: QuickBooks Online only.
- Synthetic activity events (`pointermove`, `mousemove`, `mouseover`, Shift
  `keydown`/`keyup`, `focus`, `visibilitychange`, 0px scroll).
- Anti-discard handling for Chrome Memory Saver.
- Popup with toggle, interval selector and live stats.

### Design constraint, from the start

Never dispatch `click`, `mousedown`, `mouseup`, `submit`, or a printable
keystroke, and never call `location.reload()`. The extension cannot press a
button, save a transaction, type into a focused field, or discard unsaved work.
