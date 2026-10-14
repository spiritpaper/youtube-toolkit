import { mountShell } from '../lib/nav.js';
import { listIdeas } from '../lib/ideas.js';
import { toCsv, median, trackingStats, heatmapSummary, formatTime } from '../lib/stats.js';
import { activeAi, generate, breakdownPrompt, ideasPrompt, remixPrompt, thumbnailImage, PROVIDERS } from '../lib/ai.js';
import { markdownToHtml } from '../lib/markdown.js';
import { send, h, fmtNum, fmtMult, fmtPct, fmtDate, isoDate, round, tier, rank, videoUrl, download } from '../lib/ui.js';
import { heatmapSvg } from '../lib/heatmap-view.js';

mountShell('ideas');

const $ = (id) => document.getElementById(id);
let ideas = {};
let heatmaps = {}; // videoId -> { points }
let transcripts = {}; // videoId -> { segments }
let pendingRender = false;

// Heatmaps and transcripts are stored per video (hm:<id>, tx:<id>).
async function loadExtras() {
  const ids = Object.keys(ideas);
  const data = await chrome.storage.local.get(ids.flatMap((id) => [`hm:${id}`, `tx:${id}`]));
  heatmaps = {};
  transcripts = {};
  for (const [k, v] of Object.entries(data)) (k.startsWith('hm:') ? heatmaps : transcripts)[k.slice(3)] = v;
}

const transcriptText = (i, tx) =>
  [i.title, videoUrl(i), '', ...tx.segments.map((s) => `[${formatTime(s.start)}] ${s.text}`)].join('\n');

// ---------- helpers ----------

const signed = (n) => (n > 0 ? `+${fmtNum(n)}` : fmtNum(n));
const TREND = {
  growing: { arrow: '↑', cls: 'up' },
  stable: { arrow: '→', cls: '' },
  declining: { arrow: '↓', cls: 'down' },
};
const mult = (i) => i.stats?.multiplier ?? i.multiplier ?? null;

function notice(text, kind = '') {
  $('notice').hidden = !text;
  $('notice').className = `notice ${kind}`;
  $('notice').textContent = text ?? '';
}

// ---------- filtering ----------

function visible() {
  const q = $('q').value.trim().toLowerCase();
  const format = $('format').value;
  const trend = $('trend').value;
  const sort = $('sort').value;
  const list = Object.values(ideas).filter((i) => {
    if (format && i.format !== format) return false;
    if (trend && i.stats?.trend !== trend) return false;
    if (!q) return true;
    return [i.title, i.channelTitle, i.notes, ...(i.tags ?? [])].some((s) => s?.toLowerCase().includes(q));
  });
  const gained = (i) => trackingStats(i.history)?.viewsGained ?? -1;
  const by = {
    saved: (a, b) => b.savedAt - a.savedAt,
    mult: (a, b) => (mult(b) ?? -1) - (mult(a) ?? -1),
    percentile: (a, b) => (b.stats?.percentile ?? -1) - (a.stats?.percentile ?? -1),
    views: (a, b) => (b.views ?? -1) - (a.views ?? -1),
    gained: (a, b) => gained(b) - gained(a),
    published: (a, b) => new Date(b.publishedAt) - new Date(a.publishedAt),
  }[sort];
  return list.sort(by);
}

// ---------- insights ----------

function statCard(k, v, s, cls = '') {
  return h('div', { class: 'stat' }, h('div', { class: 'k' }, k), h('div', { class: `v ${cls}` }, v), s && h('div', { class: 's' }, s));
}

