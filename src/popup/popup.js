import { SUPPORT_URL, SUPPORT_LABEL } from '../lib/support.js';

const $ = (id) => document.getElementById(id);

function send(msg) {
  return chrome.runtime.sendMessage(msg).then((res) => {
    if (!res?.ok) throw new Error(res?.error ?? 'No response from extension.');
    return res.data;
  });
}

async function renderKey() {
  const { apiKey } = await chrome.storage.local.get('apiKey');
  $('key-setup').hidden = !!apiKey;
  $('key-ok').hidden = !apiKey;
  if (apiKey) {
    $('key-mask').textContent = `••••${apiKey.slice(-4)}`;
    const { used, limit } = await send({ type: 'quota' });
    $('quota-text').textContent = `${used.toLocaleString()} / ${limit.toLocaleString()}`;
    const pct = Math.min(100, (used / limit) * 100);
    $('quota-bar').style.width = `${pct}%`;
    $('quota-bar').classList.toggle('warn', pct > 80);
  }
}

$('key-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const key = $('key-input').value.trim();
  const msg = $('key-msg');
  msg.className = 'msg';
  msg.textContent = 'Checking key…';
  try {
    await send({ type: 'testKey', key });
    await chrome.storage.local.set({ apiKey: key });
    $('key-input').value = '';
    msg.className = 'msg ok';
    msg.textContent = 'Key works. Reload YouTube tabs to see stats.';
    await renderKey();
  } catch (err) {
    msg.className = 'msg err';
    msg.textContent = err.message;
  }
});

$('key-change').addEventListener('click', () => {
  $('key-setup').hidden = false;
  $('key-ok').hidden = true;
  $('key-input').focus();
});

async function renderSettings() {
  const s = await chrome.storage.local.get(['badges', 'watchPanel', 'badgeMin']);
  $('opt-badges').checked = s.badges !== false;
  $('opt-watchPanel').checked = s.watchPanel !== false;
  $('opt-badgeMin').value = String(s.badgeMin ?? 0);
}

$('opt-badges').addEventListener('change', (e) => chrome.storage.local.set({ badges: e.target.checked }));
$('opt-watchPanel').addEventListener('change', (e) => chrome.storage.local.set({ watchPanel: e.target.checked }));
$('opt-badgeMin').addEventListener('change', (e) => chrome.storage.local.set({ badgeMin: Number(e.target.value) }));

const page = (p) => chrome.runtime.getURL(`src/${p}`);
$('open-home').addEventListener('click', () => chrome.tabs.create({ url: page('home/home.html') }));
$('dig').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = $('dig-q').value.trim();
  chrome.tabs.create({ url: page(q ? `explore/explore.html?q=${encodeURIComponent(q)}` : 'explore/explore.html') });
});
$('open-settings').addEventListener('click', () => chrome.runtime.openOptionsPage());
chrome.storage.local.get('radar').then(({ radar = [] }) => {
  const unread = radar.filter((r) => !r.read).length;
  if (!unread) return;
  $('radar-line').hidden = false;
  $('radar-line').textContent = `● ${unread} new outlier${unread === 1 ? '' : 's'} from channels you follow →`;
  $('radar-line').href = '#';
  $('radar-line').addEventListener('click', () => chrome.tabs.create({ url: page('studio/studio.html#radar') }));
});

$('clear-cache').addEventListener('click', async (e) => {
  const n = await send({ type: 'clearCache' });
  e.target.textContent = `Cleared ${n}`;
  setTimeout(() => (e.target.textContent = 'Clear cache'), 1500);
});

renderKey();
renderSettings();

if (SUPPORT_URL) {
  $('support').href = SUPPORT_URL;
  $('support').textContent = `♥ ${SUPPORT_LABEL}`;
  $('support').hidden = false;
}
