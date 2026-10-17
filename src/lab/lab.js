// Audience lab: groups of avatars built from real audience data (or by hand).
// Stage 1 of the lab; test screenings build on these groups.

import { mountShell } from '../lib/nav.js';
import { send, h, emptyState } from '../lib/ui.js';
import { activeAi, generate, avatarsPrompt, PROVIDERS } from '../lib/ai.js';
import { face } from './face.js';
import { renderReport, expectations, REPORT_CSS } from './report.js';
import { askPanel } from './ask-panel.js';
import { ASK_CSS } from './ask-view.js';
import { runScreening } from './screen-run.js';
import { calibration as learnCalibration } from '../lib/accuracy.js';
import { audienceSheet, parseAvatars, mergeRegenerated, normalizeAvatar, DEFAULT_COUNT, MAX_COUNT, KNOWLEDGE, DEVICES, DISCOVERY, RELATIONSHIP } from '../lib/avatars.js';

mountShell('lab');
document.head.append(h('style', {}, REPORT_CSS + ASK_CSS));
const main = document.getElementById('main');
const dlg = document.getElementById('edit');

let groups = {};
let current = null; // group id
let creating = false;
let busy = null; // { text } while building
let tab = location.hash.startsWith('#sim') || location.hash === '#screenings' ? 'screenings' : location.hash === '#ask' ? 'ask' : 'avatars';

const LABEL = {
  knowledge: { new: 'new to the topic', some: 'knows some', expert: 'expert' },
  discovery: { search: 'finds you in search', browse: 'home feed', suggested: 'suggested videos', subscriptions: 'subscriptions feed', shorts: 'Shorts feed', external: 'outside links' },
  relationship: { subscriber: 'subscriber', returning: 'returning viewer', new: 'new viewer' },
  device: { phone: 'phone', computer: 'computer', tv: 'TV', tablet: 'tablet' },
};

// ---------- rendering ----------

const pct = (x) => `${Math.round(x * 100)}%`;

function avatarCard(g, a) {
  const row = (k, v) => (v && (!Array.isArray(v) || v.length) ? [h('dt', {}, k), h('dd', {}, Array.isArray(v) ? v.join(' · ') : v)] : []);
  return h('article', { class: `av${a.locked ? ' locked' : ''}` },
    h('div', { class: 'av-top' }, face(a),
      h('div', {},
        h('div', { class: 'av-name' }, a.name, a.locked ? ' 🔒' : ''),
        h('div', { class: 'av-sub' }, [a.age && `${a.age}`, a.occupation, a.location].filter(Boolean).join(' · ')))),
    a.lifeStage && h('div', { class: 'av-life' }, a.lifeStage),
    a.quote && h('p', { class: 'av-quote' }, `“${a.quote}”`),
    h('div', { class: 'chips' }, [LABEL.relationship[a.relationship], LABEL.discovery[a.discovery], LABEL.device[a.device], LABEL.knowledge[a.knowledge], ...a.interests.slice(0, 4)].filter(Boolean).map((t) => h('span', { class: 'chip' }, t))),
    h('dl', {}, ...row('Wants', a.wants), ...row('Believes', a.beliefs), ...row('Frustrated by', a.frustrations), ...row('Moved by', a.moves), ...row('Clicks away when', a.turnoffs), ...row('Watches', a.habits), ...row('Comments', a.commentStyle)),
    h('div', { class: 'weight', title: 'The share of your audience this avatar stands for' }, `≈ ${pct(a.weight)} of viewers`, h('div', { class: 'bar' }, h('div', { style: `width:${Math.min(100, a.weight * 100 * 2.5)}%` }))),
    a.basedOn && h('div', { class: 'based' }, `Based on: ${a.basedOn}`),
    h('div', { class: 'av-acts' },
      h('button', { title: a.locked ? 'Let regenerating replace this avatar' : 'Keep this avatar when regenerating', onclick: () => send({ type: 'avatarSave', groupId: g.id, avatar: { ...a, locked: !a.locked } }).then(load) }, a.locked ? 'Unlock' : 'Lock'),
      h('button', { onclick: () => editAvatar(g, a) }, 'Edit'),
      h('button', { title: 'Delete', 'aria-label': `Delete ${a.name}`, onclick: () => confirm(`Delete ${a.name}?`) && send({ type: 'avatarDelete', groupId: g.id, avatarId: a.id }).then(load) }, '✕')));
}

