import { mountShell } from '../lib/nav.js';
import { send, h, ageText, fmtNum, fmtMult, fmtDate, tier } from '../lib/ui.js';
import { STATUSES, finalNumbers, ARCHIVE_DAYS_DEFAULT } from '../lib/projects.js';

mountShell('board');
const board = document.getElementById('board');
let projects = {};
let ideas = {};
let view = location.hash === '#archive' ? 'archive' : 'board';
let archiveDays = ARCHIVE_DAYS_DEFAULT;
let archiveQuery = '';
let archiveSort = 'published';
const isArchived = (p) => !!p.archivedAt;
const STALE_DAYS = 14;
const SORTS = {
  updated: { label: 'Recently updated', key: (p) => -(p.updatedAt ?? 0) },
  stale: { label: 'Untouched longest', key: (p) => p.updatedAt ?? 0 },
  newest: { label: 'Newest ideas', key: (p) => -(p.createdAt ?? 0) },
  oldest: { label: 'Oldest ideas', key: (p) => p.createdAt ?? 0 },
  title: { label: 'Title A–Z', key: (p) => p.title.toLowerCase() },
};
const remembered = (() => {
  try {
    return JSON.parse(localStorage.getItem('boardView') ?? '{}');
  } catch {
    return {};
  }
})();
let boardQuery = '';
let boardSort = SORTS[remembered.sort] ? remembered.sort : 'updated';
let onlyStale = false;
const remember = () => {
  try {
    localStorage.setItem('boardView', JSON.stringify({ sort: boardSort }));
  } catch {}
};
const isStale = (p) => p.status !== 'published' && Date.now() - (p.updatedAt ?? 0) > STALE_DAYS * 86_400_000;
const matches = (p, q) => !q || `${p.title} ${p.angle ?? ''} ${p.notes ?? ''} ${(p.titles ?? []).join(' ')}`.toLowerCase().includes(q);
const bySort = (a, b) => {
  const ka = SORTS[boardSort].key(a);
  const kb = SORTS[boardSort].key(b);
  return typeof ka === 'string' ? ka.localeCompare(kb) : ka - kb;
};

const open = (id) => (location.href = `../project/project.html?id=${id}`);

function card(p) {
  const thumbs = (p.inspiration ?? []).slice(0, 3).map((id) => ideas[id]?.thumb ?? `https://i.ytimg.com/vi/${id}/mqdefault.jpg`);
  const el = h(
    'article',
    { class: 'pcard', draggable: 'true', tabindex: '0', onclick: (e) => e.target.tagName !== 'SELECT' && open(p.id), onkeydown: (e) => e.key === 'Enter' && open(p.id) },
    h('div', { class: 't' }, p.title),
    p.angle && h('div', { class: 'a' }, p.angle),
    thumbs.length > 0 && h('div', { class: 'thumbs' }, thumbs.map((src) => h('img', { src, alt: '' }))),
    h('div', { class: 'chips' },
      [['titles', (p.titles ?? []).length > 0], ['outline', !!p.outline], ['script', !!p.script], ['shot list', !!p.shotList]].map(([l, on]) => h('span', { class: `chip${on ? ' on' : ''}` }, `${on ? '✓ ' : ''}${l}`))),
    h('select', {
      'aria-label': 'Move to',
      onchange: (e) => move(p.id, e.target.value),
    }, STATUSES.map((s) => h('option', { value: s.id, selected: s.id === p.status }, s.label))),
    h('div', { class: `a${isStale(p) ? ' stale' : ''}`, title: isStale(p) ? `Not touched in ${STALE_DAYS}+ days` : '' }, `updated ${ageText(p.updatedAt)}`),
  );
  el.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', p.id);
    el.classList.add('dragging');
  });
  el.addEventListener('dragend', () => el.classList.remove('dragging'));
  return el;
}

async function move(id, status) {
  await send({ type: 'projectUpdate', id, patch: { status } });
}