function renderInsights(all) {
  if (!all.length) return $('insights').replaceChildren();
  const withStats = all.filter((i) => i.stats);
  const beat = withStats.filter((i) => i.stats.aboveAverage).length;
  const medMult = median(all.map(mult));
  const medPct = median(withStats.map((i) => i.stats.percentile));

  // One trend per channel (latest snapshot wins).
  const channelTrends = new Map();
  for (const i of withStats) if (i.stats.trend) channelTrends.set(i.channelId, i.stats.trend);
  const count = (t) => [...channelTrends.values()].filter((x) => x === t).length;

  const tracked = all.map((i) => trackingStats(i.history)).filter(Boolean);
  const medPerDay = median(tracked.map((t) => t.viewsPerDay));

  $('insights').replaceChildren(
    statCard(
      'Beat their channel average',
      withStats.length ? `${beat} / ${withStats.length}` : '—',
      withStats.length ? `${fmtPct(beat / withStats.length)} of ideas with stats` : 'Refresh to compute',
    ),
    statCard('Median outlier score', fmtMult(medMult), 'vs channel median'),
    statCard('Median channel rank', medPct == null ? '—' : rank(medPct), "among each channel's recent videos"),
    statCard(
      'Channels',
      channelTrends.size ? `↑${count('growing')}  →${count('stable')}  ↓${count('declining')}` : '—',
      'growing · stable · declining',
    ),
    statCard(
      'Since saving',
      medPerDay == null ? '—' : `${fmtNum(medPerDay)}/day`,
      tracked.length ? `median views gained, ${tracked.length} tracked` : 'Needs 2+ snapshots',
    ),
  );
}

// ---------- cards ----------

function chips(i) {
  const s = i.stats;
  const t = trackingStats(i.history);
  const out = [];
  if (s?.percentile != null) out.push(h('span', { class: 'chip', title: "Rank among the channel's recent videos" }, rank(s.percentile)));
  if (s?.vsAverage != null) out.push(h('span', { class: `chip ${s.aboveAverage ? 'up' : 'down'}`, title: 'Views vs channel average' }, `${fmtMult(s.vsAverage)} avg`));
  if (s?.trend) {
    const tr = TREND[s.trend];
    out.push(
      h('span', { class: `chip ${tr.cls}`, title: `Recent uploads get ${fmtMult(s.momentum)} the views of earlier ones` }, `Channel ${tr.arrow} ${s.trend}`),
    );
  }
  if (s?.likeRateVsChannel != null) out.push(h('span', { class: `chip ${s.likeRateVsChannel >= 1 ? 'up' : ''}`, title: 'Like rate vs channel typical' }, `${fmtMult(s.likeRateVsChannel)} likes`));
  if (t?.viewsGained != null) out.push(h('span', { class: 'chip', title: `Since ${fmtDate(i.history[0].t)}` }, `${signed(t.viewsGained)} views in ${Math.max(1, Math.round(t.days))}d`));
  return out.length ? h('div', { class: 'chips' }, out) : null;
}

function heatBlock(i) {
  const hm = heatmaps[i.id];
  if (!hm?.points?.length) return null;
  const sum = heatmapSummary(hm.points);
  return h(
    'div',
    { class: 'heat', title: "YouTube's \"Most replayed\" heatmap (relative replays, not the creator's retention curve)" },
    heatmapSvg(hm.points, { peaks: sum.peaks }),
    h('div', { class: 'meta' }, `Most replayed: ${sum.peaks.map((p) => formatTime(p.start)).join(', ') || '—'}`),
  );
}

function mdBlock(text) {
  const div = h('div', { class: 'md' });
  div.innerHTML = markdownToHtml(text); // escaped by markdownToHtml
  return div;
}

// Outliers ticked for a remix.
const picked = new Set();
function updateRemix() {
  $('remix').disabled = picked.size < 2 || picked.size > 4;
  $('remix').textContent = picked.size ? `Remix selected (${picked.size})` : 'Remix selected';
}