function summary(g) {
  const av = g.avatars;
  if (!av.length) return null;
  const share = (key, val) => av.filter((a) => a[key] === val).reduce((n, a) => n + a.weight, 0);
  const ages = av.filter((a) => a.age);
  const avgAge = ages.length ? Math.round(ages.reduce((n, a) => n + a.age * a.weight, 0) / ages.reduce((n, a) => n + a.weight, 0)) : null;
  return h('div', { class: 'summary' },
    h('span', {}, h('b', {}, av.length), ' avatars'),
    avgAge && h('span', {}, 'average age ', h('b', {}, avgAge)),
    h('span', {}, h('b', {}, pct(share('relationship', 'subscriber'))), ' subscribers'),
    h('span', {}, h('b', {}, pct(share('device', 'phone'))), ' on phones'),
    h('span', {}, h('b', {}, pct(share('discovery', 'search'))), ' from search'),
    h('span', {}, h('b', {}, pct(share('knowledge', 'new'))), ' new to the topic'));
}

const SOURCE_LABEL = { analytics: 'your channel\'s analytics and comments', niche: 'your channel description', channel: 'a channel you follow', manual: 'added by hand' };

// How this group's forecasts have compared with published videos.
function trackRecord(g) {
  const checked = allSims.filter((s) => s.groupId === g.id && s.accuracy);
  if (!checked.length) {
    return h('p', { class: 'muted small' }, 'Track record: no published videos checked yet. After you publish a screened video, check it in the project\'s Forecast vs reality card; this group then corrects its own forecasts.');
  }
  const cal = learnCalibration(checked);
  const misses = cal.history.map((x) => x.meanErr).filter((x) => x != null);
  const trend = misses.length >= 2 ? (misses.at(-1) < misses[0] - 2 ? ' · getting closer' : misses.at(-1) > misses[0] + 2 ? ' · drifting further' : ' · steady') : '';
  const fixes = [
    cal.watch && `watch time ${cal.watch.value > 0 ? '−' : '+'}${Math.abs(cal.watch.value)} pts`,
    cal.hook && `opening ${cal.hook.value > 0 ? '−' : '+'}${Math.abs(cal.hook.value)} pts`,
    cal.ctrRatio && `"would click" × ${cal.ctrRatio.value.toFixed(3)} → click-through`,
  ].filter(Boolean);
  return h('div', { class: 'track small' },
    h('b', {}, 'Track record: '), `${cal.n} published video${cal.n === 1 ? '' : 's'} checked`,
    misses.length ? ` · average miss ${misses.map((m) => `${Math.round(m)}`).join(' → ')} pts${trend}` : '',
    fixes.length ? h('div', { class: 'muted' }, `Corrections applied to new screenings: ${fixes.join(' · ')}`) : null);
}

