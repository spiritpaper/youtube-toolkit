// Lab notebook: every note you took on videos, the lessons you (and your
// checked screenings) learned, and experiments that test an idea across
// videos against the real numbers.

import { mountShell } from '../lib/nav.js';
import { send, h, emptyState } from '../lib/ui.js';
import { mdBlock } from '../lib/md-view.js';
import { formatTime } from '../lib/stats.js';
import { MEASURES, experimentResults, resultsVerdict } from '../lib/notebook.js';
import { loadItems, STATUS_LABEL } from './items.js';

mountShell('notebook');
const main = document.getElementById('main');

const TABS = [['notes', 'Notes'], ['lessons', 'Lessons'], ['experiments', 'Experiments']];
let tab = 'notes';
let focusX = null; // experiment to scroll to
let q = '';
let tag = null;
let items = [];
let nb = { lessons: {}, experiments: {} };
let projects = {};
let sims = [];
let addingXp = false;

function readHash() {
  const hash = location.hash.slice(1);
  focusX = hash.startsWith('x=') ? hash.slice(2) : null;
  tab = focusX ? 'experiments' : TABS.some(([id]) => id === hash) ? hash : 'notes';
}

function tabs() {
  const go = (t) => {
    tab = t;
    tag = null; // tags differ per tab
    history.replaceState(null, '', t === 'notes' ? '#' : `#${t}`);
    render();
  };
  return h('div', { class: 'tabs', role: 'tablist' }, TABS.map(([id, label]) => h('button', { role: 'tab', 'aria-selected': String(tab === id), onclick: () => go(id) }, label)));
}

const matches = (it) => (!tag || it.tags.includes(tag)) && (!q || `${it.text} ${it.sub}`.toLowerCase().includes(q.toLowerCase()));

function filterBar(kinds) {
  const counts = {};
  for (const it of items.filter((i) => kinds.includes(i.kind))) for (const t of it.tags) counts[t] = (counts[t] ?? 0) + 1;
  const input = h('input', { type: 'search', placeholder: 'Filter…', value: q, 'aria-label': 'Filter' });
  input.addEventListener('input', () => {
    q = input.value;
    renderBody();
  });
  const tags = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 30);
  return h('div', { class: 'filter' }, input,
    tags.length ? h('div', { class: 'chips' }, tags.map(([t, n]) => h('button', { class: 'chip', 'aria-pressed': String(tag === t), onclick: () => { tag = tag === t ? null : t; render(); } }, `#${t} ${n}`))) : null);
}

const tagChips = (tags) => (tags.length ? h('div', { class: 'chips' }, tags.map((t) => h('span', { class: 'chip' }, `#${t}`))) : null);

// ---------- notes ----------

function notesView() {
  const notes = items.filter((i) => i.kind === 'note');
  if (!notes.length) {
    return h('section', { class: 'card' }, emptyState('No notes yet', 'Take notes while you watch: "Add note" in the Outlier Lab panel on YouTube, or in the Script lab. Add #tags (like #hook or #pacing) to group them. They come back to you while you write a project\'s outline or script.', [{ label: 'Open the Script lab', href: '../script/script.html' }]));
  }
  const shown = notes.filter(matches);
  const byVideo = new Map();
  for (const n of shown) byVideo.set(n.videoId, [...(byVideo.get(n.videoId) ?? []), n]);
  return h('div', { class: 'list' },
    h('p', { class: 'muted small' }, `${notes.length} note${notes.length === 1 ? '' : 's'} on ${new Set(notes.map((n) => n.videoId)).size} video${new Set(notes.map((n) => n.videoId)).size === 1 ? '' : 's'}. Add #tags to a note to group it.`),
    shown.length ? [...byVideo.values()].map((list) => h('section', { class: 'card video' },
      h('h3', {}, list[0].title, list[0].lab && h('a', { class: 'small', href: `../${list[0].lab}` }, 'Script lab'), h('a', { class: 'small', href: `https://www.youtube.com/watch?v=${list[0].videoId}`, target: '_blank' }, 'YouTube')),
      h('ol', { class: 'notes' }, [...list].sort((a, b) => a.t - b.t).map((n) => h('li', {}, h('a', { class: 'time', href: n.href, target: '_blank', title: 'Open the video at this moment' }, formatTime(n.t)), h('div', {}, mdBlock(n.text), tagChips(n.tags)))))))
      : h('p', { class: 'muted' }, 'No notes match.'));
}

// ---------- lessons ----------

