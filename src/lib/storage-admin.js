// Storage overview, cleanup, backup and restore. Runs in the background
// worker, so its writes are serialized with the rest of the extension's.

import { mutateIdeas, listIdeas } from './ideas.js';
import { listNodes, deleteHolesOlderThan, deleteAllNodes, NODE_PREFIX } from './explore-store.js';

const DAY = 86_400_000;

// What each stored key belongs to, for the usage breakdown.
const CATEGORIES = [
  { id: 'ideas', label: 'Saved ideas & their history', match: (k) => k === 'ideas' },
  { id: 'transcripts', label: 'Transcripts', match: (k) => k.startsWith('tx:') },
  { id: 'notes', label: 'Your script notes', match: (k) => k.startsWith('sn:') },
  { id: 'notebook', label: 'Lab notebook', match: (k) => k === 'notebook' },
  { id: 'lab', label: 'Audience lab', match: (k) => k === 'avatars' || k.startsWith('sim:') },
  { id: 'heatmaps', label: 'Retention heatmaps', match: (k) => k.startsWith('hm:') },
  { id: 'explore', label: 'Keyword rabbit holes', match: (k) => k === 'explore:index' || k.startsWith(NODE_PREFIX) },
  { id: 'ai', label: 'AI results', match: (k) => k === 'aiRuns' || k === 'channelReviews' },
  { id: 'watch', label: 'Competitors & radar', match: (k) => k === 'watchlist' || k === 'radar' },
  { id: 'webs', label: 'Video webs', match: (k) => k.startsWith('vw:') },
  { id: 'comments', label: 'Comment research', match: (k) => k.startsWith('cm:') },
  { id: 'projects', label: 'Idea board projects', match: (k) => k === 'projects' || k.startsWith('th:') },
  { id: 'cache', label: 'Temporary API cache', match: (k) => k.startsWith('cache:') },
];
// Keys and sign-in details never leave the browser in a backup.
const SECRET_KEYS = ['apiKey', 'ai', 'google'];

const bytes = (v) => new TextEncoder().encode(JSON.stringify(v)).length;

export async function usage() {
  const all = await chrome.storage.local.get(null);
  const out = Object.fromEntries(
    [...CATEGORIES, { id: 'settings', label: 'Settings' }].map((c) => [c.id, { label: c.label, bytes: 0, items: 0 }]),
  );
  for (const [k, v] of Object.entries(all)) {
    const cat = CATEGORIES.find((c) => c.match(k))?.id ?? 'settings';
    out[cat].bytes += bytes(v) + k.length;
    out[cat].items += 1;
  }
  const ideas = Object.values(all.ideas ?? {});
  out.ideas.items = ideas.length;
  out.ideas.snapshots = ideas.reduce((n, i) => n + (i.history?.length ?? 0), 0);
  out.ideas.unavailable = ideas.filter((i) => i.unavailable).length;
  out.ideas.withAi = ideas.filter((i) => i.ai).length;
  out.explore.items = Object.keys(all['explore:index'] ?? {}).length;
  out.explore.holes = Object.values(all['explore:index'] ?? {}).filter((n) => !n.parentId).length;
  out.ai.items = (all.aiRuns ?? []).length;
  out.watch.items = Object.keys(all.watchlist ?? {}).length;
  out.watch.feed = (all.radar ?? []).length;
  const ids = new Set(ideas.map((i) => i.id));
  out.transcripts.orphans = Object.keys(all).filter((k) => k.startsWith('tx:') && !ids.has(k.slice(3))).length;
  out.heatmaps.orphans = Object.keys(all).filter((k) => k.startsWith('hm:') && !ids.has(k.slice(3))).length;
  out.total = Object.values(out).reduce((n, c) => n + (c.bytes ?? 0), 0);
  return out;
}

async function removeKeys(pred) {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter(pred);
  if (keys.length) await chrome.storage.local.remove(keys);
  return keys.length;
}

/**
 * Runs one cleanup action. Returns how many things were removed.
 * Actions: cache, holes-older, holes-all, history-older, orphans,
 * transcripts-all, heatmaps-all, ideas-unavailable, ideas-older, ai-runs,
 * ai-breakdowns, everything.
 */