function card(i) {
  const t = tier(mult(i));
  return h(
    'article',
    { class: `idea${i.unavailable ? ' gone' : ''}` },
    h('label', { class: 'pick', title: 'Select for remix' }, h('input', {
      type: 'checkbox',
      checked: picked.has(i.id),
      onchange: (e) => {
        if (e.target.checked) picked.add(i.id);
        else picked.delete(i.id);
        updateRemix();
      },
    }), 'Remix'),
    h(
      'a',
      { class: 'thumb', href: videoUrl(i), target: '_blank', rel: 'noopener' },
      h('img', { src: i.thumb, alt: '', loading: 'lazy' }),
      h('span', { class: `pill tier-${t}` }, fmtMult(mult(i))),
      h('span', { class: 'fmt' }, i.unavailable ? 'Unavailable' : i.format === 'short' ? 'Short' : 'Long-form'),
    ),
    h(
      'div',
      { class: 'body' },
      h('a', { class: 'title', href: videoUrl(i), target: '_blank', rel: 'noopener', title: i.title }, i.title),
      h(
        'div',
        { class: 'meta' },
        h('a', { href: `https://www.youtube.com/channel/${i.channelId}`, target: '_blank', rel: 'noopener' }, i.channelTitle),
        ` · ${fmtNum(i.views)} views · median ${fmtNum(i.stats?.baselineMedian ?? i.baselineMedian)} · ${fmtDate(i.publishedAt)}`,
      ),
      chips(i),
      i.foundVia && h('div', { class: 'meta' }, `Found via: ${i.foundVia.path?.join(' › ') ?? i.foundVia.keyword}`),
      heatBlock(i),
      i.ai &&
        h(
          'details',
          { class: 'ai' },
          h('summary', {}, `AI breakdown · ${i.ai.model} · ${fmtDate(i.ai.at)}`),
          mdBlock(i.ai.text),
        ),
      h(
        'div',
        { class: 'ai-row' },
        h('button', { onclick: (e) => aiBreakdown(i, e.currentTarget) }, i.ai ? 'Redo AI breakdown' : 'AI breakdown'),
        transcripts[i.id] &&
          h(
            'button',
            {
              title: `${transcripts[i.id].segments.length} lines, saved ${fmtDate(transcripts[i.id].at)}`,
              onclick: () => download(`${i.title.replace(/[\\/:*?"<>|]+/g, '').slice(0, 80)}.txt`, transcriptText(i, transcripts[i.id])),
            },
            'Transcript .txt',
          ),
        transcripts[i.id] && h('a', { class: 'button-link', href: `../script/script.html?id=${i.id}` }, 'Analyze script'),
        h('a', { class: 'button-link', href: `../web/web.html?v=${i.id}`, title: 'Map the videos YouTube suggests around this one' }, 'Video web'),
        h('a', { class: 'button-link', href: `../audience/audience.html?v=${i.id}`, title: 'Questions, requests and pain points from the top comments' }, 'Comments'),
        h('button', {
          title: 'Create your own video project modelled on this outlier',
          onclick: async () => {
            const p = await send({ type: 'projectCreate', data: { title: `My take: ${i.title}`, inspiration: [i.id], source: { type: 'outlier', id: i.id } } });
            location.href = `../project/project.html?id=${p.id}`;
          },
        }, 'Start project'),
      ),
      h('textarea', {
        placeholder: 'Notes: the hook, the angle, how you would do it…',
        value: i.notes ?? '',
        onchange: (e) => send({ type: 'updateIdea', id: i.id, patch: { notes: e.target.value } }),
      }),
      h('input', {
        class: 'tags',
        placeholder: 'Tags (comma separated)',
        value: (i.tags ?? []).join(', '),
        onchange: (e) =>
          send({
            type: 'updateIdea',
            id: i.id,
            patch: { tags: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) },
          }),
      }),
      h(
        'div',
        { class: 'foot' },
        h('span', {}, `Saved ${fmtDate(i.savedAt)}${i.updatedAt ? ` · updated ${fmtDate(i.updatedAt)}` : ''}`),
        h('button', { class: 'remove', onclick: () => send({ type: 'removeIdea', id: i.id }) }, 'Remove'),
      ),
    ),
  );
}

function render() {
  pendingRender = false;
  const all = Object.values(ideas);
  const list = visible();
  $('grid').replaceChildren(...list.map(card));
  $('empty').hidden = all.length > 0;
  $('summary').textContent = all.length
    ? `${all.length} saved${list.length !== all.length ? ` · showing ${list.length}` : ''}`
    : '';
  renderInsights(all);
  const missing = all.filter((i) => !i.stats).length;
  if (missing && !$('notice').textContent) {
    notice(`${missing} idea${missing > 1 ? 's were' : ' was'} saved before full stats existed. Click "Refresh stats" to fill them in.`);
  }
}

