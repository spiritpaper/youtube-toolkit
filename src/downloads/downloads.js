// Downloads: set up the optional companion app, download a link (any site the
// downloader supports) or a clip of it, and follow progress. The companion
// does the work; see src/background/companion.js.

import { mountShell } from '../lib/nav.js';
import { send, h, emptyState, ageText } from '../lib/ui.js';
import { parseTime } from '../lib/notes.js';
import { formatTime } from '../lib/stats.js';

mountShell('downloads');
const main = document.getElementById('main');
const params = new URLSearchParams(location.search);
const RELEASE = 'https://github.com/spiritpaper/youtube-toolkit/releases/latest/download/';
const ASSETS = [
  ['Windows', 'yt-toolkit-companion-windows-x64.zip'],
  ['Windows (ARM)', 'yt-toolkit-companion-windows-arm64.zip'],
  ['Mac (Apple silicon)', 'yt-toolkit-companion-macos-arm64.zip'],
  ['Mac (Intel)', 'yt-toolkit-companion-macos-x64.zip'],
  ['Linux', 'yt-toolkit-companion-linux-x64.tar.gz'],
  ['Linux (ARM)', 'yt-toolkit-companion-linux-arm64.tar.gz'],
];

let status = null; // companionHello result
let downloads = [];
let acknowledged = false;

// ---------- setup / status ----------

function idBox() {
  const id = chrome.runtime.id;
  const btn = h('button', { onclick: () => navigator.clipboard.writeText(id).then(() => (btn.textContent = 'Copied ✓')) }, 'Copy');
  return h('div', { class: 'idbox' }, h('span', {}, 'This extension\'s ID:'), h('code', {}, id), btn);
}

function setupCard() {
  if (!status?.enabled) {
    return h('section', { class: 'card' },
      h('h2', {}, 'Turn on video downloads'),
      h('p', {}, 'Downloads work through a small, separate companion app you install on your computer. It keeps a well-known open-source downloader up to date, runs it with a fixed, minimal set of options, and saves files to one folder. Nothing is installed until you choose to.'),
      h('button', { class: 'primary', onclick: enable }, 'Turn on downloads'),
      h('p', { class: 'muted small' }, 'Chrome will ask to let YT Toolkit "communicate with cooperating native applications": that\'s the companion.'));
  }
  if (status.error) {
    return h('section', { class: 'card' },
      h('div', { class: 'status' }, h('span', { class: 'dot warn' }), h('b', {}, 'Install the companion app'), h('span', { class: 'muted small' }, status.error)),
      h('ol', { class: 'steps' },
        h('li', {}, 'Download it for your computer:', h('div', { class: 'os-links' }, ASSETS.map(([label, file]) => h('a', { class: 'button-link', href: RELEASE + file }, label)))),
        h('li', {}, 'Unzip it and run ', h('code', {}, 'yt-toolkit-companion'), ' (on Windows, double-click ', h('code', {}, 'yt-toolkit-companion.exe'), '; on a Mac or Linux, run it in a terminal).'),
        h('li', {}, 'When it asks, paste this ID:', idBox()),
        h('li', {}, 'Come back and click ', h('b', {}, 'Check again'), '.')),
      h('div', { class: 'idbox' }, h('button', { class: 'primary', onclick: refresh }, 'Check again'), h('a', { href: 'https://github.com/spiritpaper/youtube-toolkit/blob/main/docs/guides/video-downloads.md', target: '_blank', rel: 'noopener' }, 'Setup guide')));
  }
  const s = status;
  return h('section', { class: 'card' },
    h('div', { class: 'status' }, h('span', { class: 'dot ok' }), h('b', {}, 'Ready'),
      h('span', { class: 'muted small' }, `Companion ${s.version} · downloader ${s.ytdlp || 'missing'} · ${s.ffmpeg ? '1080p and clips available' : 'no ffmpeg: single-file quality, no clips'}`)),
    h('p', { class: 'muted small' }, 'Saves to ', h('code', {}, s.folder)),
    h('div', { class: 'idbox' },
      h('button', { onclick: () => send({ type: 'downloadReveal' }) }, 'Open folder'),
      h('button', { onclick: async (e) => { e.target.disabled = true; e.target.textContent = 'Updating…'; await send({ type: 'downloaderUpdate' }); setTimeout(refresh, 8000); } }, 'Update the downloader')));
}

async function enable() {
  // Must be the first await, so it still counts as a click.
  const ok = await chrome.permissions.request({ permissions: ['nativeMessaging'] }).catch(() => false);
  if (!ok) return;
  await chrome.storage.local.set({ downloadsEnabled: true });
  refresh();
}

// ---------- rights notice ----------

function noticeCard() {
  const box = h('input', { type: 'checkbox' });
  const btn = h('button', { class: 'primary', disabled: true }, 'Continue');
  box.addEventListener('change', () => (btn.disabled = !box.checked));
  btn.addEventListener('click', async () => {
    await chrome.storage.local.set({ downloadsAcknowledged: true });
    acknowledged = true;
    render();
  });
  return h('section', { class: 'card notice' },
    h('h2', {}, 'Before your first download'),
    h('p', {}, 'Only download videos you own or have permission to use: your own uploads, Creative Commons or public-domain footage, or with the creator\'s permission. YouTube, X and most platforms only allow downloading where they offer it themselves or you have the rights.'),
    h('label', {}, box, h('span', {}, 'I\'ll only download videos I own or have permission to use.')),
    btn);
}

