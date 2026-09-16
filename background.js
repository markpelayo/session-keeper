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

function scheduleAlarm() {
  // 30s is Chrome's floor. The content script does the real timing; this just
  // guarantees it gets woken up even when the tab is in the background.
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: 0.5 });
}

// After an install or update, Chrome does NOT inject content scripts into tabs
// that are already open — so a QuickBooks tab you had open would sit there with
// no keepalive at all (and an orphaned old script throwing "Extension context
// invalidated") until you manually refreshed it. Re-inject explicitly instead.
async function reinjectOpenTabs() {
  for (const def of Object.values(SITE_DEFS)) {
    let tabs = [];
    try { tabs = await chrome.tabs.query({ url: def.urlGlob }); } catch (e) { continue; }
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
  scheduleAlarm();
  await reinjectOpenTabs();
});
chrome.runtime.onStartup.addListener(scheduleAlarm);

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_NAME) return;
  const settings = await chrome.storage.local.get(defaultSettings());

  for (const [id, def] of Object.entries(SITE_DEFS)) {
    if (!settings[id] || !settings[id].enabled) continue;
    const tabs = await chrome.tabs.query({ url: def.urlGlob });
    for (const tab of tabs) {
      try {
        // Chrome's Memory Saver discards background tabs, which itself can
        // drop the session. Bring a discarded tab back.
        if (tab.discarded) { await chrome.tabs.reload(tab.id); continue; }
        await chrome.tabs.sendMessage(tab.id, { type: 'KEEPALIVE_TICK' });
      } catch (e) { /* no content script in that tab yet */ }
    }
  }
});

async function bumpStats(site, patch) {
  const key = `stats_${site}`;
  const cur = (await chrome.storage.local.get({ [key]: {} }))[key] || {};
  await chrome.storage.local.set({ [key]: { ...cur, ...patch } });
}

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || !msg.site) return;
  if (msg.type === 'DID_NUDGE') {
    chrome.storage.local.get({ [`stats_${msg.site}`]: {} }).then((r) => {
      const cur = r[`stats_${msg.site}`] || {};
      bumpStats(msg.site, { lastNudge: Date.now(), nudges: (cur.nudges || 0) + 1 });
    });
  }
  if (msg.type === 'DIALOG_DISMISSED') {
    chrome.storage.local.get({ [`stats_${msg.site}`]: {} }).then((r) => {
      const cur = r[`stats_${msg.site}`] || {};
      bumpStats(msg.site, {
        lastDismiss: Date.now(),
        dismissals: (cur.dismissals || 0) + 1,
        lastDismissLabel: msg.label
      });
    });
  }
  if (msg.type === 'KEEPALIVE_RESULT') {
    bumpStats(msg.site, {
      lastFetch: Date.now(),
      lastFetchOk: msg.ok,
      lastFetchStatus: msg.status,
      loggedOut: msg.loggedOut
    });
  }
});
