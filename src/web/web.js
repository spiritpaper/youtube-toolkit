import { mountShell } from '../lib/nav.js';
import { send, h, fmtNum, fmtMult, tier, ageText, videoUrl, topicOf } from '../lib/ui.js';
import { layout, webInsights, relationship } from '../lib/web.js';
import { activeAi, generate, webPrompt, PROVIDERS } from '../lib/ai.js';
import { markdownToHtml } from '../lib/markdown.js';

mountShell('web');

const $ = (id) => document.getElementById(id);
const main = $('main');
const NS = 'http://www.w3.org/2000/svg';
const W = 1000;
const H = 700;

let web = null;
let selected = null;
let highlight = null; // Set of ids (a cluster) to emphasise
let view = { x: 0, y: 0, w: W, h: H };
let showList = false;
let saved = new Set();

const svgEl = (tag, attrs = {}) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
};
// Zoomed in this far (or more), dots turn into thumbnails.
const THUMB_ZOOM = 1.8;
const thumbOf = (n) => n.thumb || `https://i.ytimg.com/vi/${n.id}/mqdefault.jpg`;
const short = (t, n = 30) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);
const idFrom = (s) => (/(?:v=|youtu\.be\/|shorts\/)([\w-]{11})/.exec(s) ?? /^([\w-]{11})$/.exec(s.trim()))?.[1];

// ---------- graph ----------