function groupView(g) {
  const regen = h('button', { onclick: () => build({ group: g }) }, `Regenerate unlocked (${g.avatars.filter((a) => !a.locked).length || DEFAULT_COUNT})`);
  return h('div', { class: 'lab-group' },
    h('section', { class: 'card' },
      h('div', { class: 'ghead' },
        h('h2', {}, g.name),
        g.source?.kind !== 'manual' && regen,
        h('button', { onclick: () => editAvatar(g, null), disabled: g.avatars.length >= MAX_COUNT }, 'Add an avatar'),
        h('button', { class: 'danger', onclick: () => confirm(`Delete the group "${g.name}" and its ${g.avatars.length} avatars?`) && send({ type: 'avatarGroupDelete', id: g.id }).then(() => { current = null; load(); }) }, 'Delete group')),
      h('div', { class: 'muted small' }, `Built from ${SOURCE_LABEL[g.source?.kind] ?? 'your data'}${g.source?.title ? ` (${g.source.title})` : ''}${g.focus ? ` · represents: ${g.focus}` : ''} · updated ${new Date(g.updatedAt).toLocaleDateString()}`),
      summary(g),
      trackRecord(g),
      g.basis && h('details', { class: 'basis' }, h('summary', {}, 'The data these avatars are based on'), h('pre', {}, g.basis))),
    g.avatars.length
      ? h('div', { class: 'grid' }, g.avatars.map((a) => avatarCard(g, a)))
      : emptyState('No avatars yet', 'Add viewers by hand, or delete this group and build one from your data.'));
}

function newGroupForm() {
  const watch = Object.values(followed);
  const radio = (value, label, note, disabled = false) =>
    h('label', { class: 'opt' }, h('input', { type: 'radio', name: 'src', value, disabled, checked: !disabled && value === defaultSource() }), h('span', {}, h('b', {}, label), h('br'), h('span', { class: 'muted small' }, note)));
  const channelPick = h('select', { 'aria-label': 'Which channel', disabled: !watch.length }, watch.map((c) => h('option', { value: c.id }, c.title)));
  const name = h('input', { placeholder: 'My audience', 'aria-label': 'Group name' });
  const focus = h('input', { placeholder: 'Optional: who this group represents, e.g. "newcomers from search"', 'aria-label': 'Focus', style: 'flex:1;min-width:240px' });
  const count = h('input', { type: 'number', min: 1, max: MAX_COUNT, value: DEFAULT_COUNT, 'aria-label': 'How many avatars' });
  const form = h('form', { class: 'new-form', onsubmit: (e) => {
    e.preventDefault();
    const src = form.querySelector('input[name=src]:checked')?.value ?? 'manual';
    const n = Math.max(1, Math.min(MAX_COUNT, Number(count.value) || DEFAULT_COUNT));
    creating = false;
    if (src === 'manual') {
      send({ type: 'avatarGroupSave', group: { name: name.value || 'My audience', focus: focus.value, source: { kind: 'manual' } } }).then((g) => { current = g.id; load(); });
    } else {
      build({ name: name.value || (src === 'channel' ? `${followed[channelPick.value]?.title ?? 'Channel'}'s audience` : 'My audience'), focus: focus.value, count: n, source: { kind: src, ...(src === 'channel' ? { channelId: channelPick.value, title: followed[channelPick.value]?.title } : {}) } });
    }
  } },
  h('h2', {}, 'New audience group'),
  h('div', { class: 'opts' },
    radio('analytics', 'My channel (recommended)', me ? `Your real analytics: ages, countries, devices, subscribers, how people find you, your top videos and recent comments (1 API unit). Signed in as ${me.title}.` : 'Sign in on My channel to use your real analytics.', !me),
    radio('niche', 'My channel description', 'From what you wrote about your channel in Settings → AI. Use this if you\'re not signed in.'),
    h('label', { class: 'opt' }, h('input', { type: 'radio', name: 'src', value: 'channel', disabled: !watch.length }), h('span', {}, h('b', {}, 'A channel I follow '), channelPick, h('br'), h('span', { class: 'muted small' }, watch.length ? 'Their recent videos and comments: an audience you want to win over.' : 'Follow channels first.'))),
    radio('manual', 'Start empty', 'Add your own avatars by hand.')),
  h('div', { class: 'row' }, name, focus),
  h('div', { class: 'row' }, 'Avatars:', count, h('span', { class: 'muted small' }, `up to ${MAX_COUNT}; more avatars give a fuller picture but use more AI tokens in each test screening`)),
  h('div', { class: 'row' }, h('button', { class: 'primary', type: 'submit' }, 'Create'), h('button', { type: 'button', onclick: () => { creating = false; render(); } }, 'Cancel')));
  return h('section', { class: 'card' }, form);
}