function lessonEntry(it) {
  const own = it.kind === 'lesson';
  const acts = own
    ? [h('button', { class: 'small-btn', onclick: () => editLesson(it, entry) }, 'Edit'), h('button', { class: 'small-btn', title: 'Delete', 'aria-label': 'Delete lesson', onclick: () => confirm('Delete this lesson?') && send({ type: 'lessonDelete', id: it.id }).then(reload) }, '✕')]
    : [h('button', { class: 'small-btn', title: 'Keep it as your own lesson, to edit and tag it', onclick: () => send({ type: 'lessonSave', lesson: { text: it.text, source: { ...it.raw.source, autoId: it.id } } }).then(reload) }, 'Keep & edit')];
  const entry = h('div', { class: 'entry' },
    mdBlock(it.text), tagChips(it.tags),
    h('div', { class: 'meta' }, h('span', { class: 'grow' }, it.href ? h('a', { href: `../${it.href}` }, it.sub) : it.sub, ` · ${new Date(it.at).toLocaleDateString()}`), ...acts));
  return entry;
}

function editLesson(it, entry) {
  const ta = h('textarea', { value: it.text, 'aria-label': 'Lesson' });
  entry.replaceChildren(h('div', { class: 'add' }, ta, h('div', { class: 'row' },
    h('button', { class: 'primary', onclick: () => send({ type: 'lessonSave', lesson: { id: it.id, text: ta.value } }).then(reload, (e) => alert(e.message)) }, 'Save'),
    h('button', { onclick: render }, 'Cancel'))));
  ta.focus();
}

function lessonsView() {
  const ta = h('textarea', { placeholder: 'What did you learn? e.g. "Naming the engine in the first 20 seconds keeps beginners watching #hook #beginners"', 'aria-label': 'New lesson' });
  const save = () => send({ type: 'lessonSave', lesson: { text: ta.value } }).then(reload, (e) => alert(e.message));
  ta.addEventListener('keydown', (e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && save());
  const own = items.filter((i) => i.kind === 'lesson' && matches(i));
  const auto = items.filter((i) => i.kind === 'auto-lesson' && matches(i));
  return h('div', { class: 'list' },
    h('section', { class: 'card add' }, h('h2', {}, 'Write down a lesson'), ta, h('div', { class: 'row' }, h('button', { class: 'primary', onclick: save }, 'Save lesson'), h('span', { class: 'muted small' }, 'Add #tags to group it. Ctrl+Enter saves.'))),
    h('section', { class: 'card list' }, h('h2', {}, `Your lessons (${own.length})`), own.length ? own.map(lessonEntry) : h('p', { class: 'muted small' }, q || tag ? 'None match.' : 'None yet.')),
    h('section', { class: 'card list' }, h('h2', {}, `From forecast vs reality (${auto.length})`),
      h('p', { class: 'muted small' }, 'Lessons from "Explain the differences" on published videos you test-screened. Keep one to edit and tag it.'),
      auto.length ? auto.map(lessonEntry) : h('p', { class: 'muted small' }, q || tag ? 'None match.' : 'None yet. After you publish a screened video, check it in the project\'s Forecast vs reality card and explain the differences.')));
}

// ---------- experiments ----------

const fmtVal = (v, measure) => (v == null ? '—' : MEASURES[measure].unit === '×' ? `${v.toFixed(1)}×` : `${v.toFixed(1)}%`);

function xpCard(x) {
  const res = experimentResults(x, projects, sims);
  const linked = new Set(x.projectIds);
  const pick = h('select', { 'aria-label': 'Add a video to this experiment' },
    h('option', { value: '' }, 'Add a video…'),
    Object.values(projects).filter((p) => !linked.has(p.id)).sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)).map((p) => h('option', { value: p.id }, `${p.title.slice(0, 70)} (${p.status})`)));
  const save = (patch) => send({ type: 'experimentSave', experiment: { ...x, ...patch } }).then(reload, (e) => alert(e.message));
  pick.addEventListener('change', () => pick.value && save({ projectIds: [...x.projectIds, pick.value] }));
  const status = h('select', { 'aria-label': 'Status' }, Object.entries(STATUS_LABEL).map(([k, v]) => h('option', { value: k, selected: k === x.status }, v)));
  const conclusion = h('textarea', { placeholder: 'What did you conclude? (It comes back to you while you write, like your lessons.)', value: x.conclusion, 'aria-label': 'Conclusion' });
  return h('section', { class: `card xp${focusX === x.id ? ' flash' : ''}`, id: `x-${x.id}` },
    h('div', { class: 'row' }, h('h3', { style: 'flex:1' }, x.hypothesis), h('span', { class: `status ${x.status}` }, STATUS_LABEL[x.status])),
    x.change && h('div', { class: 'small' }, h('b', {}, 'What changes: '), x.change),
    tagChips(x.tags),
    h('div', { class: 'small muted' }, `Measured by: ${MEASURES[x.measure].label}`),
    x.projectIds.length
      ? h('table', {}, h('tr', {}, h('th', {}, 'Video'), h('th', {}, 'Status'), h('th', { class: 'num' }, 'Result'), h('th', {})),
          res.rows.map((r) => h('tr', {}, h('td', {}, h('a', { href: `../project/project.html?id=${r.project.id}` }, r.project.title)), h('td', { class: 'small' }, r.project.status), h('td', { class: 'num' }, fmtVal(r.value, x.measure)),
            h('td', { class: 'num' }, h('button', { class: 'small-btn', title: 'Remove from this experiment', 'aria-label': 'Remove', onclick: () => save({ projectIds: x.projectIds.filter((id) => id !== r.project.id) }) }, '✕')))))
      : h('p', { class: 'muted small' }, 'Link the videos that try this, planned or published. Results appear once they\'re published and tracked.'),
    h('div', { class: 'row' }, pick),
    h('div', { class: 'verdict' },
      res.n ? h('div', {}, `These videos: ${fmtVal(res.value, x.measure)} (median of ${res.n}) · your other videos: ${fmtVal(res.baseline, x.measure)} (median of ${res.others})`) : null,
      resultsVerdict(res)),
    (x.measure === 'avgViewed' || x.measure === 'ctr') && h('p', { class: 'muted small' }, 'Watch time and click-through come from videos checked in Forecast vs reality (signed in). Views work for every tracked video.'),
    h('div', { class: 'row' }, 'Status:', status), conclusion,
    h('div', { class: 'row' },
      h('button', { class: 'primary', onclick: () => save({ status: status.value, conclusion: conclusion.value }) }, 'Save'),
      h('span', { style: 'flex:1' }),
      h('button', { class: 'danger', onclick: () => confirm('Delete this experiment?') && send({ type: 'experimentDelete', id: x.id }).then(reload) }, 'Delete')));
}

