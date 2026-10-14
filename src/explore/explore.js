import { mountShell } from '../lib/nav.js';
import { send, h, fmtNum, fmtMult, fmtPct, tier, ageText, videoUrl, download, isoDate, round, topicOf } from '../lib/ui.js';
import { toCsv } from '../lib/stats.js';
import { activeAi, generate, anglesPrompt, parseLines } from '../lib/ai.js';

mountShell('explore');

const $ = (id) => document.getElementById(id);
let index = {}; // node metadata, from the background
let current = null; // the open node (metadata + results)
let saved = new Set();
let alerts = new Set(); // keywords with daily trend alerts
let view = { preset: 'all', format: '', sort: 'mult' };

// Result filters. "Hunt" mirrors 1of10's outlier search settings.
const PRESETS = {
  all: { label: 'All', test: () => true },
  outliers: { label: 'Outliers ≥ 2x', test: (v) => v.multiplier >= 2 },
  hunt: {
    label: 'Hunt: ≥2x, 100K+ views, ≤25K subs, last 3 months',
    short: 'Small-channel hunt',
    test: (v) => v.multiplier >= 2 && v.views >= 100_000 && v.subs != null && v.subs <= 25_000 && daysOld(v) <= 92,
  },
  small: { label: 'Channels < 50K subs', test: (v) => v.subs != null && v.subs < 50_000 },
  recent: { label: 'Last 6 months', test: (v) => daysOld(v) <= 182 },
};
const daysOld = (v) => (Date.now() - new Date(v.publishedAt)) / 86_400_000;
const perDay = (v) => v.views / Math.max(daysOld(v), 1);

// ---------- tree ----------

const children = (id) =>
  Object.values(index)
    .filter((n) => (n.parentId ?? null) === id)
    .sort((a, b) => (id ? a.createdAt - b.createdAt : b.updatedAt - a.updatedAt));

function pathOf(node) {
  const path = [];
  for (let n = node; n; n = index[n.parentId]) path.unshift(n);
  return path;
}

const oppClass = (o) => (o == null ? '' : o >= 60 ? 'opp-high' : o >= 35 ? 'opp-mid' : 'opp-low');

function treeItem(node) {
  const kids = children(node.id);
  return h(
    'li',
    { class: node.parentId ? '' : 'root' },
    h(
      'div',
      {
        class: `row${current?.id === node.id ? ' on' : ''}`,
        title: `${node.keyword}\nOpportunity ${node.metrics?.opportunity ?? '—'} · explored ${new Date(node.updatedAt).toLocaleString()}`,
        onclick: () => openNode(node.id),
      },
      node.starred && h('span', { class: 'star' }, '★'),
      h('span', { class: 'kw' }, node.keyword),
      h('span', { class: `score ${oppClass(node.metrics?.opportunity)}` }, node.metrics?.opportunity ?? '—'),
      h(
        'button',
        {
          class: 'del',
          title: kids.length ? 'Delete this keyword and everything below it' : 'Delete',
          onclick: (e) => {
            e.stopPropagation();
            deleteNode(node);
          },
        },
        '✕',
      ),
    ),
    kids.length ? h('ul', {}, kids.map(treeItem)) : null,
  );
}

function renderTree() {
  const roots = children(null);
  $('tree').replaceChildren(roots.length ? h('ul', {}, roots.map(treeItem)) : '');
  $('tree-empty').hidden = roots.length > 0;
}

async function deleteNode(node) {
  const below = Object.values(index).filter((n) => pathOf(n).some((p) => p.id === node.id)).length - 1;
  if (!confirm(`Delete "${node.keyword}"${below ? ` and ${below} keyword${below > 1 ? 's' : ''} below it` : ''}? Saved ideas are kept.`)) return;
  await send({ type: 'deleteNodes', ids: [node.id] });
  if (current && !index[current.id]) showWelcome();
}

// ---------- node view ----------

function showWelcome() {
  current = null;
  $('welcome').hidden = false;
  $('node').hidden = true;
  history.replaceState(null, '', location.pathname);
  renderTree();
}

