import { mountShell } from '../lib/nav.js';
import { PROVIDERS, getAiSettings, listModels, pickDefaultModel } from '../lib/ai.js';
import { SUPPORT_URL, SUPPORT_LABEL } from '../lib/support.js';

mountShell('settings');

if (SUPPORT_URL) {
  document.getElementById('support').href = SUPPORT_URL;
  document.getElementById('support').textContent = SUPPORT_LABEL;
  document.getElementById('support-row').hidden = false;
}

const $ = (id) => document.getElementById(id);
let settings;

const save = () => chrome.storage.local.set({ ai: settings });

function message(text, kind = '') {
  $('ai-msg').className = `msg ${kind}`;
  $('ai-msg').textContent = text;
}

function fillModels(models) {
  $('models').replaceChildren(
    ...models.map((m) => Object.assign(document.createElement('option'), { value: m.id, label: m.label })),
  );
}

async function showProvider() {
  const p = settings.provider;
  const info = PROVIDERS[p];
  $('key-link').href = info.keyUrl;
  $('key').value = '';
  const saved = settings.keys[p];
  $('key').placeholder = saved ? `Saved (••••${saved.slice(-4)}). Paste a new key to replace it.` : info.keyHint;
  $('model').value = settings.models[p] ?? '';
  fillModels(info.suggested.map((id) => ({ id, label: id })));
  const granted = await chrome.permissions.contains({ origins: info.origins });
  if (saved && granted) message(`Connected to ${info.label}.`, 'ok');
  else if (saved) message('Click Connect to allow the extension to reach this provider.');
  else message('');
}

$('provider').append(
  ...Object.entries(PROVIDERS).map(([id, p]) => Object.assign(document.createElement('option'), { value: id, textContent: p.label })),
);

$('provider').addEventListener('change', async (e) => {
  settings.provider = e.target.value;
  await save();
  showProvider();
});

$('connect').addEventListener('click', async () => {
  const p = settings.provider;
  const key = $('key').value.trim() || settings.keys[p];
  if (!key) return message('Paste an API key first.', 'err');
  // Must be the first await so it still counts as a user gesture.
  const granted = await chrome.permissions.request({ origins: PROVIDERS[p].origins });
  if (!granted) return message('Permission is needed to contact the provider.', 'err');
  message('Checking key…');
  try {
    const models = await listModels(p, key);
    fillModels(models);
    settings.keys[p] = key;
    if (!settings.models[p] || !models.some((m) => m.id === settings.models[p])) {
      settings.models[p] = pickDefaultModel(p, models);
    }
    await save();
    $('key').value = '';
    await showProvider();
    message(`Connected. ${models.length} models available; using ${settings.models[p]}.`, 'ok');
  } catch (err) {
    message(err.message, 'err');
  }
});

$('model').addEventListener('change', async (e) => {
  settings.models[settings.provider] = e.target.value.trim();
  await save();
});

$('niche').addEventListener('change', async (e) => {
  settings.niche = e.target.value;
  await save();
});

$('disconnect').addEventListener('click', async () => {
  const p = settings.provider;
  delete settings.keys[p];
  await save();
  await chrome.permissions.remove({ origins: PROVIDERS[p].origins }).catch(() => {});
  showProvider();
});

// Tracking
async function showTracking() {
  const s = await chrome.storage.local.get(['trackDaily', 'ideasRefreshedAt']);
  $('trackDaily').checked = s.trackDaily !== false;
  $('refresh-msg').textContent = s.ideasRefreshedAt
    ? `Last refreshed ${new Date(s.ideasRefreshedAt).toLocaleString()}`
    : 'Not refreshed yet';
}

$('trackDaily').addEventListener('change', (e) => chrome.storage.local.set({ trackDaily: e.target.checked }));

$('refresh').addEventListener('click', async (e) => {
  e.target.disabled = true;
  $('refresh-msg').textContent = 'Refreshing…';
  const res = await chrome.runtime.sendMessage({ type: 'refreshIdeas' });
  e.target.disabled = false;
  if (!res?.ok) {
    $('refresh-msg').textContent = res?.error ?? 'Refresh failed.';
    return;
  }
  const { updated, missing, failed } = res.data;
  await showTracking();
  $('refresh-msg').textContent += ` · ${updated} updated${missing ? `, ${missing} no longer available` : ''}${failed ? `, ${failed} failed` : ''}`;
});

// ---------- Storage & data ----------

const send = (msg) =>
  chrome.runtime.sendMessage(msg).then((res) => {
    if (!res?.ok) throw new Error(res?.error ?? 'No response from extension.');
    return res.data;
  });

