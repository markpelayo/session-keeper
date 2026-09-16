# Changelog

All notable changes to Session Keeper. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/); this project uses semantic
versioning.

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
