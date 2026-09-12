const cardsEl = document.getElementById('cards');

function ago(ts) {
  if (!ts) return 'never';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

function strategyText(def) {
  const parts = [];
  if (def.useEvents) parts.push('synthetic pointer + Shift-key activity');
  if (def.useKeepaliveFetch) parts.push('silent background fetch (resets the server session clock)');
  return parts.join(' · ');
}

function buildCard(id, def) {
  const card = document.createElement('div');
  card.className = `card ${id}`;
  card.innerHTML = `
    <div class="head">
      <span class="name">${def.label}</span>
      <label class="switch" for="en-${id}">
        <input type="checkbox" id="en-${id}" />
        <span class="slider"></span>
      </label>
    </div>
    <div class="strategy">${strategyText(def)}</div>
    <div class="row">
      <label for="rg-${id}">Nudge randomly every</label>
      <select id="rg-${id}">
        ${Object.entries(def.ranges)
          .map(([k, r]) => `<option value="${k}">${r.label}</option>`).join('')}
      </select>
    </div>
    <div class="ceiling">${def.ceilingNote}</div>
    <div class="stats" id="st-${id}">…</div>
  `;
  cardsEl.appendChild(card);

  card.querySelector(`#en-${id}`).addEventListener('change', async (e) => {
    const cur = (await chrome.storage.local.get(defaultSettings()))[id];
    await chrome.storage.local.set({ [id]: { ...cur, enabled: e.target.checked } });
    render();
  });
  card.querySelector(`#rg-${id}`).addEventListener('change', async (e) => {
    const cur = (await chrome.storage.local.get(defaultSettings()))[id];
    await chrome.storage.local.set({ [id]: { ...cur, range: e.target.value } });
    render();
  });
}

async function render() {
  const settings = await chrome.storage.local.get(defaultSettings());

  for (const [id, def] of Object.entries(SITE_DEFS)) {
    const cfg = settings[id] || { enabled: true, range: def.defaultRange };
    document.getElementById(`en-${id}`).checked = cfg.enabled;
    document.getElementById(`rg-${id}`).value = cfg.range;

    const stats = (await chrome.storage.local.get({ [`stats_${id}`]: {} }))[`stats_${id}`] || {};
    const tabs = await chrome.tabs.query({ url: def.urlGlob });

    let html = `${cfg.enabled ? 'Running' : 'Paused'} · ${tabs.length} tab${tabs.length === 1 ? '' : 's'} open<br>`;
    html += `Last nudge: ${ago(stats.lastNudge)} · total ${stats.nudges || 0}`;

    if (def.useKeepaliveFetch) {
      html += `<br>Last keepalive: ${ago(stats.lastFetch)}`;
      if (stats.lastFetch) {
        html += stats.lastFetchOk
          ? ` · ok (${stats.lastFetchStatus})`
          : ` · <span class="warn">failed (${stats.lastFetchStatus || 'network'})</span>`;
      }
      if (stats.loggedOut) html += `<br><span class="warn">Session appears signed out</span>`;
    }
    document.getElementById(`st-${id}`).innerHTML = html;
  }
}

for (const [id, def] of Object.entries(SITE_DEFS)) buildCard(id, def);
render();
setInterval(render, 5000);
