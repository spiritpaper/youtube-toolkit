// "Test screening" on a project: run the video past an Audience lab group.

import { send, h } from '../lib/ui.js';
import { activeAi } from '../lib/ai.js';
import { runScreening } from '../lab/screen-run.js';
import { renderReport, REPORT_CSS } from '../lab/report.js';

let styled = false;

/** principles: optional story principles the fixes may cite. */
export function screeningSection(project, { principles = [] } = {}) {
  if (!styled) {
    document.head.append(h('style', {}, REPORT_CSS));
    styled = true;
  }
  const body = h('div', {});
  const section = h('section', { class: 'card', id: 'screening' }, h('div', { class: 'card-head' }, h('h2', {}, 'Test screening')), body);

  async function draw(status = null) {
    const [groups, sims] = await Promise.all([send({ type: 'avatarGroups' }).catch(() => ({})), send({ type: 'screenings', projectId: project.id }).catch(() => [])]);
    const list = Object.values(groups).filter((g) => g.avatars.length);
    if (!list.length) {
      body.replaceChildren(h('p', { class: 'muted' }, 'Run this video past a test audience before you publish: who clicks, who stays past the opening, where they leave and what they\'d comment. ', h('a', { href: '../lab/lab.html' }, 'Build your audience in the Audience lab →')));
      return;
    }
    const titles = [...new Set([project.title, ...(project.titles ?? [])].map((t) => t?.trim()).filter(Boolean))];
    const groupSel = h('select', { 'aria-label': 'Audience group' }, list.map((g) => h('option', { value: g.id }, `${g.name} (${g.avatars.length})`)));
    const titleSel = h('select', { 'aria-label': 'Title to test' }, titles.map((t) => h('option', { value: t }, t.length > 70 ? `${t.slice(0, 70)}…` : t)));
    const run = h('button', { class: 'primary' }, 'Run test screening');
    const what = project.script?.trim() ? 'title, opening and script' : project.outline?.trim() ? 'title, opening and outline (write the script for a sharper screening)' : 'title only (add an outline or script to test the story)';
    run.addEventListener('click', async () => {
      const ai = await activeAi();
      if (!ai) return draw(h('p', { class: 'muted' }, 'Test screenings use AI. Connect a provider in ', h('a', { href: '../options/options.html' }, 'Settings'), '.'));
      run.disabled = true;
      const progress = h('div', { class: 'loading inline' }, 'Starting…');
      body.replaceChildren(progress);
      try {
        // The project page autosaves as you type; screen what's saved now.
        const fresh = (await send({ type: 'projects' }))[project.id] ?? project;
        await runScreening({ ai, project: fresh, group: groups[groupSel.value], title: titleSel.value, principles, onProgress: (t) => (progress.textContent = t) });
        draw();
      } catch (err) {
        draw(err.cancelled ? null : h('p', { class: 'error' }, err.message));
      }
    });
    const latest = sims[0];
    body.replaceChildren(
      h('p', { class: 'muted small' }, `Tests the ${what}: 3 AI calls. Each viewer reacts as themselves, honestly.`),
      h('div', { class: 'row', style: 'display:flex;gap:8px;flex-wrap:wrap;align-items:center' }, groupSel, titleSel, run),
      status,
      latest && renderReport(latest, { compact: true }),
      sims.length > 1 && h('details', {}, h('summary', { class: 'small' }, `Earlier screenings (${sims.length - 1})`),
        h('ul', { class: 'small' }, sims.slice(1).map((s) => h('li', {}, h('a', { href: `../lab/lab.html#sim=${s.id}` }, `${new Date(s.at).toLocaleDateString()} · "${s.title}" · ${s.groupName}`), ` · would click ${Math.round(s.result.clickShare * 100)}%, watch ${s.result.watchedShare == null ? '—' : `${Math.round(s.result.watchedShare * 100)}%`}`)))));
  }
  draw();
  return section;
}