const defaultSource = () => (me ? 'analytics' : 'niche');

function tabs() {
  const go = (t) => {
    tab = t;
    history.replaceState(null, '', t === 'avatars' ? '#' : `#${t}`);
    render();
  };
  return h('div', { class: 'tabs', role: 'tablist' },
    h('button', { role: 'tab', 'aria-selected': String(tab === 'avatars'), onclick: () => go('avatars') }, 'Avatars'),
    h('button', { role: 'tab', 'aria-selected': String(tab === 'ask'), onclick: () => go('ask') }, 'Ask your audience'),
    h('button', { role: 'tab', 'aria-selected': String(tab === 'screenings'), onclick: () => go('screenings') }, 'Test screenings'));
}

// ---------- ask your audience (ideas without a project yet) ----------

let askEl = null;
function renderAsk() {
  askEl ??= askPanel();
  main.replaceChildren(tabs(), h('section', { class: 'card' },
    h('h2', {}, 'Ask your audience'),
    h('p', { class: 'muted small' }, 'Pitch ideas before you start a project, or ask anything. To ask about a specific project, use the Ask your audience card on its page.'),
    askEl));
}

// ---------- test screenings ----------

let sims = [];
let projects = {};
async function renderScreenings() {
  const simId = /#sim=([\w]+)/.exec(location.hash)?.[1];
  if (simId) {
    const sim = await send({ type: 'screeningGet', id: simId });
    main.replaceChildren(tabs(), sim
      ? h('div', { class: 'lab-sim' },
          h('div', { class: 'ghead' },
            h('a', { href: '#screenings', onclick: (e) => { e.preventDefault(); history.replaceState(null, '', '#screenings'); render(); } }, '← All test screenings'),
            h('span', { class: 'grow' }),
            projects[sim.projectId] && h('a', { class: 'button-link', href: `../project/project.html?id=${sim.projectId}#screening` }, 'Open the project'),
            h('button', { onclick: () => navigator.clipboard.writeText(`${sim.report}\n\n${sim.summary?.text ?? ''}`) }, 'Copy report'),
            h('button', { class: 'danger', onclick: async () => { if (confirm('Delete this test screening?')) { await send({ type: 'screeningDelete', id: sim.id }); history.replaceState(null, '', '#screenings'); render(); } } }, 'Delete')),
          h('h2', { style: 'margin:8px 0 0' }, sim.projectTitle),
          renderReport(sim))
      : emptyState('Screening not found', 'It may have been deleted.'));
    return;
  }
  sims = await send({ type: 'screenings' }).catch(() => []);
  const groupList = Object.values(groups).filter((g) => g.avatars.length);
  const projectList = Object.values(projects).filter((p) => !p.archivedAt).sort((a, b) => b.updatedAt - a.updatedAt);
  const form = (() => {
    if (!groupList.length) return h('section', { class: 'card' }, emptyState('Build an audience first', 'Test screenings run a video past an avatar group. Create one on the Avatars tab.'));
    if (!projectList.length) return h('section', { class: 'card' }, emptyState('No projects yet', 'Screenings test a project on the Idea board: its title, opening and script.', [{ label: 'Go to the Idea board', href: '../board/board.html', primary: true }]));
    const proj = h('select', { 'aria-label': 'Project' }, projectList.map((p) => h('option', { value: p.id }, p.title)));
    const grp = h('select', { 'aria-label': 'Audience group' }, groupList.map((g) => h('option', { value: g.id }, `${g.name} (${g.avatars.length})`)));
    const run = h('button', { class: 'primary' }, 'Run test screening');
    const thumb = h('input', { type: 'checkbox' });
    const twice = h('input', { type: 'checkbox' });
    const status = h('div', {});
    run.addEventListener('click', async () => {
      const ai = await activeAi();
      if (!ai) return status.replaceChildren(h('p', { class: 'muted' }, 'Test screenings use AI. Connect a provider in Settings first.'));
      run.disabled = true;
      const progress = h('div', { class: 'loading inline' }, 'Starting…');
      status.replaceChildren(progress);
      try {
        const p = projects[proj.value];
        const sim = await runScreening({ ai, project: p, group: groups[grp.value], title: p.title, thumbnail: thumb.checked, passes: twice.checked ? 2 : 1, principles: screeningPrinciples, onProgress: (t) => (progress.textContent = t) });
        history.replaceState(null, '', `#sim=${sim.id}`);
        render();
      } catch (err) {
        run.disabled = false;
        status.replaceChildren(err.cancelled ? '' : h('p', { class: 'error' }, err.message));
      }
    });
    return h('section', { class: 'card' }, h('h2', {}, 'New test screening'),
      h('p', { class: 'muted small' }, 'Pick a project and an audience: the viewers see the title in their feed, watch the opening, then the script beat by beat. 3 AI calls (5 when run twice). To test other title options or compare titles, use the project\'s Test screening card.'),
      h('div', { class: 'ghead' }, proj, grp,
        h('label', { class: 'small', title: 'Needs a thumbnail uploaded on the project. Costs more tokens.' }, thumb, ' Include the thumbnail'),
        h('label', { class: 'small' }, twice, ' Run twice and combine'),
        run),
      status, expectations());
  })();
  main.replaceChildren(tabs(), form,
    h('section', { class: 'card' }, h('h2', {}, 'Past screenings, pitches and conversations'),
      sims.length
        ? h('div', { class: 'sim-list' }, sims.map((sm) => h('a', { class: 'sim-row', href: `#sim=${sm.id}`, onclick: (e) => { e.preventDefault(); history.replaceState(null, '', `#sim=${sm.id}`); render(); } },
            h('div', {}, h('b', {}, sm.projectTitle), h('div', { class: 'muted small' }, `"${sm.title}" · ${sm.groupName} · ${new Date(sm.at).toLocaleString()}`)),
            sm.kind === 'pitch'
              ? h('div', { class: 'sim-nums' }, `idea pitch · ★ ${sm.scored.pitches.find((x) => x.i === sm.scored.best)?.pitch.slice(0, 60) ?? '—'}`)
              : sm.kind === 'chat'
                ? h('div', { class: 'sim-nums' }, `conversation · ${(sm.messages ?? []).filter((m) => m.from === 'you').length} question${(sm.messages ?? []).filter((m) => m.from === 'you').length === 1 ? '' : 's'}`)
                : sm.kind === 'titles'
              ? h('div', { class: 'sim-nums' }, `title comparison · ★ ${sm.scored.titles.find((t) => t.letter === sm.scored.winner)?.title ?? '—'}`)
              : h('div', { class: 'sim-nums' }, sm.accuracy?.verdict ? h('span', { class: `verdict v-${sm.accuracy.verdict}`, title: 'Checked against the published video' }, { close: 'forecast close', fair: 'roughly right', off: 'forecast off' }[sm.accuracy.verdict]) : '', ' ', `click ${Math.round(sm.result.clickShare * 100)}%`, ' · ', `watch ${sm.result.watchedShare == null ? '—' : `${Math.round(sm.result.watchedShare * 100)}%`}`, sm.result.score != null ? ` · ${sm.result.score.toFixed(1)}/10` : '', sm.result.passes > 1 ? ' · 2 runs' : ''))))
        : emptyState('No test screenings yet', 'Run one above, or from the Test screening card on any project.')));
}