export async function cleanup({ action, days = 0 }) {
  const cutoff = Date.now() - days * DAY;
  switch (action) {
    case 'cache':
      return removeKeys((k) => k.startsWith('cache:'));
    case 'holes-older':
      return deleteHolesOlderThan(days);
    case 'holes-all':
      return deleteAllNodes();
    case 'history-older': {
      // Keeps at least the latest snapshot of every idea.
      let removed = 0;
      await mutateIdeas((ideas) => {
        for (const idea of Object.values(ideas)) {
          const h = idea.history ?? [];
          const kept = h.filter((s, i) => s.t >= cutoff || i === h.length - 1);
          removed += h.length - kept.length;
          idea.history = kept;
        }
      });
      return removed;
    }
    case 'orphans': {
      const ids = new Set(Object.keys(await listIdeas()));
      return removeKeys((k) => (k.startsWith('tx:') || k.startsWith('hm:')) && !ids.has(k.slice(3)));
    }
    case 'webs-all':
      return removeKeys((k) => k.startsWith('vw:'));
    case 'comments-all':
      return removeKeys((k) => k.startsWith('cm:'));
    case 'transcripts-all':
      return removeKeys((k) => k.startsWith('tx:'));
    case 'heatmaps-all':
      return removeKeys((k) => k.startsWith('hm:'));
    case 'ideas-unavailable':
    case 'ideas-older': {
      const doomed = [];
      await mutateIdeas((ideas) => {
        for (const idea of Object.values(ideas)) {
          if (action === 'ideas-unavailable' ? idea.unavailable : idea.savedAt < cutoff) {
            doomed.push(idea.id);
            delete ideas[idea.id];
          }
        }
      });
      await chrome.storage.local.remove(doomed.flatMap((id) => [`tx:${id}`, `hm:${id}`]));
      return doomed.length;
    }
    case 'ai-runs': {
      const { aiRuns = [] } = await chrome.storage.local.get('aiRuns');
      await chrome.storage.local.remove('aiRuns');
      return aiRuns.length;
    }
    case 'ai-breakdowns': {
      let n = 0;
      await mutateIdeas((ideas) => {
        for (const idea of Object.values(ideas)) {
          if (idea.ai) {
            delete idea.ai;
            n++;
          }
        }
      });
      return n;
    }
    case 'everything': {
      // Everything except settings and keys.
      await mutateIdeas((ideas) => {
        for (const k of Object.keys(ideas)) delete ideas[k];
      });
      const n = await deleteAllNodes();
      return n + (await removeKeys((k) => CATEGORIES.some((c) => c.id !== 'ideas' && c.match(k))));
    }
    default:
      throw new Error(`Unknown cleanup action: ${action}`);
  }
}

// Everything worth keeping, without the temporary cache or API keys.
// Keys that only make sense on this browser and never go into a backup.
const LOCAL_ONLY = ['quota', 'lastBackupAt'];
const BACKUP_VERSION = 2;

/** The parts of the AI and Google settings that are safe to back up. */
function safeSettings(all) {
  const out = {};
  if (all.ai) {
    const { keys, ...ai } = all.ai; // eslint-disable-line no-unused-vars
    out.ai = ai;
  }
  if (all.google?.clientId) out.google = { clientId: all.google.clientId, ...(all.google.compareAs ? { compareAs: all.google.compareAs } : {}) };
  return out;
}

export async function exportAll() {
  const all = await chrome.storage.local.get(null);
  const data = Object.fromEntries(
    Object.entries(all).filter(([k]) => !k.startsWith('cache:') && !SECRET_KEYS.includes(k) && !LOCAL_ONLY.includes(k)),
  );
  Object.assign(data, safeSettings(all));
  // Last-known stats and uploads of followed channels (and your own), so
  // Following, Compare and Content gaps work right after a restore, before
  // any quota is spent.
  const ids = new Set([...Object.keys(all.watchlist ?? {}), all.google?.me?.id, all.google?.compareAs].filter(Boolean));
  data.channelData = {};
  for (const id of ids) if (all[`cache:c:${id}`]) data.channelData[id] = all[`cache:c:${id}`];
  const exportedAt = new Date().toISOString();
  await chrome.storage.local.set({ lastBackupAt: Date.now() });
  return { app: 'yt-toolkit', version: BACKUP_VERSION, exportedAt, data };
}

const count = (v) => (v ? Object.keys(v).length : 0);
const prefixed = (data, p) => Object.keys(data).filter((k) => k.startsWith(p)).length;

