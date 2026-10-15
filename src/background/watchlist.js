// Followed channels ("watchlist" in storage): channels you learn from or
// compete with. Powers Following, Compare, Content gaps and the daily Radar.
// The daily radar pass also records each channel's stats into its history,
// so growth tracking costs no extra API calls.

import { getBaseline, getVideos, resolveChannelId } from './youtube.js';
import { channelProfile, newOutliers } from '../lib/stats.js';

const MAX_HISTORY = 400;
export const ROLES = ['learn', 'competitor'];

// One stats snapshot per channel per day.
function snapshot(base) {
  const c = base.channel;
  return {
    t: Date.now(),
    subs: c.subs ?? null,
    totalViews: c.totalViews ?? null,
    videoCount: c.videoCount ?? null,
    medianLong: base.long?.median ?? null,
    medianShort: base.short?.median ?? null,
  };
}
function addSnapshot(entry, base) {
  const snap = snapshot(base);
  const h = entry.history ?? [];
  const last = h[h.length - 1];
  const sameDay = last && new Date(last.t).toDateString() === new Date(snap.t).toDateString();
  entry.history = [...(sameDay ? h.slice(0, -1) : h), snap].slice(-MAX_HISTORY);
}

const MAX_FEED = 200;

async function load() {
  const { watchlist = {}, radar = [] } = await chrome.storage.local.get(['watchlist', 'radar']);
  return { watchlist, radar };
}

let chain = Promise.resolve();
function mutate(fn) {
  chain = chain.then(async () => {
    const state = await load();
    const result = await fn(state);
    await chrome.storage.local.set({ watchlist: state.watchlist, radar: state.radar });
    await updateBadge(state.radar);
    return result;
  });
  return chain;
}

/** Serialized writers for a backup restore. */
export const mutateWatch = (fn) => mutate(({ watchlist }) => fn(watchlist));
export const mutateRadar = (fn) => mutate(({ radar }) => fn(radar));

export async function updateBadge(radar) {
  radar ??= (await load()).radar;
  const unread = radar.filter((r) => !r.read).length;
  await chrome.action.setBadgeBackgroundColor({ color: '#8e24aa' });
  await chrome.action.setBadgeText({ text: unread ? String(Math.min(unread, 99)) : '' });
}

/**
 * Follows a channel by id, @handle or channel URL. role: 'learn' (channels you
 * study) or 'competitor'. Following again keeps notes and history.
 */
export async function watch(input, { role } = {}) {
  const ref = parseChannelInput(input);
  if (!ref) throw new Error('Enter a channel @handle, channel URL or channel ID.');
  const id = await resolveChannelId(ref);
  const base = await getBaseline(id);
  return mutate(({ watchlist }) => {
    const prev = watchlist[id];
    // Everything already out there counts as seen; the radar reports what's new from now on.
    const seen = [...(base.recent?.long ?? []), ...(base.recent?.short ?? [])].map((v) => v.id);
    const entry = {
      ...prev,
      id,
      title: base.channel.title,
      thumb: base.channel.thumb,
      handle: base.channel.handle,
      addedAt: prev?.addedAt ?? Date.now(),
      role: role ?? prev?.role ?? 'learn',
      notes: prev?.notes ?? '',
      seen: prev?.seen ?? seen,
    };
    addSnapshot(entry, base);
    watchlist[id] = entry;
    return entry;
  });
}

export function updateFollow(id, patch) {
  return mutate(({ watchlist }) => {
    if (!watchlist[id]) return null;
    const { role, notes } = patch;
    if (role && ROLES.includes(role)) watchlist[id].role = role;
    if (typeof notes === 'string') watchlist[id].notes = notes;
    return watchlist[id];
  });
}

/**
 * Everything the Following page shows, from cached data (no API calls unless
 * a channel's 12-hour cache has expired).
 */
export async function following() {
  const { watchlist } = await load();
  const out = [];
  for (const ch of Object.values(watchlist)) {
    try {
      const base = await getBaseline(ch.id, { allowStale: true });
      const uploads = ['long', 'short']
        .flatMap((format) =>
          (base.recent?.[format] ?? []).map((v) => ({
            ...v,
            format,
            channelId: ch.id,
            channelTitle: base.channel.title,
            thumb: `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`,
            multiplier: base[format]?.median ? v.views / base[format].median : null,
          })),
        )
        .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
      out.push({ ...ch, profile: channelProfile(base), uploads: uploads.slice(0, 12), staleSince: base.staleSince, staleReason: base.staleReason });
    } catch (err) {
      out.push({ ...ch, error: err.message });
    }
  }
  return out;
}

export function parseChannelInput(input) {
  const s = String(input ?? '').trim();
  let m;
  if ((m = /(UC[\w-]{22})/.exec(s))) return { id: m[1] };
  if ((m = /(?:youtube\.com\/)?(@[\w.\-·]+)/.exec(s))) return { handle: m[1] };
  if ((m = /youtube\.com\/user\/([\w-]+)/.exec(s))) return { username: m[1] };
  if (/^[\w.-]{3,}$/.test(s)) return { handle: `@${s}` };
  return null;
}