function render() {
  if (tab === 'screenings') return renderScreenings();
  if (tab === 'ask') return renderAsk();
  const list = Object.values(groups).sort((a, b) => a.createdAt - b.createdAt);
  if (!current || !groups[current]) current = list[0]?.id ?? null;
  const bar = h('div', { class: 'groups' },
    list.map((g) => h('button', { 'aria-pressed': String(g.id === current && !creating), onclick: () => { current = g.id; creating = false; render(); } }, `${g.name} (${g.avatars.length})`)),
    h('button', { onclick: () => { creating = true; render(); } }, '+ New group'));
  const body = busy
    ? h('section', { class: 'card' }, h('div', { class: 'loading' }, busy.text))
    : creating || !list.length
      ? list.length || creating
        ? newGroupForm()
        : h('section', { class: 'card' }, emptyState('Build your audience', 'Avatars are realistic viewers made from your real data: who watches, how they find you, what they say in the comments. Next, you\'ll test-screen titles, hooks and scripts with them before publishing.', []), h('div', { class: 'empty-actions' }, h('button', { class: 'primary', onclick: () => { creating = true; render(); } }, 'Build my audience')))
      : groupView(groups[current]);
  main.replaceChildren(tabs(), bar, body);
}

// ---------- building with AI ----------

async function gather(source, progress) {
  if (source.kind === 'analytics') {
    progress('Reading your audience from YouTube Analytics…');
    const [profile, top, ov] = await Promise.all([
      send({ type: 'myAudience', days: 90 }).catch(() => null),
      send({ type: 'myTopVideos', days: 90 }).catch(() => []),
      send({ type: 'myOverview', days: 90 }).catch(() => null),
    ]);
    progress('Reading recent comments on your videos…');
    const comments = await send({ type: 'channelComments', channelId: me.id }).catch(() => []);
    const pub = top.length ? await send({ type: 'scoreVideos', ids: top.slice(0, 12).map((r) => r.video) }).catch(() => ({})) : {};
    return {
      channel: { title: me.title },
      profile,
      videos: top.slice(0, 12).map((r) => ({ title: pub[r.video]?.title ?? r.video, views: r.views, multiplier: pub[r.video]?.multiplier })),
      comments,
      retention: ov?.current?.averageViewPercentage ?? null,
    };
  }
  if (source.kind === 'channel') {
    progress('Reading the channel\'s recent videos and comments…');
    const ch = (await send({ type: 'following' }).catch(() => [])).find((c) => c.id === source.channelId);
    const comments = await send({ type: 'channelComments', channelId: source.channelId }).catch(() => []);
    return {
      channel: { title: ch?.profile?.title ?? source.title, subs: ch?.profile?.subs },
      videos: (ch?.uploads ?? []).map((v) => ({ title: v.title, views: v.views, multiplier: v.multiplier })),
      comments,
    };
  }
  return {};
}

