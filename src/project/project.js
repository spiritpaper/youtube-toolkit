import { mountShell } from '../lib/nav.js';
import { send, h, fmtMult, fmtNum, tier, videoUrl, ageText } from '../lib/ui.js';
import { STATUSES } from '../lib/projects.js';
import { activeAi, generate, projectOutlinePrompt, PROVIDERS } from '../lib/ai.js';
import { markdownToHtml } from '../lib/markdown.js';
import { mdEditor } from '../lib/md-view.js';
import { scriptToolsSection } from './script-tools.js';
import { shotListSection, thumbnailSection, publishedSection } from './production.js';
import { screeningSection } from './screening-card.js';
import { askPanel } from '../lab/ask-panel.js';
import { accuracySection } from './accuracy-card.js';
import { recallPanel } from './recall.js';

mountShell('board');
const main = document.getElementById('main');
const id = new URLSearchParams(location.search).get('id');
let project = null;
let ideas = {};
let transcripts = {};

// Debounced autosave per field.
const timers = {};
function autosave(field, value, status) {
  clearTimeout(timers[field]);
  status.textContent = 'Saving…';
  timers[field] = setTimeout(async () => {
    project = await send({ type: 'projectUpdate', id, patch: { [field]: value } });
    status.textContent = `Saved ${new Date().toLocaleTimeString()}`;
  }, 600);
}
const field = (name, cls, placeholder) => {
  const status = h('span', { class: 'saving' });
  const ta = h('textarea', { class: cls, placeholder, value: project[name] ?? '', oninput: (e) => autosave(name, e.target.value, status) });
  return { ta, status };
};
function mdBlock(text) {
  const div = h('div', { class: 'md' });
  div.innerHTML = markdownToHtml(text); // escapes everything first
  return div;
}

function ideaSection() {
  const angle = field('angle', 'mid', 'The angle: what makes your version different, who it is for, the promise to the viewer…');
  const notes = field('notes', 'mid', 'Research notes, links, things to film…');
  return h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', {}, 'The idea'), angle.status), angle.ta, h('div', { class: 'card-head' }, h('h2', { class: 'small muted' }, 'Notes'), notes.status), notes.ta);
}

function inspirationSection() {
  const linked = (project.inspiration ?? []).map((vid) => ideas[vid] ?? { id: vid, title: vid, thumb: `https://i.ytimg.com/vi/${vid}/mqdefault.jpg` });
  const options = Object.values(ideas).filter((i) => !(project.inspiration ?? []).includes(i.id)).sort((a, b) => b.savedAt - a.savedAt);
  const picker = h('select', { 'aria-label': 'Add a saved outlier' }, h('option', { value: '' }, options.length ? 'Add a saved outlier…' : 'No more saved outliers'), options.map((i) => h('option', { value: i.id }, `${fmtMult(i.stats?.multiplier ?? i.multiplier)} · ${i.title.slice(0, 70)}`)));
  picker.addEventListener('change', async () => {
    if (!picker.value) return;
    project = await send({ type: 'projectUpdate', id, patch: { addInspiration: picker.value } });
    render();
  });
  return h(
    'section',
    { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', {}, `Inspiration (${linked.length})`), picker),
    linked.length
      ? h('div', { class: 'insp' }, linked.map((i) =>
          h('div', { class: 'insp-card' },
            h('img', { src: i.thumb, alt: '' }),
            h('div', { class: 'b' },
              h('a', { href: videoUrl(i), target: '_blank' }, i.title),
              h('div', { class: 'muted small' }, `${i.channelTitle ?? ''} · ${fmtNum(i.views)} views `, h('span', { class: `pill tier-${tier(i.stats?.multiplier ?? i.multiplier)}` }, fmtMult(i.stats?.multiplier ?? i.multiplier))),
              h('div', { class: 'acts' },
                transcripts[i.id] && h('a', { href: `../script/script.html?id=${i.id}` }, 'Script analysis'),
                h('button', { onclick: async () => { project = await send({ type: 'projectUpdate', id, patch: { inspiration: project.inspiration.filter((x) => x !== i.id) } }); render(); } }, 'Remove'))))))
      : h('p', { class: 'muted small' }, 'Link the outliers this video is modelled on. Their scripts and stats feed the AI outline.'),
  );
}

function titlesSection() {
  const status = h('span', { class: 'saving' });
  const ta = h('textarea', {
    class: 'mid',
    placeholder: 'One title idea per line',
    value: (project.titles ?? []).join('\n'),
    oninput: (e) => autosave('titles', e.target.value.split('\n').map((t) => t.trim()).filter(Boolean), status),
  });
  return h('section', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', {}, 'Titles'), status,
      h('button', {
        onclick: async () => {
          const drafts = ta.value.trim() || project.title;
          await chrome.storage.local.set({ titleLab: { drafts, keyword: '', thumbnailText: '' } });
          location.href = '../studio/studio.html#titles';
        },
      }, 'Test in Title lab →')),
    ta);
}

