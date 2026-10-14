// Storage overview, cleanup, backup and restore. Runs in the background
// worker, so its writes are serialized with the rest of the extension's.

import { mutateIdeas, listIdeas } from './ideas.js';
import { listNodes, deleteHolesOlderThan, deleteAllNodes, NODE_PREFIX } from './explore-store.js';

const DAY = 86_400_000;

// What each stored key belongs to, for the usage breakdown.
const CATEGORIES = [
  { id: 'ideas', label: 'Saved ideas & their history', match: (k) => k === 'ideas' },
  { id: 'transcripts', label: 'Transcripts', match: (k) => k.startsWith('tx:') },
  { id: 'heatmaps', label: 'Retention heatmaps', match: (k) => k.startsWith('hm:') },
  { id: 'explore', label: 'Keyword rabbit holes', match: (k) => k === 'explore:index' || k.startsWith(NODE_PREFIX) },
  { id: 'ai', label: 'AI results', match: (k) => k === 'aiRuns' },
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
export async function exportAll() {
  const all = await chrome.storage.local.get(null);
  const data = Object.fromEntries(
    Object.entries(all).filter(([k]) => !k.startsWith('cache:') && !SECRET_KEYS.includes(k) && k !== 'quota'),
  );
  return { app: 'yt-toolkit', version: 1, exportedAt: new Date().toISOString(), data };
}

/**
 * Merges a backup into current data: ideas and rabbit-hole nodes are merged
 * by id (the more recently updated copy wins); other keys are added if
 * missing. API keys are never imported.
 */
export async function importAll(backup) {
  if (backup?.app !== 'yt-toolkit' || typeof backup.data !== 'object') throw new Error('Not a YT Toolkit backup file.');
  const { ideas: incomingIdeas = {}, 'explore:index': incomingIndex = {}, ...rest } = backup.data;
  let ideasAdded = 0;
  await mutateIdeas((ideas) => {
    for (const [id, idea] of Object.entries(incomingIdeas)) {
      if (!ideas[id] || (idea.updatedAt ?? 0) > (ideas[id].updatedAt ?? 0)) {
        if (!ideas[id]) ideasAdded++;
        ideas[id] = idea;
      }
    }
  });
  const index = await listNodes();
  for (const [id, node] of Object.entries(incomingIndex)) {
    if (!index[id] || (node.updatedAt ?? 0) > (index[id].updatedAt ?? 0)) index[id] = node;
  }
  const current = await chrome.storage.local.get(null);
  const toSet = { 'explore:index': index };
  for (const [k, v] of Object.entries(rest)) {
    if (SECRET_KEYS.includes(k) || k.startsWith('cache:')) continue;
    if (k === 'aiRuns') toSet.aiRuns = [...(current.aiRuns ?? []), ...v].sort((a, b) => b.at - a.at).slice(0, 20);
    else if (!(k in current)) toSet[k] = v;
  }
  await chrome.storage.local.set(toSet);
  return { ideasAdded, nodes: Object.keys(incomingIndex).length };
}
