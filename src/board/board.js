import { mountShell } from '../lib/nav.js';
import { send, h, ageText } from '../lib/ui.js';
import { STATUSES } from '../lib/projects.js';

mountShell('board');
const board = document.getElementById('board');
let projects = {};
let ideas = {};

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
    h('div', { class: 'a' }, `updated ${ageText(p.updatedAt)}`),
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

function render() {
  board.replaceChildren(
    ...STATUSES.map((s) => {
      const list = Object.values(projects).filter((p) => p.status === s.id).sort((a, b) => b.updatedAt - a.updatedAt);
      const col = h('section', { class: 'col', 'aria-label': s.label },
        h('h2', {}, h('span', {}, s.label), h('span', {}, list.length)),
        ...list.map(card),
        list.length === 0 && h('div', { class: 'hint' }, s.id === 'idea' ? 'Add an idea above, or click "Start project" on a saved outlier, content gap or AI outline.' : 'Drag cards here'));
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

[projects, { ideas = {} }] = await Promise.all([send({ type: 'projects' }), chrome.storage.local.get('ideas')]);
render();