function newXpForm() {
  const hyp = h('input', { placeholder: 'Hypothesis, e.g. "Showing the finished game in the first 5 seconds gets more views #hook"', 'aria-label': 'Hypothesis', style: 'width:100%' });
  const change = h('textarea', { placeholder: 'What you\'ll do differently in these videos', 'aria-label': 'What changes' });
  const measure = h('select', { 'aria-label': 'Measure' }, Object.entries(MEASURES).map(([k, m]) => h('option', { value: k }, m.label)));
  return h('section', { class: 'card add' }, h('h2', {}, 'New experiment'), hyp, change,
    h('div', { class: 'row' }, 'Measure by', measure),
    h('div', { class: 'row' },
      h('button', { class: 'primary', onclick: () => send({ type: 'experimentSave', experiment: { hypothesis: hyp.value, change: change.value, measure: measure.value, projectIds: [] } }).then(() => { addingXp = false; reload(); }, (e) => alert(e.message)) }, 'Create'),
      h('button', { onclick: () => { addingXp = false; render(); } }, 'Cancel')));
}

function experimentsView() {
  const list = Object.values(nb.experiments).sort((a, b) => (a.status === 'running' ? 0 : 1) - (b.status === 'running' ? 0 : 1) || b.updatedAt - a.updatedAt);
  const shown = list.filter((x) => matches({ text: `${x.hypothesis} ${x.change} ${x.conclusion}`, sub: '', tags: x.tags }));
  return h('div', { class: 'list' },
    addingXp ? newXpForm() : h('div', {}, h('button', { class: 'primary', onclick: () => { addingXp = true; render(); } }, 'New experiment')),
    !list.length && !addingXp ? h('section', { class: 'card' }, emptyState('Test an idea across videos', 'Write a hypothesis ("a shorter intro keeps more viewers"), link the videos that try it, and see how they did against your other videos, from the real numbers. Then write down what you concluded.')) : null,
    shown.map(xpCard),
    list.length && !shown.length ? h('p', { class: 'muted' }, 'No experiments match.') : null);
}

// ---------- page ----------

let bodyEl = null;
function renderBody() {
  const view = tab === 'lessons' ? lessonsView() : tab === 'experiments' ? experimentsView() : notesView();
  bodyEl.replaceChildren(view);
}

function render() {
  const kinds = tab === 'lessons' ? ['lesson', 'auto-lesson'] : tab === 'experiments' ? ['experiment'] : ['note'];
  bodyEl = h('div', {});
  main.replaceChildren(tabs(), filterBar(kinds), bodyEl);
  renderBody();
  if (focusX) {
    document.getElementById(`x-${focusX}`)?.scrollIntoView({ block: 'center' });
    focusX = null;
  }
}

async function reload() {
  const [list, book, store, s] = await Promise.all([
    loadItems(),
    send({ type: 'notebook' }).catch(() => ({ lessons: {}, experiments: {} })),
    chrome.storage.local.get('projects'),
    send({ type: 'screenings' }).catch(() => []),
  ]);
  [items, nb, projects, sims] = [list, book, store.projects ?? {}, s];
  render();
}

readHash();
window.addEventListener('hashchange', () => {
  readHash();
  render();
});
// Notes taken on YouTube show up here right away.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && Object.keys(changes).some((k) => k.startsWith('sn:'))) reload();
});
await reload();