function drawGraph(ins) {
  const pos = layout(web, { width: W, height: H, center: web.seed });
  const inDeg = new Map(ins.hubs.map((n) => [n.id, n.inDegree]));
  const labelled = new Set([web.seed, ...ins.hubs.map((n) => n.id), ...ins.outliers.slice(0, 5).map((n) => n.id)]);
  const maxViews = Math.max(...Object.values(web.nodes).map((n) => n.views ?? 1));
  const radius = (n) => 6 + 16 * Math.sqrt(Math.log10((n.views ?? 1) + 1) / Math.log10(maxViews + 1));
  const near = selected ? new Set([selected, ...web.edges.filter((e) => e.from === selected || e.to === selected).flatMap((e) => [e.from, e.to])]) : null;
  const dimmed = (id) => (highlight && !highlight.has(id)) || (near && !near.has(id));
  const pairs = new Set(web.edges.map((e) => `${e.from}>${e.to}`));

  const svg = svgEl('svg', { viewBox: `${view.x} ${view.y} ${view.w} ${view.h}`, role: 'img', 'aria-label': 'Video suggestion web' });
  nodeGeom.clear();
  shown.clear();
  const defs = svgEl('defs');
  defsEl = defs;
  const marker = svgEl('marker', { id: 'arrow', viewBox: '0 0 10 10', refX: 10, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse' });
  marker.append(svgEl('path', { d: 'M0,0 L10,5 L0,10 z', fill: 'var(--edge)' }));
  defs.append(marker);
  svg.append(defs);

  for (const e of web.edges) {
    const a = pos.get(e.from);
    const b = pos.get(e.to);
    if (!a || !b) continue;
    const rb = radius(web.nodes[e.to]) + 3;
    const d = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const hi = selected && (e.from === selected || e.to === selected);
    const cls = ['edge', pairs.has(`${e.to}>${e.from}`) && 'mutual', hi && 'hi', !hi && (dimmed(e.from) || dimmed(e.to)) && 'dim'].filter(Boolean).join(' ');
    svg.append(svgEl('line', { x1: a.x, y1: a.y, x2: b.x - ((b.x - a.x) / d) * rb, y2: b.y - ((b.y - a.y) / d) * rb, class: cls, 'marker-end': 'url(#arrow)' }));
  }
  for (const n of Object.values(web.nodes)) {
    const p = pos.get(n.id);
    if (!p || !n.title) continue;
    const g = svgEl('g', { class: ['node', n.id === web.seed && 'seed', n.id === selected && 'sel', dimmed(n.id) && 'dim'].filter(Boolean).join(' '), tabindex: 0 });
    const c = svgEl('circle', { cx: p.x, cy: p.y, r: radius(n), class: `fill-${tier(n.multiplier)} ring-${tier(n.multiplier)}` });
    g.setAttribute('aria-label', `${n.title}, ${n.channelTitle}, ${fmtNum(n.views)} views, ${fmtMult(n.multiplier)}`);
    g.dataset.id = n.id;
    g.append(c);
    nodeGeom.set(n.id, { x: p.x, y: p.y, r: radius(n), g, circle: c, inDeg: inDeg.get(n.id) ?? 0 });
    g.addEventListener('pointerenter', (ev) => showHover(n, ev));
    g.addEventListener('pointermove', (ev) => moveHover(ev));
    g.addEventListener('pointerleave', hideHover);
    g.addEventListener('focus', () => showHover(n, null));
    g.addEventListener('blur', hideHover);
    if (labelled.has(n.id) || n.id === selected) {
      const t = svgEl('text', { x: p.x + radius(n) + 4, y: p.y + 4 });
      t.textContent = short(n.title);
      g.append(t);
    }
    g.addEventListener('click', (ev) => {
      ev.stopPropagation();
      select(n.id);
    });
    g.addEventListener('keydown', (ev) => ev.key === 'Enter' && select(n.id));
    svg.append(g);
  }
  enablePanZoom(svg);
  graphSvg = svg;
  // Draw thumbnails once the SVG is on the page (it needs its size).
  requestAnimationFrame(updateThumbs);
  return svg;
}

// ---------- thumbnails: hover card, and dots → thumbnails when zoomed in ----------

const nodeGeom = new Map(); // id -> { x, y, r, g, circle, inDeg }
const shown = new Set(); // ids whose thumbnail is drawn
let graphSvg = null;
let defsEl = null;

/** Draws thumbnails for nodes in view while zoomed in; each loads once. */
function updateThumbs() {
  if (!graphSvg?.isConnected) return;
  const zoomed = W / view.w >= THUMB_ZOOM;
  graphSvg.classList.toggle('zoomed', zoomed);
  if (!zoomed) return;
  const pad = 40;
  for (const [id, gm] of nodeGeom) {
    if (shown.has(id)) continue;
    const inView = gm.x > view.x - pad && gm.x < view.x + view.w + pad && gm.y > view.y - pad && gm.y < view.y + view.h + pad;
    if (!inView) continue;
    const clipId = `clip-${id}`;
    const clip = svgEl('clipPath', { id: clipId });
    clip.append(svgEl('circle', { cx: gm.x, cy: gm.y, r: gm.r }));
    defsEl.append(clip);
    // 16:9 thumbnail, cropped to the circle; the circle stays on top as a colored ring.
    const img = svgEl('image', { href: thumbOf(web.nodes[id]), x: gm.x - (gm.r * 16) / 9, y: gm.y - gm.r, width: (gm.r * 32) / 9, height: gm.r * 2, 'clip-path': `url(#${clipId})`, preserveAspectRatio: 'xMidYMid slice', class: 'thumb' });
    gm.g.insertBefore(img, gm.circle);
    shown.add(id);
  }
}

let hoverEl = null;
function showHover(n, ev) {
  hideHover();
  const gm = nodeGeom.get(n.id);
  hoverEl = h('div', { class: 'hover-card', role: 'tooltip' },
    h('img', { src: thumbOf(n), alt: '' }),
    h('div', { class: 'hc-body' },
      h('div', { class: 'hc-title' }, n.title),
      h('div', { class: 'hc-meta' }, `${n.channelTitle} · ${fmtNum(n.views)} views${n.publishedAt ? ` · ${ageText(n.publishedAt)}` : ''}`),
      h('div', { class: 'hc-meta' }, pill(n.multiplier), gm?.inDeg ? ` suggested from ${gm.inDeg} video${gm.inDeg === 1 ? '' : 's'}` : '', n.id === web.seed ? ' · the center' : '')));
  graphSvg.parentElement.append(hoverEl);
  if (ev) moveHover(ev);
  else {
    const box = gm.g.getBoundingClientRect();
    placeHover(box.right, box.top);
  }
}
function moveHover(ev) {
  if (hoverEl) placeHover(ev.clientX, ev.clientY);
}
function placeHover(clientX, clientY) {
  const host = graphSvg.parentElement.getBoundingClientRect();
  const cw = hoverEl.offsetWidth;
  const ch = hoverEl.offsetHeight;
  let x = clientX - host.left + 14;
  let y = clientY - host.top + 14;
  if (x + cw > host.width - 4) x = clientX - host.left - cw - 14; // flip left near the edge
  if (y + ch > host.height - 4) y = Math.max(4, clientY - host.top - ch - 14);
  hoverEl.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
}
function hideHover() {
  hoverEl?.remove();
  hoverEl = null;
}

function enablePanZoom(svg) {
  let drag = null;
  svg.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.node')) return;
    drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
    svg.classList.add('panning');
    svg.setPointerCapture(e.pointerId);
  });
  svg.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const s = view.w / svg.clientWidth;
    view.x = drag.vx - (e.clientX - drag.x) * s;
    view.y = drag.vy - (e.clientY - drag.y) * s;
    svg.setAttribute('viewBox', `${view.x} ${view.y} ${view.w} ${view.h}`);
    hideHover();
  });
  svg.addEventListener('pointerup', (e) => {
    const moved = drag && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 4;
    drag = null;
    svg.classList.remove('panning');
    updateThumbs();
    if (!moved && !e.target.closest('.node') && (selected || highlight)) {
      selected = null;
      highlight = null;
      render();
    }
  });
  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const f = e.deltaY > 0 ? 1.15 : 1 / 1.15;
    const box = svg.getBoundingClientRect();
    const px = view.x + ((e.clientX - box.left) / box.width) * view.w;
    const py = view.y + ((e.clientY - box.top) / box.height) * view.h;
    view = { x: px - (px - view.x) * f, y: py - (py - view.y) * f, w: view.w * f, h: view.h * f };
    svg.setAttribute('viewBox', `${view.x} ${view.y} ${view.w} ${view.h}`);
    hideHover();
    updateThumbs();
  }, { passive: false });
}

