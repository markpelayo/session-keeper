# Changelog

All notable changes to Session Keeper. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/); this project uses semantic
versioning.

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
