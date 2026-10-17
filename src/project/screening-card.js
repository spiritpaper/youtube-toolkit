// "Test screening" on a project: run the video, or its title options, past
// an Audience lab group.

import { send, h } from '../lib/ui.js';
import { activeAi } from '../lib/ai.js';
import { runScreening, runTitleTest, projectThumbnail } from '../lab/screen-run.js';
import { renderReport, expectations, REPORT_CSS } from '../lab/report.js';

let styled = false;

/** principles: optional story principles the fixes may cite. */
export function screeningSection(project, { principles = [] } = {}) {
  if (!styled) {
    document.head.append(h('style', {}, REPORT_CSS));
    styled = true;
  }
  const body = h('div', { class: 'screening-body' });
  const section = h('section', { class: 'card', id: 'screening' }, h('div', { class: 'card-head' }, h('h2', {}, 'Test screening')), body);

  async function draw(status = null) {
    const [groups, sims, fresh] = await Promise.all([
      send({ type: 'avatarGroups' }).catch(() => ({})),
      send({ type: 'screenings', projectId: project.id }).catch(() => []),
      send({ type: 'projects' }).then((all) => all[project.id] ?? project).catch(() => project),
    ]);
    project = fresh;
    const list = Object.values(groups).filter((g) => g.avatars.length);
    if (!list.length) {
      body.replaceChildren(h('p', { class: 'muted' }, 'Run this video past a test audience before you publish: who clicks, who stays past the opening, where they leave and what they\'d comment. ', h('a', { href: '../lab/lab.html' }, 'Build your audience in the Audience lab →')), expectations());
      return;
    }
    const titles = [...new Set([project.title, ...(project.titles ?? [])].map((t) => t?.trim()).filter(Boolean))];
    const hasThumb = !!(await projectThumbnail(project).catch(() => null));
    const groupSel = h('select', { 'aria-label': 'Audience group' }, list.map((g) => h('option', { value: g.id }, `${g.name} (${g.avatars.length})`)));
    const titleSel = h('select', { 'aria-label': 'Title to test' }, titles.map((t) => h('option', { value: t }, t.length > 70 ? `${t.slice(0, 70)}…` : t)));
    const thumb = h('input', { type: 'checkbox', disabled: !hasThumb });
    const twice = h('input', { type: 'checkbox' });
    const run = h('button', { class: 'primary' }, 'Run test screening');
    const compare = h('button', { disabled: titles.length < 2, title: titles.length < 2 ? 'Add title options in the Titles section first' : 'Every viewer judges each title on its own' }, titles.length > 1 ? `Compare ${Math.min(titles.length, 4)} titles (1 AI call)` : 'Compare titles');
    const what = project.script?.trim() ? 'title, opening and script' : project.outline?.trim() ? 'title, opening and outline (write the script for a sharper screening)' : 'title only (add an outline or script to test the story)';
    const calls = () => `Screening: ${twice.checked ? 5 : 3} AI calls${thumb.checked ? ', the first with images' : ''}`;
    const cost = h('span', { class: 'muted small' }, calls());
    thumb.addEventListener('change', () => (cost.textContent = calls()));
    twice.addEventListener('change', () => (cost.textContent = calls()));

    const start = async (fn) => {
      const ai = await activeAi();
      if (!ai) return draw(h('p', { class: 'muted' }, 'Test screenings use AI. Connect a provider in ', h('a', { href: '../options/options.html' }, 'Settings'), '.'));
      run.disabled = compare.disabled = true;
      const progress = h('div', { class: 'loading inline' }, 'Starting…');
      body.replaceChildren(progress);
      try {
        await fn(ai, (t) => (progress.textContent = t));
        draw();
      } catch (err) {
        draw(err.cancelled ? null : h('p', { class: 'error' }, err.message));
      }
    };
    run.addEventListener('click', () => start((ai, onProgress) => runScreening({ ai, project, group: groups[groupSel.value], title: titleSel.value, thumbnail: thumb.checked, passes: twice.checked ? 2 : 1, principles, onProgress })));
    compare.addEventListener('click', () => start((ai, onProgress) => runTitleTest({ ai, project, group: groups[groupSel.value], titles, thumbnail: thumb.checked, onProgress })));

    const latest = sims.find((s) => s.kind !== 'titles');
    const latestTitles = sims.find((s) => s.kind === 'titles');
    const earlier = sims.filter((s) => s !== latest && s !== latestTitles);
    body.replaceChildren(...[
      h('p', { class: 'muted small' }, `Tests the ${what}. Each viewer reacts as themselves, honestly.`),
      h('div', { class: 'screen-form' },
        groupSel,
        titleSel,
        h('label', { class: 'small', title: hasThumb ? 'Viewers see your thumbnail next to the other videos\' thumbnails. Costs more tokens.' : 'Upload a thumbnail in the Thumbnail section first' }, thumb, ' Include the thumbnail'),
        h('label', { class: 'small', title: 'Two independent runs, averaged, with the difference between them shown' }, twice, ' Run twice and combine'),
        run,
        compare,
        cost),
      expectations(),
      status,
      latestTitles && h('div', { class: 'screen-latest' }, h('h3', {}, 'Title comparison'), renderReport(latestTitles, { compact: true })),
      latest && h('div', { class: 'screen-latest' }, h('h3', {}, 'Latest screening'), renderReport(latest, { compact: true })),
      earlier.length > 0 && h('details', {}, h('summary', { class: 'small' }, `Earlier screenings (${earlier.length})`),
        h('ul', { class: 'small' }, earlier.map((s) => h('li', {}, h('a', { href: `../lab/lab.html#sim=${s.id}` }, `${new Date(s.at).toLocaleDateString()} · ${s.kind === 'titles' ? `title comparison (★ ${s.scored.titles.find((t) => t.letter === s.scored.winner)?.title ?? '—'})` : `"${s.title}"`} · ${s.groupName}`), s.kind !== 'titles' ? ` · would click ${Math.round(s.result.clickShare * 100)}%, watch ${s.result.watchedShare == null ? '—' : `${Math.round(s.result.watchedShare * 100)}%`}` : '')))),
    ].filter(Boolean)); // DOM methods would print null/false as text
  }
  draw();
  return section;
}