// ---------- side panels ----------

const pill = (m) => h('span', { class: `pill tier-${tier(m)}` }, fmtMult(m));
const nodeButton = (n, extra = '') => h('button', { onclick: () => select(n.id), title: n.title }, pill(n.multiplier), h('span', {}, short(n.title, 46), extra));

function selectedCard() {
  const n = web.nodes[selected];
  if (!n) return null;
  const incoming = web.edges.filter((e) => e.to === n.id).map((e) => ({ n: web.nodes[e.from], rank: e.rank })).filter((x) => x.n?.title);
  const outgoing = web.edges.filter((e) => e.from === n.id).map((e) => ({ n: web.nodes[e.to], rank: e.rank })).filter((x) => x.n?.title);
  const why = n.id === web.seed ? ['This is the center of the web.'] : relationship(web, web.seed, n.id);
  return h(
    'section',
    { class: 'card' },
    h('h3', {}, 'Selected video'),
    h('img', { class: 'sel-thumb', src: n.thumb, alt: '' }),
    h('a', { class: 'sel-title', href: videoUrl(n), target: '_blank' }, n.title),
    h('div', { class: 'small muted' }, `${n.channelTitle} · ${fmtNum(n.views)} views · ${ageText(n.publishedAt)} · `, pill(n.multiplier)),
    h('ul', { class: 'why' }, why.map((w) => h('li', {}, w))),
    h(
      'div',
      { class: 'acts' },
      h(
        'button',
        { disabled: outgoing.length >= 20, onclick: (e) => expand(n.id, e.currentTarget, outgoing.length + (n.expanded ? 5 : 8)), title: 'Add the videos YouTube suggests on this one' },
        n.expanded ? 'More suggestions' : 'Expand suggestions',
      ),
      h('button', {
        disabled: saved.has(n.id),
        onclick: async (e) => {
          await send({ type: 'saveIdea', video: { id: n.id, ...n }, foundVia: { keyword: web.nodes[web.seed].title, path: ['video web', web.nodes[web.seed].title] } });
          e.target.textContent = '★ Saved';
          e.target.disabled = true;
        },
      }, saved.has(n.id) ? '★ Saved' : '☆ Save idea'),
      n.id !== web.seed && h('button', { onclick: () => build(n.id) }, 'New web from here'),
      h('button', { onclick: () => send({ type: 'openExplorer', keyword: topicOf(n.title) }) }, 'Explore keyword'),
    ),
    incoming.length > 0 && h('div', { class: 'mini', style: 'margin-top:10px' }, h('b', { class: 'small' }, `Suggested from (${incoming.length})`), incoming.map((x) => nodeButton(x.n, ` · #${x.rank}`))),
    outgoing.length > 0 && h('div', { class: 'mini', style: 'margin-top:10px' }, h('b', { class: 'small' }, `Suggests (${outgoing.length})`), outgoing.map((x) => nodeButton(x.n, ` · #${x.rank}`))),
  );
}

