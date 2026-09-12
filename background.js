// Session Keeper — background service worker
importScripts('sites.js');

const ALARM_NAME = 'session-keeper-tick';

async function initSettings() {
  const defs = defaultSettings();
  const current = await chrome.storage.local.get(defs);
  await chrome.storage.local.set({ ...defs, ...current });
}

function scheduleAlarm() {
  // 30s is Chrome's floor. The content script does the real timing; this just
  // guarantees it gets woken up even when the tab is in the background.
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: 0.5 });
}

chrome.runtime.onInstalled.addListener(async () => { await initSettings(); scheduleAlarm(); });
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
  if (msg.type === 'KEEPALIVE_RESULT') {
    bumpStats(msg.site, {
      lastFetch: Date.now(),
      lastFetchOk: msg.ok,
      lastFetchStatus: msg.status,
      loggedOut: msg.loggedOut
    });
  }
});
