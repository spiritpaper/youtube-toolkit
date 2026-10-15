// Edit / Preview switch for text areas that hold Markdown (outline, shot list,
// script), so AI drafts read as formatted text instead of raw ** and |.

import { h } from './ui.js';
import { markdownToHtml } from './markdown.js';

export function mdBlock(text) {
  const div = h('div', { class: 'md' });
  div.innerHTML = markdownToHtml(text); // escapes everything first
  return div;
}

const MODE_KEY = 'mdMode:';
const readMode = (id) => {
  try {
    return localStorage.getItem(MODE_KEY + id);
  } catch {
    return null;
  }
};
const writeMode = (id, mode) => {
  try {
    localStorage.setItem(MODE_KEY + id, mode);
  } catch {
    // Private windows can refuse storage; the switch still works.
  }
};

/**
 * Wraps `ta` with a preview pane. Returns { tabs, view, preview() }: put
 * `tabs` in the card header and `view` where the textarea was. Call
 * `preview()` after filling the textarea from code (e.g. an AI draft).
 * The chosen mode is remembered per `id`.
 */
export function mdEditor(ta, id) {
  const pane = h('div', { class: 'md md-preview', tabindex: '0' });
  const editBtn = h('button', { type: 'button', role: 'tab' }, 'Edit');
  const viewBtn = h('button', { type: 'button', role: 'tab' }, 'Preview');
  const tabs = h('div', { class: 'md-tabs', role: 'tablist', 'aria-label': 'Edit or preview' }, editBtn, viewBtn);
  const view = h('div', { class: 'md-editor' }, ta, pane);

  const set = (mode) => {
    const previewing = mode === 'preview';
    if (previewing) {
      pane.innerHTML = ta.value.trim() ? markdownToHtml(ta.value) : '';
      if (!ta.value.trim()) pane.append(h('p', { class: 'muted' }, 'Nothing here yet. Switch to Edit to write.'));
    }
    ta.hidden = previewing;
    pane.hidden = !previewing;
    editBtn.setAttribute('aria-selected', String(!previewing));
    viewBtn.setAttribute('aria-selected', String(previewing));
    writeMode(id, mode);
  };
  editBtn.addEventListener('click', () => {
    set('edit');
    ta.focus();
  });
  viewBtn.addEventListener('click', () => set('preview'));
  // Double-click the preview to jump back into editing.
  pane.addEventListener('dblclick', () => {
    set('edit');
    ta.focus();
  });
  set(readMode(id) === 'preview' && ta.value.trim() ? 'preview' : 'edit');
  return { tabs, view, preview: () => set('preview') };
}