// Don't rebuild the grid while someone is typing in a note.
function renderSoon() {
  const el = document.activeElement;
  if (el && $('grid').contains(el) && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT')) pendingRender = true;
  else render();
}
$('grid').addEventListener('focusout', () => pendingRender && setTimeout(renderSoon, 0));

// ---------- CSV ----------

const IDEA_COLUMNS = [
  ['video_id', (i) => i.id],
  ['title', (i) => i.title],
  ['url', videoUrl],
  ['channel', (i) => i.channelTitle],
  ['channel_id', (i) => i.channelId],
  ['format', (i) => i.format],
  ['duration_sec', (i) => i.durationSec],
  ['published', (i) => i.publishedAt?.slice(0, 10)],
  ['saved', (i) => isoDate(i.savedAt)],
  ['last_updated', (i) => isoDate(i.updatedAt)],
  ['available', (i) => (i.unavailable ? 'no' : 'yes')],
  ['age_days', (i) => round(i.stats?.ageDays, 1)],
  ['views', (i) => i.views],
  ['likes', (i) => i.likes],
  ['comments', (i) => i.comments],
  ['views_per_day', (i) => round(i.stats?.viewsPerDay, 1)],
  ['like_rate', (i) => round(i.stats?.likeRate)],
  ['comment_rate', (i) => round(i.stats?.commentRate, 5)],
  ['channel_subs', (i) => i.stats?.subs],
  ['channel_total_views', (i) => i.stats?.channelTotalViews],
  ['channel_video_count', (i) => i.stats?.channelVideoCount],
  ['views_per_sub', (i) => round(i.stats?.viewsPerSub)],
  ['channel_median_views', (i) => round(i.stats?.baselineMedian ?? i.baselineMedian, 0)],
  ['channel_avg_views', (i) => round(i.stats?.baselineMean, 0)],
  ['baseline_sample', (i) => i.stats?.baselineSample],
  ['outlier_score_vs_median', (i) => round(mult(i), 3)],
  ['score_vs_average', (i) => round(i.stats?.vsAverage, 3)],
  ['above_channel_average', (i) => (i.stats?.aboveAverage == null ? '' : i.stats.aboveAverage ? 'yes' : 'no')],
  ['channel_percentile', (i) => round(i.stats?.percentile, 1)],
  ['channel_like_rate', (i) => round(i.stats?.channelLikeRate)],
  ['like_rate_vs_channel', (i) => round(i.stats?.likeRateVsChannel, 3)],
  ['channel_trend', (i) => i.stats?.trend ?? ''],
  ['channel_momentum', (i) => round(i.stats?.momentum, 3)],
  ['channel_trend_pct_per_month', (i) => round(i.stats?.monthlyChange)],
  ['channel_recent_median', (i) => round(i.stats?.recentMedian, 0)],
  ['channel_prior_median', (i) => round(i.stats?.priorMedian, 0)],
  ['channel_uploads_per_week', (i) => round(i.stats?.uploadsPerWeek, 2)],
  ['snapshots', (i) => i.history?.length ?? 0],
  ['days_tracked', (i) => round(trackingStats(i.history)?.days, 1)],
  ['views_at_first_snapshot', (i) => i.history?.[0]?.views],
  ['views_gained_since_saved', (i) => trackingStats(i.history)?.viewsGained],
  ['views_per_day_since_saved', (i) => round(trackingStats(i.history)?.viewsPerDay, 1)],
  ['view_growth_since_saved', (i) => round(trackingStats(i.history)?.growthPct)],
  ['subs_change_since_saved', (i) => trackingStats(i.history)?.subsChange],
  ['found_via_keyword', (i) => i.foundVia?.keyword ?? ''],
  ['found_via_path', (i) => i.foundVia?.path?.join(' > ') ?? ''],
  ['replay_peaks', (i) => (heatmaps[i.id] ? heatmapSummary(heatmaps[i.id].points).peaks.map((p) => formatTime(p.start)).join('; ') : '')],
  ['replay_hold_ratio', (i) => (heatmaps[i.id] ? round(heatmapSummary(heatmaps[i.id].points).holdRatio, 3) : '')],
  ['has_transcript', (i) => (transcripts[i.id] ? 'yes' : 'no')],
  ['tags', (i) => (i.tags ?? []).join('; ')],
  ['notes', (i) => i.notes],
  ['ai_breakdown', (i) => i.ai?.text ?? ''],
].map(([label, get]) => ({ label, get }));

const HISTORY_COLUMNS = [
  ['video_id', (r) => r.idea.id],
  ['title', (r) => r.idea.title],
  ['channel', (r) => r.idea.channelTitle],
  ['format', (r) => r.idea.format],
  ['date', (r) => isoDate(r.snap.t)],
  ['timestamp', (r) => new Date(r.snap.t).toISOString()],
  ['days_since_published', (r) => round((r.snap.t - new Date(r.idea.publishedAt)) / 86_400_000, 2)],
  ['views', (r) => r.snap.views],
  ['likes', (r) => r.snap.likes],
  ['comments', (r) => r.snap.comments],
  ['channel_subs', (r) => r.snap.subs],
  ['channel_median_views', (r) => round(r.snap.baselineMedian, 0)],
  ['outlier_score', (r) => round(r.snap.multiplier, 3)],
].map(([label, get]) => ({ label, get }));

const stamp = () => new Date().toISOString().slice(0, 10);

$('export').addEventListener('click', () => {
  download(`yt-ideas-${stamp()}.csv`, '﻿' + toCsv(visible(), IDEA_COLUMNS), 'text/csv;charset=utf-8');
});

$('export-history').addEventListener('click', () => {
  const rows = visible().flatMap((idea) => (idea.history ?? []).map((snap) => ({ idea, snap })));
  if (!rows.length) return notice('No history yet. Refresh stats to record the first snapshot.');
  download(`yt-ideas-history-${stamp()}.csv`, '﻿' + toCsv(rows, HISTORY_COLUMNS), 'text/csv;charset=utf-8');
});

// ---------- refresh ----------

$('refresh').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  btn.textContent = 'Refreshing…';
  try {
    const { updated, missing, failed } = await send({ type: 'refreshIdeas' });
    notice(`Updated ${updated} idea${updated === 1 ? '' : 's'}${missing ? ` · ${missing} no longer available` : ''}${failed ? ` · ${failed} failed (try again later)` : ''}.`);
  } catch (err) {
    notice(err.message, 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Refresh stats';
  }
});