function metric(k, v, s, cls = '', title) {
  return h('div', { class: `metric ${cls}`, title }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v), s && h('div', { class: 's' }, s));
}

function metricsRow(m) {
  if (!m) return h('p', { class: 'muted' }, 'No results for this keyword.');
  return h(
    'div',
    { class: 'metrics' },
    metric(
      'Opportunity',
      String(m.opportunity),
      'out of 100',
      `opp ${oppClass(m.opportunity)}`,
      'Weighted: 40% how many results are ≥2x outliers, 20% share of small channels (<50K subs), 20% results from the last 6 months, 20% median views of the last year\'s results.',
    ),
    metric('Outliers ≥ 2x', `${m.outliers} / ${m.results}`, `${fmtPct(m.outlierRate)} of results`),
    metric('Small-channel outliers', String(m.smallChannelOutliers), 'from channels under 50K subs'),
    metric('Demand', fmtNum(m.recentMedianViews), 'median views, last 12 months'),
    metric('Competition', fmtNum(m.medianSubs), 'median subscribers ranking'),
    metric('Freshness', fmtPct(m.freshness), 'results from the last 6 months'),
  );
}

function crumbs(node) {
  const path = pathOf(node);
  return h(
    'nav',
    { class: 'crumbs', 'aria-label': 'Keyword path' },
    path.map((n, i) =>
      i === path.length - 1
        ? h('span', { class: 'here' }, n.keyword)
        : [h('button', { onclick: () => openNode(n.id), title: 'Back up to this level' }, n.keyword), h('span', {}, '›')],
    ),
  );
}

function chipGroup(label, keywords, visited) {
  if (!keywords?.length) return null;
  return h(
    'div',
    { class: 'chip-group' },
    h('span', { class: 'label' }, label),
    keywords.map((k) =>
      h(
        'button',
        {
          class: `chip${visited.has(k.toLowerCase()) ? ' visited' : ''}`,
          title: visited.has(k.toLowerCase()) ? 'Already explored: open it' : 'Dig into this keyword',
          onclick: () => dig(k),
        },
        k,
      ),
    ),
  );
}

function digSection(node) {
  const visited = new Set(children(node.id).map((n) => n.keyword.toLowerCase()));
  const custom = h('input', { placeholder: 'Or type a keyword to dig into…', 'aria-label': 'Custom keyword' });
  return h(
    'section',
    { class: 'dig' },
    h('h3', {}, 'Dig deeper'),
    chipGroup('Searches', node.related?.autocomplete, visited),
    chipGroup('In outliers', node.related?.phrases, visited),
    chipGroup('AI angles', node.aiAngles, visited),
    h(
      'form',
      {
        class: 'custom',
        onsubmit: (e) => {
          e.preventDefault();
          if (custom.value.trim()) dig(custom.value.trim());
        },
      },
      custom,
      h('button', { type: 'submit' }, 'Dig'),
      h('button', { type: 'button', onclick: (e) => aiAngles(node, e.currentTarget), title: 'Ask your AI provider for keywords to explore next' }, node.aiAngles ? 'More AI angles' : 'AI angles'),
    ),
  );
}

function visibleResults(node) {
  const by = {
    mult: (a, b) => (b.multiplier ?? -1) - (a.multiplier ?? -1),
    views: (a, b) => (b.views ?? 0) - (a.views ?? 0),
    velocity: (a, b) => perDay(b) - perDay(a),
    new: (a, b) => new Date(b.publishedAt) - new Date(a.publishedAt),
  }[view.sort];
  return node.results.filter((v) => PRESETS[view.preset].test(v) && (!view.format || v.format === view.format)).sort(by);
}