// ---------- the form ----------

function formCard() {
  const url = h('input', { type: 'url', placeholder: 'Paste a link: YouTube, X, and most video sites', value: params.get('url') ?? '', 'aria-label': 'Video link', required: true });
  const kind = h('select', { 'aria-label': 'What to save' }, h('option', { value: 'video' }, 'Video'), h('option', { value: 'audio' }, 'Audio only'));
  const start = h('input', { placeholder: '0:00', value: params.get('start') ? formatTime(Number(params.get('start'))) : '', 'aria-label': 'Clip start' });
  const end = h('input', { placeholder: '0:45', value: params.get('end') ? formatTime(Number(params.get('end'))) : '', 'aria-label': 'Clip end' });
  const msg = h('p', { class: 'error small', hidden: true });
  const go = h('button', { class: 'primary', type: 'submit' }, 'Download');
  const form = h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      msg.hidden = true;
      const s = start.value.trim() ? parseTime(start.value) : null;
      const en = end.value.trim() ? parseTime(end.value) : null;
      if ((s == null) !== (en == null) || (s != null && en <= s)) {
        msg.textContent = 'For a clip, give a start and a later end (like 1:05 and 1:40). Leave both empty for the whole video.';
        msg.hidden = false;
        return;
      }
      try {
        await send({ type: 'downloadStart', url: url.value.trim(), kind: kind.value, start: s, end: en, title: params.get('title') ?? '' });
        url.value = '';
        start.value = '';
        end.value = '';
        history.replaceState(null, '', location.pathname);
      } catch (err) {
        msg.textContent = err.message;
        msg.hidden = false;
      }
    },
  }, h('div', { class: 'form' }, url, kind, go),
  h('div', { class: 'clip' }, 'Only a clip (optional):', start, 'to', end, status?.ffmpeg === false && h('span', {}, '· needs ffmpeg')),
  msg);
  return h('section', { class: 'card' }, h('h2', {}, 'Download'), form);
}

// ---------- the list ----------

const label = (d) => d.title || d.file?.split(/[\\/]/).pop() || d.url;
function row(d) {
  const clip = d.start != null ? ` · clip ${formatTime(d.start)}–${formatTime(d.end)}` : '';
  const meta = {
    queued: 'Starting…',
    running: `${d.percent?.toFixed(0) ?? 0}%${d.speed ? ` · ${d.speed}` : ''}${d.eta ? ` · ${d.eta} left` : ''}`,
    done: `Saved ${ageText(d.finishedAt ?? d.at)}`,
    error: d.error,
    cancelled: 'Cancelled',
  }[d.status];
  return h('div', { class: `row ${d.status}` },
    h('div', { style: 'min-width:0' },
      h('div', { class: 't', title: d.url }, label(d)),
      h('div', { class: `m${d.status === 'error' ? ' err' : ''}` }, `${d.kind === 'audio' ? 'Audio' : 'Video'}${clip} · ${meta}`)),
    h('div', { class: 'acts' },
      (d.status === 'running' || d.status === 'queued') && h('button', { onclick: () => send({ type: 'downloadCancel', job: d.job }) }, 'Cancel'),
      d.status === 'done' && h('button', { onclick: () => send({ type: 'downloadReveal', file: d.file }) }, 'Show in folder'),
      (d.status === 'error' || d.status === 'cancelled') && h('button', { onclick: () => send({ type: 'downloadStart', url: d.url, kind: d.kind, start: d.start, end: d.end, title: d.title }).catch((e) => alert(e.message)) }, 'Retry')),
    (d.status === 'running' || d.status === 'queued' || d.status === 'done') && h('div', { class: 'bar' }, h('div', { style: `width:${d.status === 'done' ? 100 : d.percent ?? 0}%` })));
}

function listCard() {
  const finished = downloads.some((d) => !['running', 'queued'].includes(d.status));
  return h('section', { class: 'card' },
    h('div', { class: 'status' }, h('h2', { style: 'margin:0;flex:1' }, 'Recent downloads'), finished && h('button', { onclick: () => send({ type: 'downloadsClear' }) }, 'Clear finished')),
    downloads.length
      ? h('div', { class: 'list' }, downloads.map(row))
      : emptyState('Nothing downloaded yet', 'Paste a link above, or use Download in the YT Toolkit panel on YouTube. Clips from the Script lab\'s Shorts card land here too.'));
}

// ---------- page ----------

let listEl = null;
function render() {
  const ready = status?.enabled && !status.error;
  listEl = ready ? listCard() : null;
  main.replaceChildren(setupCard(), ...(ready ? [acknowledged ? formCard() : noticeCard(), listEl] : []));
}

async function refresh() {
  main.replaceChildren(h('div', { class: 'loading' }, 'Checking the companion…'));
  [status, { downloads = [], downloadsAcknowledged: acknowledged = false }] = await Promise.all([
    send({ type: 'companionHello' }).catch((err) => ({ enabled: true, error: err.message })),
    chrome.storage.local.get(['downloads', 'downloadsAcknowledged']),
  ]);
  render();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.downloads) return;
  downloads = changes.downloads.newValue ?? [];
  if (listEl?.isConnected) {
    const fresh = listCard();
    listEl.replaceWith(fresh);
    listEl = fresh;
  }
});

refresh();