function outlineSection() {
  const { ta, status } = field('outline', 'big', 'Hook, beats, payoff… or let AI draft it from your linked outliers.');
  const editor = mdEditor(ta, 'outline');
  const out = h('div', {});
  const btn = h('button', { class: 'primary' }, 'Draft outline with AI');
  btn.addEventListener('click', async () => {
    const ai = await activeAi();
    if (!ai) return out.replaceChildren(h('p', { class: 'muted small' }, 'AI is optional. Connect a provider in ', h('a', { href: '../options/options.html' }, 'Settings'), '.'));
    btn.disabled = true;
    btn.textContent = 'Thinking…';
    out.replaceChildren(h('div', { class: 'loading inline' }, `Drafting with ${PROVIDERS[ai.provider].label} (${ai.model})…`));
    try {
      const insp = (project.inspiration ?? []).map((vid) => ({ ...(ideas[vid] ?? { id: vid, title: vid }), scriptAi: transcripts[vid]?.ai?.text }));
      const { system, prompt } = projectOutlinePrompt(project, insp, ai.niche);
      const text = await generate({ ...ai, system, prompt });
      ta.value = ta.value ? `${ta.value}\n\n---\n\n${text}` : text;
      autosave('outline', ta.value, status);
      editor.preview();
      out.replaceChildren(h('p', { class: 'muted small' }, `Added to the outline by ${PROVIDERS[ai.provider].label} (${ai.model}). Edit freely.`));
    } catch (err) {
      out.replaceChildren(h('p', { class: 'error' }, err.message));
    } finally {
      btn.disabled = false;
      btn.textContent = 'Draft outline with AI';
    }
  });
  return h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', {}, 'Outline'), status, editor.tabs, btn), out, editor.view, recallPanel(ta, { title: recallContext }));
}

// The project's title and angle add a little context to notebook recall.
const recallContext = () => `${project.title} ${project.angle ?? ''}`;

let scriptArea = null;
function scriptSection() {
  const { ta, status } = field('script', 'big', 'Write or paste your script here.');
  scriptArea = ta;
  const count = h('span', { class: 'muted small' });
  const update = () => {
    const words = ta.value.split(/\s+/).filter(Boolean).length;
    count.textContent = `${words} words · about ${Math.max(1, Math.round(words / 150))} min at 150 wpm`;
  };
  ta.addEventListener('input', update);
  update();
  return h('section', { class: 'card', id: 'script' }, h('div', { class: 'card-head' }, h('h2', {}, 'Script'), count, status), ta, recallPanel(ta, { title: recallContext }));
}

function render() {
  const title = h('input', { class: 'title', value: project.title, 'aria-label': 'Working title' });
  const tStatus = h('span', { class: 'saving' });
  title.addEventListener('input', () => autosave('title', title.value, tStatus));
  const status = h('select', { 'aria-label': 'Status' }, STATUSES.map((s) => h('option', { value: s.id, selected: s.id === project.status }, s.label)));
  const archiveBtn = h('button', { title: 'Move off the board, keeping its numbers', hidden: project.status !== 'published' || !!project.archivedAt, onclick: async () => { project = await send({ type: 'projectUpdate', id, patch: { archived: true } }); render(); } }, 'Archive');
  status.addEventListener('change', async () => {
    project = await send({ type: 'projectUpdate', id, patch: { status: status.value } });
    archiveBtn.hidden = project.status !== 'published' || !!project.archivedAt;
    if (!project.archivedAt) document.querySelector('.banner')?.remove();
  });
  document.title = `${project.title} · YT Toolkit`;
  main.replaceChildren(
    h('a', { class: 'crumb', href: '../board/board.html' }, '← Idea board'),
    project.archivedAt ? h('div', { class: 'banner' }, `Archived ${ageText(project.archivedAt)}. It's off the board and kept with its final numbers.`, ' ',
      h('button', { onclick: async () => { project = await send({ type: 'projectUpdate', id, patch: { archived: false } }); render(); } }, 'Back to board'),
      ' ', h('a', { href: '../board/board.html#archive' }, 'Open the archive')) : '',
    h('div', { class: 'head' }, title, tStatus, status,
      archiveBtn,
      h('button', { class: 'danger', onclick: async () => { if (confirm('Delete this project?')) { await send({ type: 'projectDelete', id }); location.href = '../board/board.html'; } } }, 'Delete')),
    h('p', { class: 'muted small' }, `Created ${ageText(project.createdAt)} · updated ${ageText(project.updatedAt)}`),
    ideaSection(),
    h('section', { class: 'card', id: 'ask' }, h('div', { class: 'card-head' }, h('h2', {}, 'Ask your audience')), askPanel({ project })),
    inspirationSection(),
    titlesSection(),
    outlineSection(),
    scriptSection(),
    scriptToolsSection(project, {
      getScript: () => scriptArea?.value ?? project.script ?? '',
      ideas,
      transcripts,
      save: async (patch) => (project = await send({ type: 'projectUpdate', id, patch })),
    }),
    shotListSection(project, { save: async (patch) => (project = await send({ type: 'projectUpdate', id, patch })) }),
    thumbnailSection(project, { ideas }),
    screeningSection(project),
    publishedSection(project, { ideas, onChange: (p) => { project = p; render(); } }),
    accuracySection(project),
  );
}

const [all, store] = await Promise.all([send({ type: 'projects' }), chrome.storage.local.get(null)]);
project = all[id];
ideas = store.ideas ?? {};
transcripts = Object.fromEntries(Object.entries(store).filter(([k]) => k.startsWith('tx:')).map(([k, v]) => [k.slice(3), v]));
if (!project) main.replaceChildren(h('div', { class: 'empty-state' }, h('h2', {}, 'Project not found'), h('a', { href: '../board/board.html' }, '← Idea board')));
else render();
