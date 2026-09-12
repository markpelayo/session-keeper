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
| **QuickBooks** | 1–3 hr idle timeout (admin-configurable) | mouse / keyboard | synthetic activity events |
| **Xero** | ~10 min inactivity prompt | mouse / keyboard | synthetic activity events |
| **Xero** | **60 min session cap** (fixed) | a server round-trip | silent background `fetch()` |

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

## What it will not do

- **no** `click`, `mousedown`, `mouseup` — cannot press a button
- **no** `submit` — cannot submit a form or save a transaction
- **no** printable keystroke — the only key event is Shift, which inserts nothing
- **no** `location.reload()` — never refreshes the page you're working in

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
