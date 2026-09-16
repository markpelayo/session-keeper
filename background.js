// Session Keeper — background service worker
importScripts('sites.js');

const ALARM_NAME = 'session-keeper-tick';

async function initSettings() {
  const defs = defaultSettings();
  const { defaultsVersion } = await chrome.storage.local.get({ defaultsVersion: 0 });

  // Fresh install, or the shipped defaults changed since this install last saw
  // them: apply them wholesale. Otherwise leave the user's own choices alone.
  if (defaultsVersion < DEFAULTS_VERSION) {
    await chrome.storage.local.set({ ...defs, defaultsVersion: DEFAULTS_VERSION });
    return;
  }

  const current = await chrome.storage.local.get(defs);
  await chrome.storage.local.set({ ...defs, ...current });
}

// 30s is Chrome's floor. The content script does the real timing; this just
// guarantees it gets woken even when the tab is backgrounded and page timers
// are throttled.
//
// The alarm is only kept alive while at least one site is enabled. Previously
// it fired every 30s forever, waking the service worker around 2,880 times a
// day even with both toggles off and no QuickBooks tab open.
async function syncAlarm() {
  const settings = await chrome.storage.local.get(defaultSettings());
  const anyEnabled = Object.keys(SITE_DEFS).some((id) => settings[id] && settings[id].enabled);

  const existing = await chrome.alarms.get(ALARM_NAME);
  if (anyEnabled && !existing) {
    chrome.alarms.create(ALARM_NAME, { periodInMinutes: 0.5 });
  } else if (!anyEnabled && existing) {
    await chrome.alarms.clear(ALARM_NAME);
  }
}

// Re-evaluate whenever a toggle changes.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (Object.keys(SITE_DEFS).some((id) => id in changes)) syncAlarm();
});

// After an install or update, Chrome does NOT inject content scripts into tabs
// that are already open — so a QuickBooks tab you had open would sit there with
// no keepalive at all (and an orphaned old script throwing "Extension context
// invalidated") until you manually refreshed it. Re-inject explicitly instead.
async function reinjectOpenTabs() {
  for (const def of Object.values(SITE_DEFS)) {
    let tabs = [];
    try { tabs = await chrome.tabs.query({ url: globsFor(def) }); } catch (e) { continue; }
    for (const tab of tabs) {
      if (tab.discarded) continue;
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['sites.js', 'content.js']
        });
      } catch (e) { /* restricted page or tab closed — skip */ }
    }
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  await initSettings();
  await syncAlarm();
  await reinjectOpenTabs();
});
// Health readings describe a live session. After a browser restart (or a macOS
// logout that took Chrome with it) the session they described is gone, so
// keeping the old verdict on screen is just misinformation — it showed a red
// "session appears signed out" for a session that no longer existed. Clear the
// volatile fields on startup and let the next keepalive establish the truth.
// Cumulative counters are deliberately preserved.
async function clearVolatileStats() {
  for (const id of Object.keys(SITE_DEFS)) {
    const key = `stats_${id}`;
    const cur = (await chrome.storage.local.get({ [key]: {} }))[key] || {};
    delete cur.lastFetchOk;
    delete cur.lastFetchStatus;
    delete cur.lastFetchUrl;
    delete cur.loggedOut;
    delete cur.lastFetch;
    await chrome.storage.local.set({ [key]: cur });
  }
}

chrome.runtime.onStartup.addListener(async () => {
  await clearVolatileStats();
  await syncAlarm();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_NAME) return;
  const settings = await chrome.storage.local.get(defaultSettings());

  for (const [id, def] of Object.entries(SITE_DEFS)) {
    if (!settings[id] || !settings[id].enabled) continue;
    const tabs = await chrome.tabs.query({ url: globsFor(def) });
    for (const tab of tabs) {
      try {
        // Chrome's Memory Saver discards background tabs. Reviving one is a
        // fresh authenticated app load, which on QuickBooks writes another
        // "Signed In." row to the Audit Log — so this is opt-in per site and
        // off wherever we're being audit-log careful. A discarded tab reloads
        // itself when you next focus it regardless.
        if (tab.discarded) {
          if (settings[id].reviveDiscarded) await chrome.tabs.reload(tab.id);
          continue;
        }
        await chrome.tabs.sendMessage(tab.id, { type: 'KEEPALIVE_TICK' });
      } catch (e) { /* no content script in that tab yet */ }
    }
  }
});

// One read + one write per update. The counter paths previously did their own
// get() and then called a bumpStats() that did a SECOND get() — three storage
// operations where two suffice. `update` receives the current stats so a
// counter can be incremented inside the same read.
async function bumpStats(site, update) {
  const key = `stats_${site}`;
  const cur = (await chrome.storage.local.get({ [key]: {} }))[key] || {};
  const patch = typeof update === 'function' ? update(cur) : update;
  await chrome.storage.local.set({ [key]: { ...cur, ...patch } });
}

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || !msg.site) return;

  switch (msg.type) {
    case 'DID_NUDGE':
      bumpStats(msg.site, (cur) => ({
        lastNudge: Date.now(),
        nudges: (cur.nudges || 0) + 1
      }));
      break;

    case 'DIALOG_DISMISSED':
      bumpStats(msg.site, (cur) => ({
        lastDismiss: Date.now(),
        dismissals: (cur.dismissals || 0) + 1,
        lastDismissLabel: msg.label
      }));
      break;

    case 'KEEPALIVE_RESULT':
      bumpStats(msg.site, {
        lastFetch: Date.now(),
        lastFetchOk: msg.ok,
        lastFetchStatus: msg.status,
        // Recorded so a bad reading can be traced to the tab that produced it.
        lastFetchUrl: msg.url,
        loggedOut: msg.loggedOut
      });
      break;

    case 'RESET_STATS':
      chrome.storage.local.set({ [`stats_${msg.site}`]: {} });
      break;
  }
});
