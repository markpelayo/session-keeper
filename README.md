# Session Keeper — QuickBooks Online & Xero

A Chrome extension that stops QuickBooks Online and Xero signing you out for
inactivity. It never clicks, never types, and never reloads your page, so work in
progress is never lost.

Both sites ship **switched off**. Nothing happens until you turn one on.

## Install

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. **Load unpacked** → select this folder
4. Click the yellow **S** icon and switch on the site you want

## Do this first (QuickBooks only)

QuickBooks lets you raise its own limit for free:

**Settings ⚙️ → Account and Settings → Advanced → Other preferences →
"Sign me out if inactive for" → 3 hours**

Master Admin only, and it applies to everyone on the company file. If 3 hours
covers your day, you may not need the extension at all. Xero has no equivalent —
its limit is fixed.

## How it works

The two sites need different techniques, which is why they have separate toggles.

| | The clock | What resets it | What the extension does |
|---|---|---|---|
| **QuickBooks** | 1–3 hr idle timeout, then an "Are you still working?" prompt | real mouse / keyboard only | **answers the dialog** — no network requests at all |
| **Xero** | ~10 min inactivity prompt | mouse / keyboard | synthetic events + answers the dialog |
| **Xero** | **60 min session cap** (fixed) | a server round-trip | silent background `fetch()` |

### Why QuickBooks makes no network requests

Earlier versions gave QuickBooks a keepalive fetch too. That was a mistake: the
fetch requested the app document with credentials, and **QBO records every
authenticated app load as a "Signed In." entry in the Audit Log** — about ten an
hour, multiplied by the number of open tabs. Polluting an accounting audit trail
is worse than the problem it solved.

It was also unnecessary. QBO's "Notify me if inactive for" setting means idle
detection is client-side and it *asks* before signing you out, so answering that
dialog is the entire mechanism.

Synthetic events are still sent to QuickBooks because they're free and generate
no traffic, but field testing showed QBO ignores them (`isTrusted: false`), so
nothing depends on them. The **Keepalive fetch** checkbox in the popup lets you
turn the fetch back on per site if you ever need it; the audit-log consequence is
printed next to it.

Mouse movement does nothing for Xero's 60-minute cap — only a request to the
server resets it. Xero's own advice is to press F5, which would destroy anything
you're part-way through entering. Instead the extension issues the same request
F5 would, as a background fetch with the response discarded. The page is never
re-rendered.

## Settings

Each site has a toggle and an interval range. Timing is **randomised inside the
range** every cycle, so requests never arrive on a fixed, machine-looking cadence.

| Site | Options | Default | Ceiling |
|---|---|---|---|
| QuickBooks | 2–5 / 5–8 / **8–10** / 3–50 (max) min | 8–10 | 60 min sign-out |
| Xero | 2–4 / 3–6 / **5–8** / 3–9 (max) min | 5–8 | ~10 min prompt |

The ceilings are different kinds of limit, which is why the "max" options differ
so much. For QuickBooks the ceiling is a real sign-out, so max is 50 — a
10-minute buffer for Chrome's background-timer throttling. For Xero the ceiling
is only the "are you still there?" prompt, so max is 9; missing one there is
cosmetic, because the keepalive fetch is what protects the actual session.
Selecting either max shows a caution explaining its assumption.

## The one click (3.0.0)

Field testing showed QuickBooks **ignores synthetic input events** — almost
certainly because they carry `isTrusted: false` — and shows its own "Are you
still working?" dialog. Leaving that dialog unanswered signs you out, so it has
to be answered. That's the only reason this extension clicks anything.

Four conditions must **all** hold before a click happens:

1. the button's normalised label is in that site's **exact-match allowlist**
2. that label is not in the deny list (`sign out`, `log out`, `cancel`, `no`…)
3. an ancestor's text matches that site's idle-prompt wording
4. the button is visible and enabled

Labels are normalised to lowercase letters only, so spacing variants and labels
split across nested spans all match.

So it can only press "Continue working" inside a box that says "Are you still
working?". Bare "Continue" is deliberately rejected for QuickBooks, since the
real label is "Continue working" and accepting the generic word would only widen
the blast radius. Verified against `Sign out`, `Delete`, `Save and close`,
`Cancel` and `Yes` — all rejected, as are delete-confirmation and unsaved-changes
dialogs.