/** What a backup holds, for the restore preview: [{ label, count }]. */
export function summarizeBackup(backup) {
  if (backup?.app !== 'yt-toolkit' || typeof backup.data !== 'object' || !backup.data) throw new Error('Not a YT Toolkit backup file.');
  const d = backup.data;
  const projects = Object.values(d.projects ?? {});
  return [
    { label: 'Saved outliers', count: count(d.ideas) },
    { label: 'Idea board projects', count: projects.length },
    { label: 'Followed channels', count: count(d.watchlist) },
    { label: 'Channel stats snapshots', count: Object.values(d.watchlist ?? {}).reduce((n, c) => n + (c.history?.length ?? 0), 0) },
    { label: 'Channels with saved stats & uploads', count: count(d.channelData) },
    { label: 'Radar alerts', count: (d.radar ?? []).length },
    { label: 'Keyword alerts', count: count(d.keywordAlerts) },
    { label: 'Rabbit-hole keywords', count: count(d['explore:index']) },
    { label: 'Video webs', count: prefixed(d, 'vw:') },
    { label: 'Transcripts', count: prefixed(d, 'tx:') },
    { label: 'Script notes', count: prefixed(d, 'sn:') },
    { label: 'Notebook lessons & experiments', count: count(d.notebook?.lessons) + count(d.notebook?.experiments) },
    { label: 'Audience avatars', count: Object.values(d.avatars ?? {}).reduce((n, g) => n + (g.avatars?.length ?? 0), 0) },
    { label: 'Test screenings', count: prefixed(d, 'sim:') },
    { label: 'Retention heatmaps', count: prefixed(d, 'hm:') },
    { label: 'Comment research', count: prefixed(d, 'cm:') },
    { label: 'Thumbnails', count: prefixed(d, 'th:') },
    { label: 'AI results', count: (d.aiRuns ?? []).length },
    { label: 'AI channel reviews', count: (d.channelReviews ?? []).length },
    { label: 'AI settings (no keys)', count: d.ai ? 1 : 0 },
  ].filter((r) => r.count > 0);
}

const stamp = (v) => (v && typeof v === 'object' ? v.updatedAt ?? v.at ?? v.fetchedAt ?? 0 : 0);

// Stand-in for the background's serialized mutators (used by tests).
const direct = (key, fallback) => async (fn) => {
  const { [key]: value = fallback } = await chrome.storage.local.get(key);
  const result = await fn(value);
  await chrome.storage.local.set({ [key]: value });
  return result;
};

/** Followed channels: union of daily snapshots and seen videos; your notes win unless empty. */
function mergeChannel(cur, inc) {
  if (!cur) return inc;
  const byDay = new Map();
  for (const s of [...(inc.history ?? []), ...(cur.history ?? [])]) byDay.set(new Date(s.t).toDateString(), s);
  return {
    ...inc,
    ...cur,
    notes: cur.notes || inc.notes || '',
    addedAt: Math.min(cur.addedAt ?? Infinity, inc.addedAt ?? Infinity),
    history: [...byDay.values()].sort((a, b) => a.t - b.t).slice(-400),
    seen: [...new Set([...(cur.seen ?? []), ...(inc.seen ?? [])])].slice(-500),
  };
}

/**
 * Merges a backup into current data. Ideas, projects, rabbit-hole nodes,
 * followed channels, radar, keyword alerts and AI runs are merged item by
 * item (the newer copy wins); other keys are added if missing or replaced if
 * the backup's copy is newer. API keys and sign-in tokens are never imported.
 * `mutators` are the background's serialized writers, so a restore can't race
 * the daily radar.
 */