const fmtBytes = (b) =>
  b < 1024 ? `${b} B` : b < 1024 ** 2 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1024 ** 2).toFixed(1)} MB`;

function dataMessage(text, kind = 'ok') {
  $('data-msg').className = `msg ${kind}`;
  $('data-msg').textContent = text;
}

async function showUsage() {
  const u = await send({ type: 'storageUsage' });
  const detail = {
    ideas: `${u.ideas.items} ideas, ${u.ideas.snapshots} snapshots${u.ideas.unavailable ? `, ${u.ideas.unavailable} unavailable` : ''}`,
    transcripts: `${u.transcripts.items}${u.transcripts.orphans ? ` (${u.transcripts.orphans} unlinked)` : ''}`,
    heatmaps: `${u.heatmaps.items}${u.heatmaps.orphans ? ` (${u.heatmaps.orphans} unlinked)` : ''}`,
    explore: `${u.explore.holes} holes, ${u.explore.items} keywords`,
    ai: `${u.ai.items} lists, ${u.ideas.withAi} breakdowns`,
    watch: `${u.watch.items} channels, ${u.watch.feed} radar items`,
    webs: `${u.webs.items} webs`,
    comments: `${u.comments.items} videos`,
    projects: `${Object.keys(u.projects ?? {}).length ? u.projects.items : 0} items`,
    cache: `${u.cache.items} entries`,
    settings: `${u.settings.items} keys`,
  };
  $('usage').replaceChildren(
    ...Object.entries(detail).map(([id, text]) => {
      const tr = document.createElement('tr');
      for (const cell of [u[id].label, text, fmtBytes(u[id].bytes)]) {
        const td = document.createElement('td');
        td.textContent = cell;
        tr.append(td);
      }
      return tr;
    }),
  );
  $('usage-total').textContent = fmtBytes(u.total);
}

const DESCRIBE = {
  holes: (days) => (days ? `rabbit holes not touched in ${days} days` : 'all rabbit holes'),
  'history-older': (days) => `tracking snapshots older than ${days} days (the latest snapshot of each idea is kept)`,
  'ideas-unavailable': () => 'saved ideas whose videos were deleted or made private',
  'ideas-older': (days) => `saved ideas saved more than ${days} days ago, with their transcripts and heatmaps`,
  orphans: () => 'transcripts and heatmaps not linked to a saved idea',
  'transcripts-all': () => 'all saved transcripts',
  'heatmaps-all': () => 'all saved heatmaps',
  'ai-runs': () => 'all generated idea lists',
  'webs-all': () => 'all video webs',
  'comments-all': () => 'all saved comment research',
  'ai-breakdowns': () => 'AI breakdowns on all saved ideas',
  cache: () => 'the temporary API cache',
};

async function runCleanup(action, days = 0) {
  const what = DESCRIBE[action](days);
  if (action !== 'cache' && !confirm(`Delete ${what}? This can't be undone.`)) return;
  try {
    const n = await send({ type: 'cleanup', action, days });
    dataMessage(`Deleted ${n} item${n === 1 ? '' : 's'}: ${what}.`);
  } catch (err) {
    dataMessage(err.message, 'err');
  }
  showUsage();
}

document.querySelectorAll('[data-clean]').forEach((btn) =>
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    const kind = btn.dataset.clean;
    if (kind === 'holes') {
      const days = Number($('holes-days').value);
      return runCleanup(days ? 'holes-older' : 'holes-all', days);
    }
    if (kind === 'history-older') return runCleanup(kind, Number($('history-days').value));
    if (kind === 'ideas') {
      const [action, days] = $('ideas-which').value.split(':');
      return runCleanup(action, Number(days ?? 0));
    }
    if (kind === 'extras') return runCleanup($('extras-which').value);
    if (kind === 'ai') return runCleanup($('ai-which').value);
    return runCleanup(kind);
  }),
);

$('holeRetentionDays').addEventListener('change', (e) =>
  chrome.storage.local.set({ holeRetentionDays: Number(e.target.value) }),
);

$('backup').addEventListener('click', async () => {
  const backup = await send({ type: 'exportData' });
  const url = URL.createObjectURL(new Blob([JSON.stringify(backup)], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: `yt-toolkit-backup-${new Date().toISOString().slice(0, 10)}.json` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

$('restore').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const { ideasAdded, nodes } = await send({ type: 'importData', backup: JSON.parse(await file.text()) });
    dataMessage(`Restored: ${ideasAdded} new ideas, ${nodes} rabbit-hole keywords merged.`);
  } catch (err) {
    dataMessage(err.message, 'err');
  }
  showUsage();
});

$('wipe').addEventListener('click', async () => {
  if (!confirm('Delete ALL saved ideas, history, transcripts, heatmaps, rabbit holes and AI results? Settings and API keys are kept.')) return;
  if (!confirm('Really delete everything? Consider downloading a backup first.')) return;
  const n = await send({ type: 'cleanup', action: 'everything' });
  dataMessage(`Deleted ${n} items.`);
  showUsage();
});

const { holeRetentionDays = 180 } = await chrome.storage.local.get('holeRetentionDays');
$('holeRetentionDays').value = String(holeRetentionDays);
showUsage();

settings = await getAiSettings();
$('provider').value = settings.provider;
$('niche').value = settings.niche;
showProvider();
showTracking();