function resultRow(v, node) {
  const isSaved = saved.has(v.id);
  return h(
    'div',
    { class: 'res' },
    h('a', { href: videoUrl(v), target: '_blank', rel: 'noopener', tabindex: '-1' }, h('img', { src: v.thumb, alt: '', loading: 'lazy' })),
    h(
      'div',
      {},
      h('a', { class: 't', href: videoUrl(v), target: '_blank', rel: 'noopener', title: v.title }, v.title),
      h(
        'div',
        { class: 'm' },
        `${v.channelTitle} · ${v.subs == null ? 'subs hidden' : `${fmtNum(v.subs)} subs`} · ${fmtNum(v.views)} views · ${ageText(v.publishedAt)} · ${fmtNum(perDay(v))}/day${v.format === 'short' ? ' · Short' : ''}`,
      ),
    ),
    h('span', { class: `pill tier-${tier(v.multiplier)}`, title: `vs channel median of ${fmtNum(v.baselineMedian)} views` }, fmtMult(v.multiplier)),
    h(
      'div',
      { class: 'acts' },
      h(
        'button',
        {
          class: isSaved ? 'saved' : '',
          onclick: () =>
            isSaved
              ? send({ type: 'removeIdea', id: v.id })
              : send({
                  type: 'saveIdea',
                  video: v,
                  foundVia: { keyword: node.keyword, path: pathOf(node).map((n) => n.keyword), nodeId: node.id },
                }),
        },
        isSaved ? '★ Saved' : '☆ Save',
      ),
      h('button', { title: "Dig into this video's topic", onclick: () => dig(topicOf(v.title)) }, 'Dig'),
      h('button', { title: 'Map the videos YouTube suggests around this one', onclick: () => send({ type: 'openPage', page: 'web', query: `?v=${v.id}` }) }, 'Web'),
    ),
  );
}

function resultsSection(node) {
  const list = visibleResults(node);
  const seg = (key, label) =>
    h('button', { class: view.preset === key ? 'on' : '', title: PRESETS[key].label, onclick: () => setView({ preset: key }) }, label);
  return h(
    'section',
    {},
    h(
      'div',
      { class: 'filters' },
      h('div', { class: 'seg' }, Object.entries(PRESETS).map(([k, p]) => seg(k, p.short ?? p.label))),
      h(
        'select',
        { 'aria-label': 'Format', onchange: (e) => setView({ format: e.target.value }) },
        h('option', { value: '', selected: !view.format }, 'All formats'),
        h('option', { value: 'long', selected: view.format === 'long' }, 'Long-form'),
        h('option', { value: 'short', selected: view.format === 'short' }, 'Shorts'),
      ),
      h(
        'select',
        { 'aria-label': 'Sort', onchange: (e) => setView({ sort: e.target.value }) },
        h('option', { value: 'mult', selected: view.sort === 'mult' }, 'Sort: Outlier score'),
        h('option', { value: 'velocity', selected: view.sort === 'velocity' }, 'Sort: Views per day'),
        h('option', { value: 'views', selected: view.sort === 'views' }, 'Sort: Views'),
        h('option', { value: 'new', selected: view.sort === 'new' }, 'Sort: Newest'),
      ),
      h('span', { class: 'count' }, `${list.length} of ${node.results.length}`),
      h('button', { class: 'link', onclick: () => exportResults(node) }, 'Export results CSV'),
    ),
    h(
      'div',
      { class: 'results' },
      list.length ? list.map((v) => resultRow(v, node)) : h('div', { class: 'empty' }, 'No videos match this filter.'),
    ),
  );
}

