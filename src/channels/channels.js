import { mountShell } from '../lib/nav.js';
import { send, h, fmtNum, fmtMult, fmtPct, tier, ageText, videoUrl, skeletons } from '../lib/ui.js';
import { channelGrowth } from '../lib/stats.js';
import { lineChart } from '../lib/linechart.js';

mountShell('following');
const $ = (id) => document.getElementById(id);
let rows = [];
let filter = '';
let saved = new Set();

const TREND = { growing: '↑ growing', stable: '→ stable', declining: '↓ declining' };
const signed = (n) => (n == null ? '—' : `${n > 0 ? '+' : ''}${fmtNum(n)}`);

function stat(k, v, cls = '', title) {
  return h('div', { title }, h('span', { class: 'k' }, k), h('b', { class: cls }, v));
}

function growthCharts(ch) {
  const hist = ch.history ?? [];
  if (hist.length < 2) return h('p', { class: 'muted small' }, 'Growth charts appear after a few days of tracking (the radar records a snapshot each day).');
  const day = (t) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const chart = (label, key) =>
    lineChart({ label, height: 140, series: [{ name: label, color: 'var(--series-1)', points: hist.filter((s) => s[key] != null).map((s) => ({ x: s.t, y: s[key] })) }], xFormat: day, yFormat: fmtNum, yMin: Math.min(...hist.map((s) => s[key] ?? Infinity)) * 0.98, area: true });
  return h('div', {}, h('h4', {}, 'Subscribers'), chart('Subscribers', 'subs'), h('h4', { style: 'margin-top:10px' }, 'Median views per video'), chart('Median views', 'medianLong'));
}

function card(ch) {
  if (ch.error) {
    return h('section', { class: 'ch', id: `ch-${ch.id}` }, h('div', { class: 'ch-head' }, h('b', {}, ch.title ?? ch.id), h('span', { class: 'error' }, ch.error)));
  }
  const p = ch.profile;
  const g30 = channelGrowth(ch.history, 30);
  const last = ch.uploads[0];
  return h(
    'section',
    { class: 'ch', id: `ch-${ch.id}` },
    h(
      'div',
      { class: 'ch-head' },
      p.thumb && h('img', { src: p.thumb, alt: '' }),
      h('div', { class: 'grow' },
        h('a', { class: 'name', href: `https://www.youtube.com/channel/${ch.id}`, target: '_blank' }, p.title),
        h('div', { class: 'muted small' }, [p.handle, last && `last upload ${ageText(last.publishedAt)}`, `following since ${new Date(ch.addedAt).toLocaleDateString()}`].filter(Boolean).join(' · ')),
        ch.staleSince && h('div', { class: 'stale small', title: ch.staleReason ?? '' }, `Showing data from ${ageText(ch.staleSince)}. Couldn't refresh: ${ch.staleReason ?? 'unknown error'}`)),
      h('select', {
        'aria-label': 'Why you follow this channel',
        onchange: (e) => send({ type: 'updateFollow', id: ch.id, patch: { role: e.target.value } }),
      }, h('option', { value: 'learn', selected: ch.role !== 'competitor' }, 'Learn from'), h('option', { value: 'competitor', selected: ch.role === 'competitor' }, 'Competitor')),
      h('button', { class: 'x', title: 'Unfollow', onclick: async () => { if (confirm(`Unfollow ${p.title}?`)) { await send({ type: 'unwatch', id: ch.id }); load(); } } }, '✕'),
    ),
    h(
      'div',
      { class: 'stats' },
      stat('Subscribers', fmtNum(p.subs)),
      stat('30-day change', g30 ? signed(g30.subs) : '—', g30?.subs > 0 ? 'up' : g30?.subs < 0 ? 'down' : '', g30 ? `over ${Math.round(g30.days)} days of tracking` : 'needs a few days of tracking'),
      stat('Median views', fmtNum(p.medianLong), '', 'Median of the last 30 long-form videos'),
      stat('Shorts median', fmtNum(p.medianShort)),
      stat('Uploads / week', p.uploadsPerWeek == null ? '—' : p.uploadsPerWeek.toFixed(1)),
      stat('Hit rate', fmtPct(p.hitRate), '', 'Share of recent videos at 2x+ the channel median'),
      stat('Trend', TREND[p.trend] ?? '—', p.trend === 'growing' ? 'up' : p.trend === 'declining' ? 'down' : ''),
    ),
    h('div', { class: 'uploads' }, ch.uploads.slice(0, 6).map((v) =>
      h('a', { class: 'up-card', href: videoUrl(v), target: '_blank', title: v.title },
        h('img', { src: v.thumb, alt: '', loading: 'lazy' }),
        h('span', { class: `pill tier-${tier(v.multiplier)}` }, fmtMult(v.multiplier)),
        h('div', { class: 't' }, v.title ?? v.id),
        h('div', { class: 'm' }, `${fmtNum(v.views)} views · ${ageText(v.publishedAt)}${saved.has(v.id) ? ' · ★ saved' : ''}`)))),
    h(
      'details',
      {},
      h('summary', {}, 'Growth & notes'),
      h('div', { class: 'detail' },
        growthCharts(ch),
        h('div', {}, h('h4', {}, 'Your notes'), h('textarea', {
          placeholder: 'What to learn from this channel: formats, hooks, thumbnail style…',
          value: ch.notes ?? '',
          onchange: (e) => send({ type: 'updateFollow', id: ch.id, patch: { notes: e.target.value } }),
        }))),
    ),
  );
}

