// Audience lab: groups of avatars built from real audience data (or by hand).
// Stage 1 of the lab; test screenings build on these groups.

import { mountShell } from '../lib/nav.js';
import { send, h, emptyState } from '../lib/ui.js';
import { activeAi, generate, avatarsPrompt, PROVIDERS } from '../lib/ai.js';
import { audienceSheet, parseAvatars, mergeRegenerated, normalizeAvatar, DEFAULT_COUNT, MAX_COUNT, KNOWLEDGE, DEVICES, DISCOVERY, RELATIONSHIP } from '../lib/avatars.js';

mountShell('lab');
const main = document.getElementById('main');
const dlg = document.getElementById('edit');

let groups = {};
let current = null; // group id
let creating = false;
let busy = null; // { text } while building

const LABEL = {
  knowledge: { new: 'new to the topic', some: 'knows some', expert: 'expert' },
  discovery: { search: 'finds you in search', browse: 'home feed', suggested: 'suggested videos', subscriptions: 'subscriptions feed', shorts: 'Shorts feed', external: 'outside links' },
  relationship: { subscriber: 'subscriber', returning: 'returning viewer', new: 'new viewer' },
  device: { phone: 'phone', computer: 'computer', tv: 'TV', tablet: 'tablet' },
};

// ---------- a face for each avatar (deterministic, no images) ----------

function hash(s) {
  let x = 2166136261;
  for (let i = 0; i < s.length; i++) x = Math.imul(x ^ s.charCodeAt(i), 16777619);
  return x >>> 0;
}
function face(a) {
  const n = hash(`${a.id}${a.name}`);
  const hues = [12, 28, 45, 150, 175, 200, 220, 265, 300, 335];
  const bg = `hsl(${hues[n % hues.length]} 55% 72%)`;
  const skin = ['#f5d0b5', '#e8b48f', '#c98e66', '#a06a45', '#7a4b2e', '#5a3622'][(n >>> 4) % 6];
  const hair = ['#2b1d16', '#4a3020', '#8a5a2b', '#c49a5a', '#1d1d1d', '#9a9a9a', '#b5452c'][(n >>> 8) % 7];
  const style = (n >>> 12) % 3;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 64 64');
  svg.setAttribute('aria-hidden', 'true');
  const hairPath = [
    'M14 30c0-14 9-21 18-21s18 7 18 21c-3-6-8-9-18-9s-15 3-18 9z',
    'M12 34c-1-17 9-25 20-25s21 8 20 25c-2-9-6-13-11-14-3 3-9 4-18 3-5 2-9 5-11 11z',
    'M15 28c1-12 8-18 17-18s16 6 17 18c-5-4-11-6-17-6s-12 2-17 6z M13 30h4v14h-4z M47 30h4v14h-4z',
  ][style];
  svg.innerHTML = `<rect width="64" height="64" fill="${bg}"/><path d="M14 64c2-11 9-16 18-16s16 5 18 16z" fill="${hair}" opacity=".85"/><circle cx="32" cy="32" r="14" fill="${skin}"/><path d="${hairPath}" fill="${hair}"/><circle cx="27" cy="33" r="1.6" fill="#222"/><circle cx="37" cy="33" r="1.6" fill="#222"/><path d="M28 39q4 3 8 0" stroke="#222" stroke-width="1.4" fill="none" stroke-linecap="round"/>`;
  return svg;
}

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

function render() {
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
  main.replaceChildren(bar, body);
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

let me = null;
let followed = {};
async function load() {
  groups = await send({ type: 'avatarGroups' }).catch(() => ({}));
  render();
}

const [auth, store] = await Promise.all([send({ type: 'authStatus' }).catch(() => ({})), chrome.storage.local.get('watchlist')]);
me = auth.signedIn ? auth.me : null;
followed = store.watchlist ?? {};
await load();
