const cardsEl = document.getElementById('cards');

// Read the version from the manifest rather than hard-coding it in the markup,
// so the badge can't fall out of step with the build after a version bump.
// The repo URL comes from manifest.homepage_url for the same reason — one place
// to change it, and Chrome also shows it on chrome://extensions.
(() => {
  const verEl = document.getElementById('ver');
  try {
    const m = chrome.runtime.getManifest();
    if (verEl) verEl.textContent = 'v' + m.version;
    if (m.homepage_url) {
      for (const el of document.querySelectorAll('#ver, .by')) el.href = m.homepage_url;
    }
  } catch (e) {
    // getManifest() failed (orphaned context). Drop the badge rather than
    // leaving the "v…" placeholder on screen. The original catch called
    // .remove() on the same lookup that had just failed, which would throw.
    if (verEl && verEl.remove) verEl.remove();
  }
})();

function ago(ts) {
  if (!ts) return 'never';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

function strategyText(def) {
  // Ordered by what actually holds the session, not by layer number.
  const parts = [];
  if (def.idleDialog) parts.push('answers the idle-timeout dialog');
  if (def.useEvents) parts.push('synthetic pointer + Shift-key activity');
  if (def.useKeepaliveFetch) parts.push('silent background fetch');
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
    ${def.idleDialog ? `
    <label class="check">
      <input type="checkbox" id="ad-${id}" />
      <span>Auto-answer the “still working?” dialog</span>
    </label>` : ''}
    <label class="check">
      <input type="checkbox" id="kf-${id}" />
      <span>Keepalive fetch${def.fetchAuditWarning ? ` <em>— ${def.fetchAuditWarning}</em>` : ''}</span>
    </label>
    <label class="check">
      <input type="checkbox" id="rv-${id}" />
      <span>Reload tab if Chrome discards it <em>— counts as a fresh sign-in</em></span>
    </label>
    <div class="rangewarn" id="wn-${id}" hidden></div>
    <div class="stats" id="st-${id}">…</div>
    <button class="reset" id="rs-${id}" type="button">Reset status</button>
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

  card.querySelector(`#rs-${id}`).addEventListener('click', async () => {
    await chrome.storage.local.set({ [`stats_${id}`]: {} });
    render();
  });

  card.querySelector(`#kf-${id}`).addEventListener('change', async (e) => {
    const cur = (await chrome.storage.local.get(defaultSettings()))[id];
    await chrome.storage.local.set({ [id]: { ...cur, useFetch: e.target.checked } });
    render();
  });

  card.querySelector(`#rv-${id}`).addEventListener('change', async (e) => {
    const cur = (await chrome.storage.local.get(defaultSettings()))[id];
    await chrome.storage.local.set({ [id]: { ...cur, reviveDiscarded: e.target.checked } });
    render();
  });

  const adEl = card.querySelector(`#ad-${id}`);
  if (adEl) {
    adEl.addEventListener('change', async (e) => {
      const cur = (await chrome.storage.local.get(defaultSettings()))[id];
      await chrome.storage.local.set({ [id]: { ...cur, autoDismiss: e.target.checked } });
      render();
    });
  }
}

let rendering = false;

async function render() {
  // The 5s interval could previously overlap a slow render with the next one.
  if (rendering) return;
  rendering = true;
  try {
    await renderOnce();
  } finally {
    rendering = false;
  }
}

async function renderOnce() {
  const ids = Object.keys(SITE_DEFS);

  // One storage read for everything, and the tab queries in parallel.
  // Previously this was 1 + N sequential storage reads plus N sequential tab
  // queries, every 5 seconds, for the whole time the popup was open.
  const wanted = { ...defaultSettings() };
  for (const id of ids) wanted[`stats_${id}`] = {};

  const [store, tabCounts] = await Promise.all([
    chrome.storage.local.get(wanted),
    Promise.all(ids.map((id) =>
      chrome.tabs.query({ url: globsFor(SITE_DEFS[id]) })
        .then((t) => t.length)
        .catch(() => 0)
    ))
  ]);

  const settings = store;

  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const def = SITE_DEFS[id];
    const tabCount = tabCounts[i];
    const cfg = settings[id] || { enabled: false, range: def.defaultRange };
    document.getElementById(`en-${id}`).checked = cfg.enabled;
    document.getElementById(`rg-${id}`).value = cfg.range;
    const adEl = document.getElementById(`ad-${id}`);
    if (adEl) adEl.checked = cfg.autoDismiss !== false;
    const useFetch = typeof cfg.useFetch === 'boolean' ? cfg.useFetch : !!def.useKeepaliveFetch;
    document.getElementById(`kf-${id}`).checked = useFetch;
    document.getElementById(`rv-${id}`).checked =
      typeof cfg.reviveDiscarded === 'boolean' ? cfg.reviveDiscarded : !!def.useKeepaliveFetch;

    // Surface the caution attached to the widest ("max") range.
    const warnEl = document.getElementById(`wn-${id}`);
    const chosen = def.ranges[cfg.range];
    if (chosen && chosen.warn) {
      warnEl.textContent = chosen.warn;
      warnEl.hidden = false;
    } else {
      warnEl.hidden = true;
    }

    const stats = settings[`stats_${id}`] || {};

    let html = `${cfg.enabled ? 'Running' : 'Paused'} · ${tabCount} tab${tabCount === 1 ? '' : 's'} open<br>`;
    html += `Last nudge: ${ago(stats.lastNudge)} · total ${stats.nudges || 0}`;

    if (useFetch) {
      // A health verdict is only meaningful while it's current. Expire it after
      // 3x the maximum nudge interval (plus the fetch cadence) rather than
      // leaving a red alarm on screen indefinitely — a stale failure was
      // previously indistinguishable from an ongoing one.
      const r = def.ranges[cfg.range] || def.ranges[def.defaultRange];
      const expectedMs = r.max * (def.fetchEveryNthNudge || 3) * 60 * 1000;
      const staleAfter = Math.max(expectedMs * 3, 15 * 60 * 1000);
      const isStale = !stats.lastFetch || (Date.now() - stats.lastFetch) > staleAfter;

      html += `<br>Last keepalive: ${ago(stats.lastFetch)}`;
      if (stats.lastFetch && !isStale) {
        html += stats.lastFetchOk
          ? ` · ok (${stats.lastFetchStatus})`
          : ` · <span class="warn">failed (${stats.lastFetchStatus || 'network'})</span>`;
      } else if (stats.lastFetch) {
        html += ` · <span class="stale">no recent check</span>`;
      }

      if (stats.loggedOut && !isStale) {
        html += `<br><span class="warn">Session appears signed out</span>`;
        if (stats.lastFetchUrl) {
          try {
            html += `<br><span class="stale">reported by ${new URL(stats.lastFetchUrl).host}</span>`;
          } catch (e) { /* no-op */ }
        }
      }
    }

    if (def.idleDialog) {
      html += `<br>Dialogs answered: ${stats.dismissals || 0}`;
      if (stats.lastDismiss) html += ` · last ${ago(stats.lastDismiss)}`;
    }
    document.getElementById(`st-${id}`).innerHTML = html;
  }
}

for (const [id, def] of Object.entries(SITE_DEFS)) buildCard(id, def);
render();
setInterval(render, 5000);
