# Session Keeper — QuickBooks Online & Xero

Stops idle sign-outs on both sites. Independent toggles, because the two sites
need genuinely different techniques.

## Install

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. **Load unpacked** → select this folder

## Do this first (QuickBooks only)

QBO lets you raise its own limit, and that costs nothing:

**Settings ⚙️ → Account and Settings → Advanced → Other preferences → Edit →
"Sign me out if inactive for" → 3 hours**

Master Admin only; applies to all users on the company file. Xero has no
equivalent setting — their 60-minute cap is fixed.

## Why two separate toggles

| | The clock | What actually resets it | What this extension does |
|---|---|---|---|
| **QuickBooks Online** | 1–3 hr idle timeout, admin-configurable | mouse / keyboard input | synthetic activity events |
| **Xero** | ~10 min inactivity prompt | mouse / keyboard input | synthetic activity events |
| **Xero** | **60 min hard session cap**, not configurable | a server round-trip | silent background `fetch()` |

Mouse movement does nothing for Xero's 60-minute cap — that clock only resets
when the server sees a request. Xero's own advice is to press F5, which would
destroy anything you're mid-way through entering. So instead the extension
issues the same request F5 would, as a background `fetch()` with the response
discarded. Your page is never re-rendered and nothing in progress is lost.

## Interval ranges, and why Xero's are tighter

Timing is **randomised inside the range** on every cycle, so requests never
arrive on a fixed cadence that an automation heuristic could spot.

| Site | Options | Must stay under |
|---|---|---|
| QuickBooks | 2–5 / 5–8 / 8–10 min | 60 min (shortest possible idle timeout) |
| Xero | 2–4 / 3–6 / 5–8 min | **10 min** (the inactivity prompt) |

Xero tops out at 8 rather than 10 deliberately — an 8–10 range could land right
on the 10-minute prompt. On Xero the keepalive fetch fires on every 3rd nudge,
so roughly every 9–18 minutes, well inside the 60-minute cap.

## What it will not do

Verified by scanning the source — the only occurrences of these words are in
comments:

- **no `click`, `mousedown`, `mouseup`** — cannot press a button
- **no `submit`** — cannot submit a form or save a transaction
- **no printable keystroke** — the only key event is Shift, which inserts nothing
- **no `location.reload()`** — never refreshes the page you're working in

The single exception, and it's in `background.js`: if Chrome's Memory Saver has
already **discarded** a tab, the extension reloads it. A discarded tab has
already lost its in-memory state, so there is no unsaved work left to destroy.

## Limitations

- **Hard token expiry still wins.** Both providers expire the auth token after a
  fixed window regardless of activity, and force re-auth on MFA and security
  events. Expect to sign in roughly once a day.
- **Synthetic events are `isTrusted: false`.** If either site filters on that
  flag, the event layer is inert. Only a `chrome.debugger` build produces
  trusted events, at the cost of a permanent "being debugged" banner.
- **QuickBooks has no keepalive fetch.** If QBO turns out to track idleness
  server-side, it needs the same treatment Xero gets — easy to enable, it's a
  one-line flag in `sites.js`.

## Testing it

Sign in, open the popup, confirm the counters increment. On Xero also watch
"Last keepalive" — it should read `ok (200)`. Then leave the tab untouched past
the timeout. The popup flags **Session appears signed out** if a keepalive gets
bounced to a login page.

## Adding another site

Add an entry to `SITE_DEFS` in `sites.js` and add the domain to `matches` and
`host_permissions` in `manifest.json`. The popup builds its cards from
`SITE_DEFS`, so a new site gets its toggle, dropdown and stats automatically.

## Note

Defeating these timeouts means an unattended machine can sit logged into your
accounting systems. Keep your screen lock short.