function boardTools() {
  const search = h('input', { type: 'search', placeholder: 'Filter cards…', value: boardQuery, 'aria-label': 'Filter cards by title, angle or notes' });
  search.addEventListener('input', () => {
    boardQuery = search.value;
    renderBoard();
  });
  const sort = h('select', { 'aria-label': 'Sort cards in each column', onchange: (e) => { boardSort = e.target.value; remember(); renderBoard(); } },
    Object.entries(SORTS).map(([id, s]) => h('option', { value: id, selected: id === boardSort }, s.label)));
  const staleCount = Object.values(projects).filter((p) => !isArchived(p) && isStale(p)).length;
  const stale = h('button', {
    type: 'button',
    'aria-pressed': String(onlyStale),
    title: `Cards not touched in ${STALE_DAYS}+ days (published ones aside)`,
    onclick: () => { onlyStale = !onlyStale; renderBoard(); },
  }, `Needs attention${staleCount ? ` (${staleCount})` : ''}`);
  return h('div', { class: 'btools' }, search, sort, stale);
}

function renderBoard() {
  board.className = 'board';
  const tools = document.getElementById('btools');
  // Keep the filter box (and its cursor) when only the columns change.
  if (!tools.firstChild || tools.dataset.stale !== String(onlyStale) || tools.dataset.count !== String(Object.keys(projects).length)) {
    const had = document.activeElement?.closest?.('#btools input[type=search]');
    tools.replaceChildren(boardTools());
    tools.dataset.stale = String(onlyStale);
    tools.dataset.count = String(Object.keys(projects).length);
    if (had) {
      const i = tools.querySelector('input[type=search]');
      i.focus();
      i.setSelectionRange(i.value.length, i.value.length);
    }
  }
  board.replaceChildren(
    ...STATUSES.map((s) => {
      const q = boardQuery.trim().toLowerCase();
      const all = Object.values(projects).filter((p) => p.status === s.id && !isArchived(p));
      const list = all.filter((p) => matches(p, q) && (!onlyStale || isStale(p))).sort(bySort);
      const hidden = all.length - list.length;
      const col = h('section', { class: 'col', 'aria-label': s.label },
        h('h2', {}, h('span', {}, s.label), h('span', { title: hidden ? `${hidden} hidden by the filter` : '' }, hidden ? `${list.length} of ${all.length}` : list.length)),
        ...list.map(card),
        list.length === 0 && h('div', { class: 'hint' }, hidden ? 'Nothing here matches the filter.' : s.id === 'idea' ? 'Add an idea above, or click "Start project" on a saved outlier, content gap or AI outline.' : 'Drag cards here'),
        s.id === 'published' && h('div', { class: 'hint small' }, archiveDays > 0 ? `Videos move to the Archive ${archiveDays} days after they go live.` : 'Automatic archiving is off.', ' ', h('a', { href: '../options/options.html#board' }, 'Change')));
      col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('over'); });
      col.addEventListener('dragleave', () => col.classList.remove('over'));
      col.addEventListener('drop', (e) => {
        e.preventDefault();
        col.classList.remove('over');
        const id = e.dataTransfer.getData('text/plain');
        if (projects[id] && projects[id].status !== s.id) move(id, s.id);
      });
      return col;
    }),
  );
}


function archiveRow(p) {
  const f = finalNumbers(p);
  const thumb = f.thumb ?? (f.videoId ? `https://i.ytimg.com/vi/${f.videoId}/mqdefault.jpg` : null);
  const milestone = (label, m) => h('div', { class: 'num' }, h('span', { class: 'k' }, label), h('b', {}, m ? `${fmtNum(m.views)} · ${fmtMult(m.multiplier)}` : '—'));
  return h('article', { class: 'arow' },
    thumb ? h('img', { src: thumb, alt: '', loading: 'lazy' }) : h('div', { class: 'noimg', 'aria-hidden': 'true' }, '▶'),
    h('div', { class: 'grow' },
      h('a', { class: 't', href: `../project/project.html?id=${p.id}` }, p.title),
      h('div', { class: 'muted small' }, [f.publishedAt && `published ${fmtDate(f.publishedAt)}`, `archived ${ageText(p.archivedAt)}`, !f.videoId && 'no video linked'].filter(Boolean).join(' · '))),
    h('div', { class: 'nums' },
      h('div', { class: 'num' }, h('span', { class: 'k' }, 'Views'), h('b', {}, fmtNum(f.views))),
      h('div', { class: 'num' }, h('span', { class: 'k' }, 'Outlier score'), f.multiplier == null ? h('b', {}, '—') : h('span', { class: `pill tier-${tier(f.multiplier)}` }, fmtMult(f.multiplier))),
      milestone('At 48 h', f.h48),
      milestone('At 7 days', f.d7)),
    h('div', { class: 'acts' },
      f.videoId && h('a', { class: 'button-link', href: `https://www.youtube.com/watch?v=${f.videoId}`, target: '_blank', rel: 'noopener' }, 'Watch'),
      h('button', { onclick: () => send({ type: 'projectUpdate', id: p.id, patch: { archived: false } }) }, 'Back to board'),
      h('button', { class: 'x', title: 'Delete project', 'aria-label': `Delete ${p.title}`, onclick: async () => { if (confirm(`Delete "${p.title}" and its tracking data?`)) await send({ type: 'projectDelete', id: p.id }); } }, '✕')));
}