async function build({ group = null, name, focus = '', count = DEFAULT_COUNT, source }) {
  const ai = await activeAi();
  if (!ai) return alert('Building avatars uses AI. Connect a provider in Settings first (or add avatars by hand: choose "Start empty").');
  const src = group?.source ?? source;
  const keep = group ? group.avatars.filter((a) => a.locked) : [];
  const n = group ? Math.max(1, group.avatars.filter((a) => !a.locked).length || DEFAULT_COUNT) : count;
  busy = { text: 'Gathering your audience data…' };
  render();
  const progress = (text) => {
    busy.text = text;
    render();
  };
  try {
    const data = await gather(src, progress);
    const sheet = audienceSheet({ ...data, niche: ai.niche });
    progress(`Asking ${PROVIDERS[ai.provider].label} to build ${n} avatars from it. This can take a minute…`);
    const { system, prompt } = avatarsPrompt(sheet, n, ai.niche, { keep, focus: group?.focus ?? focus });
    const avatars = parseAvatars(await generate({ ...ai, system, prompt }));
    const final = group ? mergeRegenerated(group.avatars, avatars, keep.length + n) : avatars.slice(0, n);
    const saved = await send({ type: 'avatarGroupSave', group: { id: group?.id, name: group?.name ?? name, focus: group?.focus ?? focus, source: src, basis: sheet, avatars: final } });
    current = saved.id;
  } catch (err) {
    if (!err.cancelled) alert(err.message);
  } finally {
    busy = null;
    await load();
window.addEventListener('hashchange', () => {
  if (location.hash.startsWith('#sim')) tab = 'screenings';
  render();
});
  }
}

