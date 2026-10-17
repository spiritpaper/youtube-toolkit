// "From your notebook": while you write an outline or script, the notes,
// lessons and experiments that match the paragraph you're on (and the
// heading above it). Plain word matching, on your device; no AI.

import { h } from '../lib/ui.js';
import { contextAt, recall } from '../lib/notebook.js';
import { loadItems, KIND_LABEL } from '../notebook/items.js';

const HIDE_KEY = 'recall:hidden';
let itemsP = null; // shared by every panel on the page
let styled = false;
const panels = new Set();

const getItems = () => (itemsP ??= loadItems().catch(() => []));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !Object.keys(changes).some((k) => k.startsWith('sn:') || k === 'notebook' || k.startsWith('sim:'))) return;
  itemsP = null;
  for (const p of panels) p();
});

const hidden = () => {
  try {
    return localStorage.getItem(HIDE_KEY) === '1';
  } catch {
    return false;
  }
};
const setHidden = (v) => {
  try {
    localStorage.setItem(HIDE_KEY, v ? '1' : '0');
  } catch {
    // Storage can be blocked; the toggle still works for this page.
  }
};

/** A panel that follows `ta`'s caret. `title()` gives extra context (the project title and angle). */
export function recallPanel(ta, { title = () => '' } = {}) {
  if (!styled) {
    document.head.append(h('style', {}, CSS));
    styled = true;
  }
  const list = h('ul', { class: 'recall-list' });
  const about = h('span', { class: 'muted small' });
  const toggle = h('button', { class: 'small-btn', 'aria-expanded': String(!hidden()) }, hidden() ? 'Show' : 'Hide');
  const el = h('div', { class: 'recall', role: 'region', 'aria-label': 'From your notebook' },
    h('div', { class: 'recall-head' }, h('b', {}, 'From your notebook'), about, h('span', { style: 'flex:1' }), h('a', { class: 'small', href: '../notebook/notebook.html', target: '_blank' }, 'Open'), toggle),
    list);
  list.hidden = hidden();
  toggle.addEventListener('click', () => {
    setHidden(!list.hidden);
    list.hidden = !list.hidden;
    toggle.textContent = list.hidden ? 'Show' : 'Hide';
    toggle.setAttribute('aria-expanded', String(!list.hidden));
  });

  let last = '';
  async function update(force = false) {
    const ctx = contextAt(ta.value, ta.selectionStart ?? ta.value.length);
    const key = `${ctx.heading}|${ctx.paragraph}`;
    if (key === last && !force) return;
    last = key;
    const items = await getItems();
    if (!items.length) {
      about.textContent = '';
      return list.replaceChildren(h('li', { class: 'muted small' }, 'Notes you take on videos (add #tags), lessons and experiments show up here as you write.'));
    }
    if (!ctx.paragraph.trim()) {
      about.textContent = '';
      return list.replaceChildren(h('li', { class: 'muted small' }, 'Start writing: matching notes, lessons and experiments show up here.'));
    }
    const found = recall({ ...ctx, title: title() }, items, { limit: 4 });
    about.textContent = found.length ? `· for ${ctx.heading ? `"${ctx.heading.slice(0, 40)}"` : 'this paragraph'}` : '';
    list.replaceChildren(...(found.length
      ? found.map(({ item, matched }) => h('li', {},
          h('span', { class: `recall-kind k-${item.kind}` }, KIND_LABEL[item.kind]),
          h('div', { class: 'recall-body' },
            h('div', {}, item.text.length > 260 ? `${item.text.slice(0, 260)}…` : item.text),
            h('div', { class: 'muted small' },
              item.href ? h('a', { href: item.href.startsWith('http') ? item.href : `../${item.href}`, target: '_blank' }, item.sub) : item.sub,
              ` · matches ${matched.slice(0, 4).join(', ')}`))))
      : [h('li', { class: 'muted small' }, 'Nothing in your notebook matches this paragraph yet.')]));
  }
  let timer = null;
  const soon = () => {
    clearTimeout(timer);
    timer = setTimeout(update, 450);
  };
  for (const ev of ['input', 'click', 'keyup', 'focus']) ta.addEventListener(ev, soon);
  panels.add(() => update(true));
  update();
  return el;
}

const CSS = `
.recall { margin-top: 8px; border: 1px dashed var(--border); border-radius: 10px; padding: 8px 10px; background: var(--bg-2); }
.recall-head { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; font-size: 13px; }
.recall-list { list-style: none; margin: 6px 0 0; padding: 0; display: grid; gap: 6px; }
.recall-list li { display: flex; gap: 8px; align-items: flex-start; font-size: 13px; line-height: 1.45; }
.recall-body { flex: 1; min-width: 0; white-space: pre-line; }
.recall-kind { flex: none; font-size: 11px; padding: 1px 7px; border-radius: 999px; background: var(--bg-3); margin-top: 1px; }
.recall-kind.k-lesson, .recall-kind.k-auto-lesson { background: var(--t-good-bg); color: var(--t-good); }
.recall-kind.k-experiment { background: var(--t-great-bg); color: var(--t-great); }
`;