// ---------- AI ----------

const dlg = $('dlg');
let dlgText = '';
let dlgName = 'ai-result';

let dlgProject = null; // { title, inspiration } when the result can become a project
function showDialog(title, { text = '', meta = '', loading = false, name = 'ai-result', project = null } = {}) {
  dlgProject = project;
  $('dlg-project').hidden = !project || loading;
  $('dlg-title').textContent = title;
  $('dlg-meta').textContent = meta;
  dlgText = text;
  dlgName = name;
  $('dlg-body').replaceChildren(loading ? h('div', { class: 'loading' }, 'Thinking… this can take up to a minute.') : mdBlock(text));
  $('dlg-copy').disabled = $('dlg-download').disabled = loading;
  if (!dlg.open) dlg.showModal();
}

$('dlg-close').addEventListener('click', () => dlg.close());
$('dlg-copy').addEventListener('click', async (e) => {
  await navigator.clipboard.writeText(dlgText);
  e.target.textContent = 'Copied';
  setTimeout(() => (e.target.textContent = 'Copy'), 1200);
});
$('dlg-download').addEventListener('click', () => download(`${dlgName}.md`, dlgText, 'text/markdown;charset=utf-8'));
$('dlg-project').addEventListener('click', async () => {
  const p = await send({ type: 'projectCreate', data: { title: dlgProject.title, outline: dlgText, inspiration: dlgProject.inspiration, source: { type: 'remix' } } });
  location.href = `../project/project.html?id=${p.id}`;
});

$('remix').addEventListener('click', async () => {
  const chosen = [...picked].map((id) => ideas[id]).filter(Boolean);
  const ai = await requireAi();
  if (!ai) return;
  const title = `Remix of ${chosen.length} outliers`;
  const project = { title: `Remix: ${chosen.map((i) => i.title.slice(0, 24)).join(' × ')}`, inspiration: chosen.map((i) => i.id) };
  showDialog(title, { loading: true, meta: aiMeta(ai) });
  try {
    const { system, prompt } = remixPrompt(chosen, ai.niche);
    const text = await generate({ ...ai, system, prompt });
    await send({ type: 'saveAiRun', run: { title, text, provider: ai.provider, model: ai.model, count: chosen.length } });
    showDialog(title, { text, meta: aiMeta(ai), name: 'outlier-remix', project });
  } catch (err) {
    showDialog('Remix failed', { text: err.message, meta: aiMeta(ai) });
  }
});