export async function importAll(backup, mutators = {}) {
  summarizeBackup(backup); // validates
  const {
    mutateWatch = direct('watchlist', {}),
    mutateRadar = direct('radar', []),
    mutateAlerts = direct('keywordAlerts', {}),
    mutateProjects = direct('projects', {}),
  } = mutators;
  const {
    ideas: incomingIdeas = {},
    'explore:index': incomingIndex = {},
    projects: incomingProjects = {},
    watchlist: incomingWatch = {},
    radar: incomingRadar = [],
    keywordAlerts: incomingAlerts = {},
    channelData = {},
    ai: incomingAi,
    google: incomingGoogle,
    ...rest
  } = backup.data;
  const res = { ideasAdded: 0, projectsAdded: 0, channelsAdded: 0, nodes: Object.keys(incomingIndex).length, other: 0 };

  await mutateIdeas((ideas) => {
    for (const [id, idea] of Object.entries(incomingIdeas)) {
      if (!ideas[id] || (idea.updatedAt ?? 0) > (ideas[id].updatedAt ?? 0)) {
        if (!ideas[id]) res.ideasAdded++;
        ideas[id] = idea;
      }
    }
  });
  await mutateProjects((projects) => {
    for (const [id, p] of Object.entries(incomingProjects)) {
      if (!projects[id]) res.projectsAdded++;
      if (!projects[id] || (p.updatedAt ?? 0) > (projects[id].updatedAt ?? 0)) projects[id] = p;
    }
  });
  await mutateWatch((watchlist) => {
    for (const [id, ch] of Object.entries(incomingWatch)) {
      if (!watchlist[id]) res.channelsAdded++;
      watchlist[id] = mergeChannel(watchlist[id], ch);
    }
  });
  await mutateRadar((radar) => {
    const have = new Set(radar.map((r) => `${r.channelId}:${r.id}`));
    for (const r of incomingRadar) if (!have.has(`${r.channelId}:${r.id}`)) radar.push(r);
    radar.sort((a, b) => (b.foundAt ?? 0) - (a.foundAt ?? 0)).splice(200);
  });
  await mutateAlerts((alerts) => {
    for (const [k, a] of Object.entries(incomingAlerts)) {
      if (!alerts[k]) alerts[k] = a;
      else alerts[k] = { ...alerts[k], seen: [...new Set([...(alerts[k].seen ?? []), ...(a.seen ?? [])])], found: Math.max(alerts[k].found ?? 0, a.found ?? 0) };
    }
  });

  const index = await listNodes();
  for (const [id, node] of Object.entries(incomingIndex)) {
    if (!index[id] || (node.updatedAt ?? 0) > (index[id].updatedAt ?? 0)) index[id] = node;
  }
  const current = await chrome.storage.local.get(null);
  const toSet = { 'explore:index': index };

  // Settings: never keys or tokens; fill in what this browser doesn't have.
  if (incomingAi && typeof incomingAi === 'object') {
    const { keys, ...safe } = incomingAi; // eslint-disable-line no-unused-vars
    const cur = current.ai ?? {};
    toSet.ai = { ...safe, ...cur, keys: cur.keys ?? {}, models: { ...(safe.models ?? {}), ...(cur.models ?? {}) }, niche: cur.niche || safe.niche || '' };
  }
  if (incomingGoogle?.clientId) {
    const cur = current.google ?? {};
    toSet.google = { ...cur, clientId: cur.clientId || incomingGoogle.clientId, ...(cur.compareAs || !incomingGoogle.compareAs ? {} : { compareAs: incomingGoogle.compareAs }) };
  }
  for (const [id, rec] of Object.entries(channelData)) {
    const cur = current[`cache:c:${id}`];
    if (rec?.value && (!cur || (rec.exp ?? 0) > (cur.exp ?? 0))) toSet[`cache:c:${id}`] = rec;
  }

  for (const [k, v] of Object.entries(rest)) {
    if (SECRET_KEYS.includes(k) || LOCAL_ONLY.includes(k) || k.startsWith('cache:')) continue;
    if (k === 'channelReviews') {
      const have = new Set((current.channelReviews ?? []).map((r) => r.at));
      toSet.channelReviews = [...(current.channelReviews ?? []), ...v.filter((r) => !have.has(r.at))].sort((a, b) => b.at - a.at).slice(0, 12);
    } else if (k === 'notebook') {
      // Lessons and experiments, item by item (the newer copy wins).
      const cur = current.notebook ?? {};
      const pick = (a = {}, b = {}) => Object.fromEntries([...new Set([...Object.keys(a), ...Object.keys(b)])].map((id) => [id, (b[id]?.updatedAt ?? 0) > (a[id]?.updatedAt ?? 0) ? b[id] : a[id] ?? b[id]]));
      toSet.notebook = { lessons: pick(cur.lessons, v.lessons), experiments: pick(cur.experiments, v.experiments) };
    } else if (k === 'aiRuns') {
      const seen = new Set((current.aiRuns ?? []).map((r) => `${r.at}:${r.title}`));
      toSet.aiRuns = [...(current.aiRuns ?? []), ...v.filter((r) => !seen.has(`${r.at}:${r.title}`))].sort((a, b) => b.at - a.at).slice(0, 20);
    } else if (!(k in current) || stamp(v) > stamp(current[k])) {
      toSet[k] = v;
      res.other++;
    }
  }
  await chrome.storage.local.set(toSet);
  return res;
}