function render() {
  const sort = $('sort').value;
  const key = {
    upload: (c) => new Date(c.uploads?.[0]?.publishedAt ?? 0).getTime(),
    growth: (c) => channelGrowth(c.history, 30)?.subs ?? -Infinity,
    median: (c) => c.profile?.medianLong ?? -1,
    hit: (c) => c.profile?.hitRate ?? -1,
  }[sort];
  const list = rows.filter((c) => !filter || (c.role ?? 'learn') === filter).sort((a, b) => key(b) - key(a));
  $('sub').textContent = `${rows.length} channel${rows.length === 1 ? '' : 's'} · ${rows.filter((r) => r.role !== 'competitor').length} to learn from · ${rows.filter((r) => r.role === 'competitor').length} competitors`;
  $('list').replaceChildren(
    ...(list.length
      ? list.map(card)
      : [h('div', { class: 'empty-state' }, h('h2', {}, 'Follow channels you want to learn from'), h('p', {}, 'Paste a channel above, or click Follow in the YT Toolkit panel on any YouTube video or channel page. Followed channels are tracked daily (growth, uploads, outliers) and feed Compare, Content gaps and the Radar.'))]),
  );
}

async function load() {
  if (!rows.length) $('list').replaceChildren(skeletons(3));
  try {
    rows = await send({ type: 'following' });
  } catch (err) {
    $('list').replaceChildren(h('div', { class: 'empty-state error' }, err.message));
    return;
  }
  const { radarCheckedAt } = await chrome.storage.local.get('radarCheckedAt');
  $('checked').textContent = radarCheckedAt ? `Updated daily · last ${new Date(radarCheckedAt).toLocaleString()}` : 'Updated daily';
  render();
  // Opened from quick search: #ch-<channel id>.
  const target = location.hash && document.getElementById(location.hash.slice(1));
  if (target) {
    target.scrollIntoView({ block: 'start' });
    target.classList.add('flash');
  }
}

$('add').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.submitter;
  btn.disabled = true;
  btn.textContent = 'Following…';
  try {
    await send({ type: 'watch', input: $('add-input').value, role: $('add-role').value });
    $('add-input').value = '';
    await load();
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Follow';
  }
});
for (const b of document.querySelectorAll('#filter button')) {
  b.addEventListener('click', () => {
    filter = b.dataset.f;
    for (const x of document.querySelectorAll('#filter button')) x.classList.toggle('on', x === b);
    render();
  });
}
$('sort').addEventListener('change', render);
$('refresh').addEventListener('click', async (e) => {
  e.target.disabled = true;
  e.target.textContent = 'Refreshing…';
  try {
    await send({ type: 'radarCheck' });
  } catch (err) {
    alert(err.message);
  }
  e.target.disabled = false;
  e.target.textContent = 'Refresh now';
  load();
});

saved = new Set(await send({ type: 'savedIds' }).catch(() => []));
load();