export function unwatch(id) {
  return mutate(({ watchlist }) => {
    delete watchlist[id];
    return true;
  });
}

/** Profiles for your channel (if signed in) and every watched channel. */
export async function compare(myId) {
  const { watchlist } = await load();
  const ids = [...new Set([myId, ...Object.keys(watchlist)].filter(Boolean))];
  const rows = [];
  for (const id of ids) {
    try {
      const base = await getBaseline(id, { allowStale: true });
      rows.push({ ...channelProfile(base), mine: id === myId, staleSince: base.staleSince });
    } catch (err) {
      rows.push({ id, title: watchlist[id]?.title ?? id, error: err.message, mine: id === myId });
    }
  }
  return rows;
}

/**
 * Checks every watched channel for fresh outliers (uploads from the last 14
 * days already at 2x their channel's median). ~5 quota units per channel.
 */
export async function radarCheck() {
  const { watchlist } = await load();
  const found = [];
  const snapshots = new Map();
  for (const ch of Object.values(watchlist)) {
    try {
      const base = await getBaseline(ch.id, { fresh: true });
      snapshots.set(ch.id, base);
      const hits = newOutliers(base, new Set(ch.seen));
      if (!hits.length) continue;
      const details = await getVideos(hits.map((h) => h.id));
      for (const h of hits) {
        const v = details.get(h.id);
        found.push({
          ...h,
          channelId: ch.id,
          channelTitle: base.channel.title,
          title: v?.title ?? '',
          thumb: v?.thumb ?? `https://i.ytimg.com/vi/${h.id}/mqdefault.jpg`,
          baselineMedian: base[h.format]?.median ?? null,
          foundAt: Date.now(),
          read: false,
        });
      }
    } catch (err) {
      if (['quotaExceeded', 'noKey', 'keyInvalid'].includes(err.reason)) throw err;
    }
  }
  await mutate(({ watchlist: wl, radar }) => {
    for (const [id, base] of snapshots) if (wl[id]) addSnapshot(wl[id], base);
    for (const f of found) {
      if (wl[f.channelId]) wl[f.channelId].seen = [...new Set([...wl[f.channelId].seen, f.id])].slice(-500);
      radar.unshift(f);
    }
    radar.splice(MAX_FEED);
  });
  await chrome.storage.local.set({ radarCheckedAt: Date.now() });
  return found.length;
}

/** Adds radar items found by other checks (e.g. keyword alerts). */
export function addRadarItems(items) {
  return mutate(({ radar }) => {
    const have = new Set(radar.map((r) => r.id));
    for (const it of items) if (!have.has(it.id)) radar.unshift(it);
    radar.splice(MAX_FEED);
  });
}

export function markRadarRead(ids = null) {
  return mutate(({ radar }) => {
    for (const r of radar) if (!ids || ids.includes(r.id)) r.read = true;
    return true;
  });
}

export function clearRadar() {
  return mutate((state) => {
    state.radar = [];
    return true;
  });
}

/**
 * Inputs for content gaps and the title lab: outliers (2x+) among each watched
 * channel's recent uploads, with titles, plus your own recent titles.
 * Uses cached baselines; titles cost ~1 quota unit per 50 videos.
 */
export async function gapData(myId) {
  const { watchlist } = await load();
  const outliers = [];
  const recentIds = [];
  for (const id of Object.keys(watchlist)) {
    try {
      const base = await getBaseline(id);
      for (const format of ['long', 'short']) {
        const med = base[format]?.median;
        if (!med) continue;
        for (const v of base.recent?.[format] ?? []) {
          recentIds.push(v.id);
          if (v.views / med >= 2) {
            outliers.push({ id: v.id, format, multiplier: v.views / med, views: v.views, publishedAt: v.publishedAt, channelId: id, channelTitle: base.channel.title });
          }
        }
      }
    } catch (err) {
      if (['quotaExceeded', 'noKey', 'keyInvalid'].includes(err.reason)) throw err;
    }
  }
  let mine = [];
  if (myId) {
    const base = await getBaseline(myId);
    const ids = [...(base.recent?.long ?? []), ...(base.recent?.short ?? [])].map((v) => v.id);
    const details = await getVideos(ids);
    mine = ids.map((id) => details.get(id)).filter(Boolean).map((v) => ({ id: v.id, title: v.title, views: v.views }));
  }
  // Titles of every recent upload (mostly cached already from the baselines),
  // so gaps can tell outlier topics apart from the niche's everyday words.
  const details = await getVideos(recentIds);
  for (const o of outliers) {
    const v = details.get(o.id);
    o.title = v?.title ?? '';
    o.thumb = v?.thumb ?? `https://i.ytimg.com/vi/${o.id}/mqdefault.jpg`;
  }
  const allTitles = recentIds.map((id) => details.get(id)?.title).filter(Boolean);
  return {
    outliers: outliers.filter((o) => o.title).sort((a, b) => b.multiplier - a.multiplier),
    allTitles,
    mine,
    myId,
    watched: Object.keys(watchlist).length,
  };
}