function renderNode() {
  const node = current;
  $('welcome').hidden = true;
  $('node').hidden = false;
  const notes = h('textarea', {
    class: 'notes',
    placeholder: 'Notes on this keyword: angles, what the outliers have in common…',
    value: node.notes ?? '',
    onchange: (e) => send({ type: 'updateNode', id: node.id, patch: { notes: e.target.value } }),
  });
  $('node').replaceChildren(
    crumbs(node),
    h(
      'div',
      { class: 'node-head' },
      h('h2', {}, node.keyword),
      h(
        'div',
        { class: 'btns' },
        h(
          'button',
          {
            class: node.starred ? 'starred' : '',
            title: 'Mark as a good keyword',
            onclick: () => send({ type: 'updateNode', id: node.id, patch: { starred: !node.starred } }),
          },
          node.starred ? '★ Starred' : '☆ Star',
        ),
        h(
          'button',
          {
            class: alerts.has(node.keyword.toLowerCase()) ? 'starred' : '',
            title: 'Check this keyword daily and add new outliers to your Radar',
            onclick: async (e) => {
              const on = alerts.has(node.keyword.toLowerCase());
              try {
                await send({ type: on ? 'unfollowKeyword' : 'followKeyword', keyword: node.keyword });
                alerts = new Set(Object.keys(await send({ type: 'keywords' })));
                renderNode();
              } catch (err) {
                e.target.textContent = err.message;
              }
            },
          },
          alerts.has(node.keyword.toLowerCase()) ? '🔔 Alerts on' : '🔔 Alert me',
        ),
        h('button', { onclick: () => explore(node.keyword, node.parentId), title: 'Search again for fresh results' }, 'Refresh'),
        h('button', { onclick: () => deleteNode(node) }, 'Delete'),
      ),
    ),
    h(
      'p',
      { class: 'muted small' },
      `${node.results.length} videos from the ${node.source ?? 'search page'} · explored ${new Date(node.updatedAt ?? node.fetchedAt).toLocaleString()}`,
    ),
    metricsRow(node.metrics),
    digSection(node),
    notes,
    resultsSection(node),
  );
}

function setView(patch) {
  Object.assign(view, patch);
  renderNode();
}

async function openNode(id) {
  const node = await send({ type: 'exploreNode', id });
  if (!node) return showWelcome();
  current = node;
  history.replaceState(null, '', `?node=${id}`);
  renderTree();
  renderNode();
  window.scrollTo({ top: 0 });
}

// ---------- exploring ----------

let busy = false;
async function explore(keyword, parentId = null) {
  if (busy) return;
  busy = true;
  $('welcome').hidden = true;
  $('node').hidden = false;
  $('node').replaceChildren(
    current && parentId ? crumbs(current) : '',
    h('div', { class: 'loading' }, `Searching "${keyword}" and scoring every result against its channel…`),
  );
  try {
    const node = await send({ type: 'explore', keyword, parentId });
    index = await send({ type: 'exploreNodes' });
    await openNode(node.id);
  } catch (err) {
    const fix =
      err.reason === 'noKey' || err.reason === 'keyInvalid'
        ? ' Add your YouTube Data API key in the extension popup first.'
        : err.reason === 'quotaExceeded'
          ? ' Try again after midnight Pacific time.'
          : '';
    $('node').replaceChildren(h('div', { class: 'error' }, err.message + fix));
  } finally {
    busy = false;
  }
}

// Go one level deeper from the current keyword (or open it if already explored).
function dig(keyword) {
  if (!current) return explore(keyword);
  const existing = children(current.id).find((n) => n.keyword.toLowerCase() === keyword.toLowerCase());
  return existing ? openNode(existing.id) : explore(keyword, current.id);
}

async function aiAngles(node, btn) {
  const ai = await activeAi();
  if (!ai) {
    if (confirm('AI is optional and not set up yet. Open settings to add a Gemini, OpenAI, Claude or OpenRouter key?')) {
      chrome.runtime.openOptionsPage();
    }
    return;
  }
  btn.disabled = true;
  btn.textContent = 'Thinking…';
  try {
    const outliers = [...node.results].filter((v) => v.multiplier >= 2).sort((a, b) => b.multiplier - a.multiplier);
    const { system, prompt } = anglesPrompt(pathOf(node).map((n) => n.keyword), outliers.length ? outliers : node.results, ai.niche);
    const angles = parseLines(await generate({ ...ai, system, prompt }));
    await send({ type: 'updateNode', id: node.id, patch: { aiAngles: [...new Set([...(node.aiAngles ?? []), ...angles])] } });
    await openNode(node.id);
  } catch (err) {
    btn.disabled = false;
    btn.textContent = 'AI angles';
    alert(err.message);
  }
}

// ---------- export ----------

const stamp = () => new Date().toISOString().slice(0, 10);