// ---------- editing ----------

function editAvatar(g, a) {
  const v = a ?? normalizeAvatar({ name: '' }, { source: 'manual' });
  const field = (key, label, el = h('input', { value: Array.isArray(v[key]) ? v[key].join(', ') : v[key] ?? '' }), wide = false) => {
    el.name = key;
    return h('label', { class: wide ? 'wide' : '' }, label, el);
  };
  const select = (key, options, labels) => h('select', {}, options.map((o) => h('option', { value: o, selected: v[key] === o }, labels[o] ?? o)));
  const area = (key) => h('textarea', { value: Array.isArray(v[key]) ? v[key].join('\n') : v[key] ?? '' });
  const form = h('form', { method: 'dialog', onsubmit: async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    for (const k of ['beliefs', 'frustrations']) data[k] = String(data[k] ?? '').split('\n').map((x) => x.trim()).filter(Boolean);
    data.interests = String(data.interests ?? '').split(',').map((x) => x.trim()).filter(Boolean);
    data.weight = Number(data.weight) / 100 || v.weight;
    try {
      await send({ type: 'avatarSave', groupId: g.id, avatar: { ...v, ...data, source: a?.source ?? 'manual' } });
      dlg.close();
      load();
    } catch (err) {
      alert(err.message);
    }
  } },
  h('h2', {}, a ? `Edit ${a.name}` : 'New avatar'),
  h('div', { class: 'fields' },
    field('name', 'Name'), field('age', 'Age', h('input', { type: 'number', min: 10, max: 99, value: v.age ?? '' })), field('gender', 'Gender'), field('location', 'Location'),
    field('occupation', 'Job or study'), field('lifeStage', 'Their situation', undefined, true),
    field('interests', 'Interests (comma-separated)', undefined, true),
    field('knowledge', 'Knows the topic', select('knowledge', KNOWLEDGE, LABEL.knowledge)),
    field('relationship', 'Relationship', select('relationship', RELATIONSHIP, LABEL.relationship)),
    field('discovery', 'Finds videos via', select('discovery', DISCOVERY, LABEL.discovery)),
    field('device', 'Watches on', select('device', DEVICES, LABEL.device)),
    field('wants', 'Wants from videos like yours', area('wants'), true),
    field('beliefs', 'Beliefs (one per line)', area('beliefs'), true),
    field('frustrations', 'Frustrations (one per line)', area('frustrations'), true),
    field('moves', 'Moved by', area('moves'), true), field('turnoffs', 'Clicks away when', area('turnoffs'), true),
    field('habits', 'How they watch', area('habits'), true), field('commentStyle', 'How they comment'), field('quote', 'In their own words', undefined, true),
    field('weight', 'Share of viewers (%)', h('input', { type: 'number', min: 1, max: 100, value: Math.round(v.weight * 100) || 10 }))),
  h('div', { class: 'acts' }, h('button', { type: 'button', onclick: () => dlg.close() }, 'Cancel'), h('button', { class: 'primary', type: 'submit' }, 'Save')));
  dlg.replaceChildren(form);
  dlg.showModal();
}

// ---------- start ----------

// Story principles the fixes may cite (the personal build fills this in).
const screeningPrinciples = [];
let me = null;
let followed = {};
let allSims = [];
async function load() {
  [groups, allSims] = await Promise.all([send({ type: 'avatarGroups' }).catch(() => ({})), send({ type: 'screenings' }).catch(() => [])]);
  render();
}

const [auth, store] = await Promise.all([send({ type: 'authStatus' }).catch(() => ({})), chrome.storage.local.get(['watchlist', 'projects'])]);
projects = store.projects ?? {};
me = auth.signedIn ? auth.me : null;
followed = store.watchlist ?? {};
await load();
window.addEventListener('hashchange', () => {
  if (location.hash.startsWith('#sim')) tab = 'screenings';
  render();
});
