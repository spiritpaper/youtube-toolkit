// "Forecast vs reality": once a project is published, check its test
// screenings against what the video really did. Each check also teaches the
// audience group, so its next screenings are corrected.

import { send, h } from '../lib/ui.js';
import { activeAi } from '../lib/ai.js';
import { checkScreening, publishedVideo } from '../lab/accuracy-run.js';
import { renderAccuracy, REPORT_CSS } from '../lab/report.js';
import { proposeUpdate, reviewUpdate, EVOLVE_CSS } from '../lab/evolve-run.js';

const DAY = 86_400_000;
let styled = false;

export function accuracySection(project) {
  if (!styled) {
    document.head.append(h('style', {}, REPORT_CSS + EVOLVE_CSS));
    styled = true;
  }
  const body = h('div', {});
  const section = h('section', { class: 'card', id: 'accuracy', hidden: true }, h('div', { class: 'card-head' }, h('h2', {}, 'Forecast vs reality')), body);

  async function draw(status = null) {
    const [sims, auth, all, groups] = await Promise.all([
      send({ type: 'screenings', projectId: project.id }).catch(() => []),
      send({ type: 'authStatus' }).catch(() => ({})),
      send({ type: 'projects' }).catch(() => ({})),
      send({ type: 'avatarGroups' }).catch(() => ({})),
    ]);
    project = all[project.id] ?? project;
    const video = publishedVideo(project);
    const screenings = sims.filter((s) => !s.kind || s.kind === 'screening');
    const titleTest = sims.find((s) => s.kind === 'titles');
    section.hidden = !video || !(screenings.length || titleTest);
    if (section.hidden) return;

    const age = video.publishedAt ? (Date.now() - Date.parse(video.publishedAt)) / DAY : null;
    const notes = [
      age != null && age < 7 && `Published ${Math.max(0, Math.round(age))} day${Math.round(age) === 1 ? '' : 's'} ago. Retention settles after about a week: check now and again later.`,
      !auth.signedIn && 'Sign in on My channel to compare watch time, the opening and the retention curve, and to calibrate future screenings. Without it, only views and comments can be compared.',
    ].filter(Boolean);

    const titleNote = titleTest && (() => {
      const pick = titleTest.scored.titles.find((t) => t.letter === titleTest.scored.winner);
      const used = project.performance?.video?.title ?? project.title;
      const same = pick && pick.title.trim().toLowerCase() === String(used).trim().toLowerCase();
      return h('p', { class: 'small' }, h('b', {}, 'Title: '), same ? `you published the title comparison's pick, "${pick.title}".` : `the title comparison favored "${pick?.title ?? '—'}"; you published "${used}".`);
    })();

    const block = (sim) => {
      const check = h('button', { class: sim.accuracy ? '' : 'primary' }, sim.accuracy ? 'Check again' : 'Check against the real numbers');
      const explain = h('button', { title: 'Reads the real comments (1 API unit) and asks the AI what the screening got right and wrong' }, sim.accuracyNotes ? 'Explain again (1 AI call)' : 'Explain the differences (1 AI call)');
      const run = async (withNotes) => {
        const ai = withNotes ? await activeAi() : null;
        if (withNotes && !ai) return draw(h('p', { class: 'muted' }, 'Explaining uses AI. Connect a provider in Settings.'));
        check.disabled = explain.disabled = true;
        const progress = h('div', { class: 'loading inline' }, 'Checking…');
        body.append(progress);
        try {
          await checkScreening({ sim, project, ai, explain: withNotes, onProgress: (t) => (progress.textContent = t) });
          draw();
        } catch (err) {
          draw(err.cancelled ? null : h('p', { class: 'error' }, err.message));
        }
      };
      check.addEventListener('click', () => run(false));
      explain.addEventListener('click', () => run(true));
      // Teach the avatars themselves, not only the numbers.
      const updated = sim.accuracy && groups[sim.groupId]?.revisions?.find((r) => r.from?.simId === sim.id);
      const evolve = sim.accuracy && groups[sim.groupId] && h('button', { title: 'Asks the AI how the avatars should change after this video, for you to review (1 AI call)' }, updated ? 'Update the audience again' : 'Update the audience from this video');
      evolve?.addEventListener('click', async () => {
        const ai = await activeAi();
        if (!ai) return draw(h('p', { class: 'muted' }, 'Updating the audience uses AI. Connect a provider in Settings.'));
        check.disabled = explain.disabled = evolve.disabled = true;
        const progress = h('div', { class: 'loading inline' }, 'Gathering…');
        body.append(progress);
        try {
          const proposal = await proposeUpdate({ ai, group: groups[sim.groupId], sim, onProgress: (t) => (progress.textContent = t) });
          progress.remove();
          const saved = await reviewUpdate(groups[sim.groupId], proposal);
          draw(saved ? h('p', { class: 'small' }, `Updated "${saved.name}". Its next screenings use the new avatars. `, h('a', { href: '../lab/lab.html' }, 'See the group')) : null);
        } catch (err) {
          draw(err.cancelled ? null : h('p', { class: 'error' }, err.message));
        }
      });
      return h('div', { class: 'acc-block' },
        h('div', { class: 'small muted' }, `Screening of ${new Date(sim.at).toLocaleDateString()} · "${sim.title}" · ${sim.groupName}`, ' · ', h('a', { href: `../lab/lab.html#sim=${sim.id}` }, 'report')),
        renderAccuracy(sim, { title: 'How close it was' }),
        h('div', { class: 'row', style: 'display:flex;gap:8px;flex-wrap:wrap;margin-top:6px' }, check, explain, evolve),
        updated && h('p', { class: 'muted small' }, `The audience was updated from this video on ${new Date(updated.at).toLocaleDateString()}.`));
    };

    body.replaceChildren(...[
      h('p', { class: 'muted small' }, 'How well the test screenings predicted this video. Every check also teaches the audience group, so its next screenings are corrected.'),
      ...notes.map((n) => h('p', { class: 'small' }, n)),
      status,
      titleNote,
      ...screenings.slice(0, 3).map(block),
    ].filter(Boolean));
  }
  draw();
  return section;
}