function renderArchive() {
  board.className = 'archive';
  const all = Object.values(projects).filter(isArchived);
  const q = archiveQuery.trim().toLowerCase();
  const key = {
    published: (p) => finalNumbers(p).publishedAt ?? 0,
    views: (p) => finalNumbers(p).views ?? -1,
    score: (p) => finalNumbers(p).multiplier ?? -1,
  }[archiveSort];
  const list = all.filter((p) => !q || `${p.title} ${p.angle ?? ''}`.toLowerCase().includes(q)).sort((a, b) => key(b) - key(a));
  const search = h('input', { type: 'search', placeholder: 'Search the archive…', value: archiveQuery, 'aria-label': 'Search the archive' });
  search.addEventListener('input', () => {
    archiveQuery = search.value;
    const pos = search.selectionStart;
    render();
    const again = board.querySelector('input[type=search]');
    again.focus();
    again.setSelectionRange(pos, pos);
  });
  const sort = h('select', { 'aria-label': 'Sort the archive', onchange: (e) => { archiveSort = e.target.value; render(); } },
    [['published', 'Newest first'], ['views', 'Most views'], ['score', 'Best outlier score']].map(([v, l]) => h('option', { value: v, selected: v === archiveSort }, l)));
  board.replaceChildren(
    h('div', { class: 'atools' }, search, sort, h('span', { class: 'muted small' }, archiveDays > 0 ? `Published videos move here ${archiveDays} days after they go live.` : 'Automatic archiving is off.', ' ', h('a', { href: '../options/options.html#board' }, 'Change'))),
    ...(list.length
      ? list.map(archiveRow)
      : [h('div', { class: 'empty-state' },
          h('h2', {}, all.length ? 'Nothing matches' : 'The archive is empty'),
          h('p', {}, all.length ? 'Try another word.' : `Published videos land here ${archiveDays > 0 ? `${archiveDays} days after they go live` : 'when you archive them from their project page'}, with the numbers they finished on, so the board stays about what you're making now.`))]),
  );
}

function render() {
  const archived = Object.values(projects).filter(isArchived).length;
  document.getElementById('views').replaceChildren(
    ...[['board', 'Board'], ['archive', `Archive${archived ? ` (${archived})` : ''}`]].map(([id, label]) =>
      h('button', { type: 'button', 'aria-pressed': String(view === id), onclick: () => { view = id; history.replaceState(null, '', id === 'archive' ? '#archive' : '#'); render(); } }, label)),
  );
  document.getElementById('new').hidden = view === 'archive';
  const tools = document.getElementById('btools');
  tools.hidden = view === 'archive';
  if (view === 'archive') renderArchive();
  else renderBoard();
}

document.getElementById('new').addEventListener('submit', async (e) => {
  e.preventDefault();
  const p = await send({ type: 'projectCreate', data: { title: document.getElementById('new-title').value } });
  document.getElementById('new-title').value = '';
  open(p.id);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.projects) {
    projects = changes.projects.newValue ?? {};
    render();
  }
});

await send({ type: 'projectsArchiveOld' }).catch(() => {});
let archiveAfterDays;
[projects, { ideas = {}, archiveAfterDays }] = await Promise.all([send({ type: 'projects' }), chrome.storage.local.get(['ideas', 'archiveAfterDays'])]);
archiveDays = archiveAfterDays ?? ARCHIVE_DAYS_DEFAULT;
render();