async function requireAi() {
  const ai = await activeAi();
  if (ai) return ai;
  if (confirm('AI isn\'t set up yet. Open settings to add a Gemini, OpenAI, Claude or OpenRouter key?')) {
    chrome.runtime.openOptionsPage();
  }
  return null;
}

const aiMeta = (ai) => `${PROVIDERS[ai.provider].label} · ${ai.model}`;

async function aiBreakdown(idea, btn) {
  const ai = await requireAi();
  if (!ai) return;
  btn.disabled = true;
  btn.textContent = 'Thinking…';
  showDialog(`Why "${idea.title}" worked`, { loading: true, meta: aiMeta(ai) });
  try {
    const image = await thumbnailImage(idea.id);
    const hm = heatmaps[idea.id];
    const { system, prompt } = breakdownPrompt(idea, ai.niche, {
      transcript: transcripts[idea.id]?.segments,
      peaks: hm ? heatmapSummary(hm.points).peaks : null,
    });
    const text = await generate({ ...ai, system, prompt, image });
    await send({ type: 'updateIdea', id: idea.id, patch: { ai: { text, provider: ai.provider, model: ai.model, at: Date.now() } } });
    showDialog(`Why "${idea.title}" worked`, { text, meta: aiMeta(ai), name: `breakdown-${idea.id}` });
  } catch (err) {
    showDialog('AI breakdown failed', { text: err.message, meta: aiMeta(ai) });
  } finally {
    btn.disabled = false;
  }
}

$('generate').addEventListener('click', async () => {
  const pool = visible()
    .filter((i) => !i.unavailable)
    .sort((a, b) => (mult(b) ?? 0) - (mult(a) ?? 0));
  if (!pool.length) return notice('Save some outliers first. The AI uses the ideas currently shown.');
  const ai = await requireAi();
  if (!ai) return;
  const used = Math.min(pool.length, 40);
  const title = `10 video ideas from ${used} saved outlier${used === 1 ? '' : 's'}`;
  showDialog(title, { loading: true, meta: aiMeta(ai) });
  try {
    const { system, prompt } = ideasPrompt(pool, ai.niche);
    const text = await generate({ ...ai, system, prompt });
    await send({ type: 'saveAiRun', run: { title, text, provider: ai.provider, model: ai.model, count: used } });
    showDialog(title, { text, meta: aiMeta(ai), name: `video-ideas-${stamp()}` });
  } catch (err) {
    showDialog('Idea generation failed', { text: err.message, meta: aiMeta(ai) });
  }
});

async function renderRuns() {
  const { aiRuns = [] } = await chrome.storage.local.get('aiRuns');
  $('runs').hidden = !aiRuns.length;
  $('runs-list').replaceChildren(
    ...aiRuns.map((r) =>
      h(
        'li',
        {},
        h(
          'button',
          { onclick: () => showDialog(r.title, { text: r.text, meta: `${r.model} · ${new Date(r.at).toLocaleString()}`, name: `video-ideas-${isoDate(r.at)}` }) },
          r.title,
        ),
        h('span', { class: 'muted small' }, ` · ${new Date(r.at).toLocaleString()}`),
      ),
    ),
  );
}

// ---------- wiring ----------

for (const id of ['q', 'format', 'trend', 'sort']) $(id).addEventListener('input', render);

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local') return;
  const extrasChanged = Object.keys(changes).some((k) => k.startsWith('hm:') || k.startsWith('tx:'));
  if (changes.ideas || extrasChanged) {
    if (changes.ideas) ideas = changes.ideas.newValue ?? {};
    await loadExtras();
    renderSoon();
  }
  if (changes.aiRuns) renderRuns();
});

ideas = await listIdeas();
await loadExtras();
render();
renderRuns();