$('export-keywords').addEventListener('click', () => {
  const rows = Object.values(index).sort((a, b) => a.createdAt - b.createdAt);
  if (!rows.length) return;
  const csv = toCsv(
    rows,
    [
      ['keyword', (n) => n.keyword],
      ['path', (n) => pathOf(n).map((p) => p.keyword).join(' > ')],
      ['depth', (n) => n.depth],
      ['explored', (n) => isoDate(n.updatedAt)],
      ['starred', (n) => (n.starred ? 'yes' : 'no')],
      ['opportunity', (n) => n.metrics?.opportunity],
      ['results', (n) => n.metrics?.results],
      ['outliers_2x', (n) => n.metrics?.outliers],
      ['outlier_rate', (n) => round(n.metrics?.outlierRate, 3)],
      ['small_channel_outliers', (n) => n.metrics?.smallChannelOutliers],
      ['small_channel_share', (n) => round(n.metrics?.smallShare, 3)],
      ['freshness', (n) => round(n.metrics?.freshness, 3)],
      ['median_views', (n) => round(n.metrics?.medianViews, 0)],
      ['recent_median_views', (n) => round(n.metrics?.recentMedianViews, 0)],
      ['median_subs', (n) => round(n.metrics?.medianSubs, 0)],
      ['median_outlier_score', (n) => round(n.metrics?.medianMultiplier, 3)],
      ['notes', (n) => n.notes],
    ].map(([label, get]) => ({ label, get })),
  );
  download(`yt-keywords-${stamp()}.csv`, '﻿' + csv, 'text/csv;charset=utf-8');
});

function exportResults(node) {
  const csv = toCsv(
    visibleResults(node),
    [
      ['keyword', () => node.keyword],
      ['video_id', (v) => v.id],
      ['title', (v) => v.title],
      ['url', videoUrl],
      ['channel', (v) => v.channelTitle],
      ['channel_subs', (v) => v.subs],
      ['format', (v) => v.format],
      ['published', (v) => v.publishedAt?.slice(0, 10)],
      ['views', (v) => v.views],
      ['views_per_day', (v) => round(perDay(v), 1)],
      ['likes', (v) => v.likes],
      ['comments', (v) => v.comments],
      ['channel_median_views', (v) => round(v.baselineMedian, 0)],
      ['outlier_score', (v) => round(v.multiplier, 3)],
    ].map(([label, get]) => ({ label, get })),
  );
  download(`yt-keyword-${node.keyword.replace(/\W+/g, '-')}-${stamp()}.csv`, '﻿' + csv, 'text/csv;charset=utf-8');
}

// ---------- wiring ----------

$('start').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = $('start-q').value.trim();
  if (q) explore(q);
});

// Autocomplete for the starting keyword.
let suggestTimer;
$('start-q').addEventListener('input', (e) => {
  clearTimeout(suggestTimer);
  const q = e.target.value.trim();
  if (q.length < 2) return;
  suggestTimer = setTimeout(async () => {
    const list = await send({ type: 'suggest', keyword: q }).catch(() => []);
    $('start-suggest').replaceChildren(...list.map((s) => h('option', { value: s })));
  }, 250);
});

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local') return;
  if (changes['explore:index']) {
    index = changes['explore:index'].newValue ?? {};
    if (current && index[current.id]) Object.assign(current, index[current.id]);
    renderTree();
    if (current && index[current.id]) renderNode();
  }
  if (changes.ideas) {
    saved = new Set(Object.keys(changes.ideas.newValue ?? {}));
    if (current) renderNode();
  }
});

index = await send({ type: 'exploreNodes' });
saved = new Set(await send({ type: 'savedIds' }));
alerts = new Set(Object.keys(await send({ type: 'keywords' }).catch(() => ({}))));
renderTree();
const params = new URLSearchParams(location.search);
if (params.get('node') && index[params.get('node')]) openNode(params.get('node'));
else if (params.get('q')) {
  $('start-q').value = params.get('q');
  explore(params.get('q'));
}