function insightCards(ins) {
  const aiBox = h('div', { class: 'md' }, web.ai ? mdBlock(web.ai.text) : null);
  const aiBtn = h('button', { class: 'primary', onclick: () => runAi(ins, aiBox, aiBtn) }, web.ai ? 'Re-run AI' : 'Ideas from this web (AI)');
  return [
    h('section', { class: 'card' }, h('h3', {}, 'Hubs: suggested most'), ins.hubs.length ? h('div', { class: 'mini' }, ins.hubs.map((n) => nodeButton(n, ` · from ${n.inDegree}`))) : h('p', { class: 'small muted' }, 'Expand more videos to find hubs.')),
    h('section', { class: 'card' }, h('h3', {}, 'Outliers in the web'), h('div', { class: 'mini' }, ins.outliers.map((n) => nodeButton(n)))),
    ins.clusters.length > 0 &&
      h('section', { class: 'card' }, h('h3', {}, 'Topic clusters'), h('p', { class: 'small muted' }, 'Click to highlight.'),
        h('div', { class: 'chips' }, ins.clusters.map((c) => h('button', { class: 'chip', onclick: () => { highlight = new Set(c.ids); selected = null; render(); } }, `${c.label.join(' · ')} (${c.ids.length}, ${c.outliers} outliers)`)))),
    ins.outlierWords.length > 0 && h('section', { class: 'card' }, h('h3', {}, 'Words in outliers'), h('p', { class: 'small' }, ins.outlierWords.map((w) => `${w.word} (${w.lift.toFixed(1)}x)`).join(' · '))),
    h('section', { class: 'card' }, h('h3', {}, 'Channels in the web'), h('p', { class: 'small' }, ins.topChannels.map((c) => `${c.title} ×${c.count}`).join(' · '))),
    h('section', { class: 'card' }, h('h3', {}, 'AI'), aiBtn, aiBox),
  ];
}

function mdBlock(text) {
  const div = h('div', { class: 'md' });
  div.innerHTML = markdownToHtml(text); // escapes everything first
  return div;
}

async function runAi(ins, box, btn) {
  const ai = await activeAi();
  if (!ai) {
    box.replaceChildren(h('p', { class: 'small muted' }, 'AI is optional. Connect a provider in ', h('a', { href: '../options/options.html', target: '_blank' }, 'Settings'), '.'));
    return;
  }
  btn.disabled = true;
  btn.textContent = 'Thinking…';
  box.replaceChildren(h('p', { class: 'small muted' }, `Asking ${PROVIDERS[ai.provider].label}…`));
  try {
    const { system, prompt } = webPrompt(web, ins, ai.niche);
    const text = await generate({ ...ai, system, prompt });
    await send({ type: 'saveAiRun', run: { title: `Video web: ${web.nodes[web.seed].title.slice(0, 50)}`, text, provider: ai.provider, model: ai.model } });
    box.replaceChildren(mdBlock(text));
  } catch (err) {
    box.replaceChildren(h('p', { class: 'error' }, err.message));
  } finally {
    btn.disabled = false;
    btn.textContent = 'Re-run AI';
  }
}

function listView(ins) {
  const inDeg = new Map();
  for (const e of web.edges) inDeg.set(e.to, (inDeg.get(e.to) ?? 0) + 1);
  const rows = Object.values(web.nodes).filter((n) => n.title).sort((a, b) => (inDeg.get(b.id) ?? 0) - (inDeg.get(a.id) ?? 0) || (b.multiplier ?? 0) - (a.multiplier ?? 0));
  return h('table', {},
    h('thead', {}, h('tr', {}, h('th', {}, 'Video'), h('th', {}, 'Channel'), h('th', { class: 'num' }, 'Outlier'), h('th', { class: 'num' }, 'Views'), h('th', { class: 'num' }, 'Suggested from'), h('th', { class: 'num' }, 'Level'))),
    h('tbody', {}, rows.map((n) => h('tr', { onclick: () => select(n.id) }, h('td', {}, n.title), h('td', {}, n.channelTitle), h('td', { class: 'num' }, pill(n.multiplier)), h('td', { class: 'num' }, fmtNum(n.views)), h('td', { class: 'num' }, inDeg.get(n.id) ?? 0), h('td', { class: 'num' }, n.depth)))));
}