Clicks are rate-limited to one per 3 seconds, and the popup counts them so you
can see exactly when it acted. Turn it off per-site with the
**"Auto-answer the 'still working?' dialog"** checkbox.

### Does it work while the window is minimized?

Yes. There are two triggers, and the reliable one isn't a page timer:

| Trigger | Minimized behaviour |
|---|---|
| `MutationObserver` (400 ms debounce) | Throttled — Chrome can stretch the debounce to ~1 minute in a hidden tab |
| `chrome.alarms` → message → `tick()` | **Unaffected.** Fires every 30 s in the service worker; extension messaging isn't page-throttled |

So the dialog is answered within about 30 seconds even when minimized.
`element.click()` is a DOM call, not a real input event, so it needs neither
focus nor visibility.

The one thing minimizing genuinely breaks is layout: Chrome may skip it, making
every element report 0×0. That's what 3.0.1 fixes — see the changelog.

If Chrome's Memory Saver **discards** the tab entirely, the page and its DOM are
gone, so there's no dialog to answer. The service worker detects the discarded
tab and reloads it, which re-establishes the session.

## What it still will not do

- **no** printable keystroke — the only key event is Shift, which inserts nothing
- **no** `submit` — cannot submit a form or save a transaction
- **no** `location.reload()` — never refreshes the page you're working in
- **no** click on anything except the one button described above

The one exception, in `background.js`: if Chrome's Memory Saver has already
**discarded** a tab, the extension reloads it. A discarded tab has already lost
its in-memory state, so there's no unsaved work left to destroy.

## Limitations

- **Hard token expiry still wins.** Both providers expire the auth token after a
  fixed window regardless of activity, and force re-auth on MFA and security
  events. Expect to sign in roughly once a day.
- **Synthetic events are `isTrusted: false`.** If either site filters on that
  flag, the event layer is inert. Only a `chrome.debugger` build produces trusted
  events, at the cost of a permanent "being debugged" banner.
- **QuickBooks has no keepalive fetch**, on the theory its timeout is
  client-side. If nudges are firing and you're still signed out, flip
  `useKeepaliveFetch` for `qbo` in `sites.js`.

## Troubleshooting

**"Extension context invalidated" in the console.** You're seeing a dead copy of
the script left behind by an extension reload. Check DevTools → Sources →
Content scripts: if there's a `VM##### content.js` alongside `content.js`, that's
the corpse. The toggle can't stop it — switching off writes to `chrome.storage`,
which is the exact API that's dead inside an orphan.

**Fix: hard-refresh the tab once (⌘⇧R).** Since 2.5.0 the extension cleans up
after itself on reload, so this should be a one-time step.

**Is it actually running?** Open the popup and watch the nudge counter climb. On
Xero, "Last keepalive" should read `ok (200)`. If it says failed, or you see
"Session appears signed out", the fetch isn't holding the session.

## Adding another site

Add an entry to `SITE_DEFS` in `sites.js`, then add the domain to `matches` and
`host_permissions` in `manifest.json`. The popup builds its cards from
`SITE_DEFS`, so the new site gets its toggle, dropdown and stats automatically.

## Resource use

Designed to be close to free when idle:

| | Behaviour |
|---|---|
| Settings reads | One per tab at startup, then only on an actual change (cached in memory) |
| Service-worker wakeups | 30s alarm, but **only while a site is enabled** — nothing when both are off |
| Mutation handling | Inspects only newly-added nodes, 250 ms floor; no full-document rescans |
| Layout reflows | None — labels are read with `textContent`, never `innerText` |
| Long-lived resources | One interval, one `MutationObserver`; both torn down on shutdown and on re-injection |

Every long-lived resource is registered in a shared teardown list, so a newly
injected copy of the content script releases the previous copy's interval and
observer immediately rather than leaving them attached to the page.

## Files

| File | Role |
|---|---|
| `manifest.json` | MV3 manifest, permissions, icons |
| `sites.js` | Site definitions, interval ranges, defaults — **edit this first** |
| `content.js` | The nudge engine; runs in QBO/Xero tabs |
| `background.js` | Alarms, anti-discard, re-injection, stats |
| `popup.html` / `popup.js` | The toggle UI |

Version history is in [CHANGELOG.md](CHANGELOG.md).

## Note

Defeating these timeouts means an unattended machine can sit logged into your
accounting systems. Keep your screen lock short.