function render() {
  const ins = webInsights(web);
  const legend = h('div', { class: 'legend' },
    [['none', 'no score'], ['low', '<0.5x'], ['mid', '0.5–2x'], ['good', '2–5x'], ['great', '5–10x'], ['viral', '10x+']].map(([t, l]) => h('span', {}, h('span', { class: `dot`, style: `background:var(--dot-${t})` }), l)),
    h('span', {}, 'size = views · thick line = suggested both ways'));
  // Legend colours mirror the node fills.
  const fills = { none: '#a3a29b', low: '#e34948', mid: '#9e9d96', good: '#1baf7a', great: '#008300', viral: '#6250d6' };
  for (const [t, c] of Object.entries(fills)) document.documentElement.style.setProperty(`--dot-${t}`, c);

  main.replaceChildren(
    h('div', { class: 'layout' },
      h('div', {},
        h('div', { class: 'canvas' },
          drawGraph(ins),
          h('div', { class: 'toolbar' },
            h('button', { onclick: () => { view = { x: 0, y: 0, w: W, h: H }; render(); } }, 'Reset view'),
            h('button', { onclick: () => { showList = !showList; render(); } }, showList ? 'Hide list' : 'List view'),
            h('button', { onclick: async () => { if (confirm('Delete this web?')) { await send({ type: 'webDelete', seed: web.seed }); location.search = ''; } } }, 'Delete web')),
          legend),
        h('p', { class: 'small muted' }, `${ins.size} videos · ${ins.edges} suggestion links · ${ins.mutual.length} two-way · updated ${new Date(web.updatedAt).toLocaleString()} · drag to pan, scroll to zoom (zoom in to see thumbnails), hover or click a video for details`),
        showList && listView(ins)),
      h('aside', { class: 'side' }, selectedCard(), ...insightCards(ins))),
  );
}

function select(id) {
  selected = id;
  highlight = null;
  render();
}

async function expand(id, btn, perNode) {
  btn.disabled = true;
  btn.textContent = 'Expanding…';
  try {
    web = await send({ type: 'webExpand', seed: web.seed, id, perNode });
    render();
  } catch (err) {
    btn.textContent = err.message;
  }
}

async function build(seed) {
  selected = null;
  highlight = null;
  view = { x: 0, y: 0, w: W, h: H };
  history.replaceState(null, '', `?v=${seed}`);
  main.replaceChildren(h('div', { class: 'loading' }, 'Reading YouTube\'s suggestions two levels deep and scoring every video… (about 20 seconds)'));
  try {
    web = (await send({ type: 'webGet', seed })) ?? (await send({ type: 'webBuild', seed }));
    selected = seed;
    render();
    loadRecent();
  } catch (err) {
    main.replaceChildren(h('div', { class: 'error' }, err.reason === 'noKey' ? 'Add your YouTube API key in the extension popup first.' : err.message));
  }
}

async function loadRecent() {
  const list = await send({ type: 'webList' }).catch(() => []);
  $('recent').replaceChildren(h('option', { value: '' }, list.length ? 'Recent webs…' : 'No saved webs yet'), ...list.map((w) => h('option', { value: w.seed }, `${short(w.title, 40)} (${w.size})`)));
}

$('start').addEventListener('submit', (e) => {
  e.preventDefault();
  const id = idFrom($('seed').value);
  if (!id) return alert('Paste a YouTube video link or 11-character video ID.');
  build(id);
});
$('recent').addEventListener('change', (e) => e.target.value && build(e.target.value));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.ideas) saved = new Set(Object.keys(changes.ideas.newValue ?? {}));
});

saved = new Set(await send({ type: 'savedIds' }).catch(() => []));
loadRecent();
const start = new URLSearchParams(location.search).get('v');
if (start) {
  $('seed').value = start;
  build(start);
}
