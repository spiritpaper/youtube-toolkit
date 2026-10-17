// Assembles API data into what the UI needs: scored videos, channel
// baselines and full channel analyses. All results are cached.

import { call, ApiError } from './api.js';
import * as cache from './cache.js';
import {
  parseDuration,
  computeBaseline,
  multiplier,
  classifyFormat,
  uploadsPerWeek,
  mean,
  median,
  channelTrend,
  ideaMetrics,
  keywordMetrics,
  relatedPhrases,
  parseHeatmap,
  OUTLIER_MIN,
} from '../lib/stats.js';
import { addSuggestions } from '../lib/web.js';

const HOUR = 3_600_000;
const VIDEO_TTL = 1 * HOUR;
const BASELINE_TTL = 12 * HOUR;
const ANALYSIS_TTL = 6 * HOUR;
const HANDLE_TTL = 30 * 24 * HOUR;

// Collapse concurrent requests for the same thing into one.
const inflight = new Map();
function once(key, fn) {
  if (!inflight.has(key)) inflight.set(key, fn().finally(() => inflight.delete(key)));
  return inflight.get(key);
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

const num = (x) => (x == null ? null : Number(x));

function normalizeVideo(item) {
  const s = item.snippet ?? {};
  const st = item.statistics ?? {};
  return {
    id: item.id,
    title: s.title ?? '',
    channelId: s.channelId,
    channelTitle: s.channelTitle ?? '',
    publishedAt: s.publishedAt,
    durationSec: parseDuration(item.contentDetails?.duration),
    views: num(st.viewCount),
    likes: num(st.likeCount),
    comments: num(st.commentCount),
    thumb: s.thumbnails?.medium?.url ?? `https://i.ytimg.com/vi/${item.id}/mqdefault.jpg`,
    liveBroadcastContent: s.liveBroadcastContent,
    tags: (s.tags ?? []).slice(0, 15),
  };
}

export async function getVideos(ids, { fresh = false } = {}) {
  ids = [...new Set(ids)];
  const cached = fresh ? new Map() : await cache.getMany(ids.map((id) => `v:${id}`));
  const result = new Map();
  const missing = [];
  for (const id of ids) {
    const v = cached.get(`v:${id}`);
    if (v) result.set(id, v);
    else missing.push(id);
  }
  for (const part of chunk(missing, 50)) {
    const body = await call('videos', {
      part: 'snippet,statistics,contentDetails',
      id: part.join(','),
      maxResults: 50,
    });
    const fresh = (body.items ?? []).map(normalizeVideo);
    await cache.setMany(fresh.map((v) => [`v:${v.id}`, v]), VIDEO_TTL);
    for (const v of fresh) result.set(v.id, v);
  }
  return result;
}

export async function resolveChannelId(ref) {
  if (ref.id) return ref.id;
  const key = ref.handle ? `h:${ref.handle.toLowerCase()}` : `u:${ref.username.toLowerCase()}`;
  const hit = await cache.get(key);
  if (hit) return hit;
  const params = { part: 'id' };
  if (ref.handle) params.forHandle = ref.handle;
  else params.forUsername = ref.username;
  const body = await call('channels', params);
  const id = body.items?.[0]?.id;
  if (!id) throw new ApiError('Channel not found.');
  await cache.set(key, id, HANDLE_TTL);
  return id;
}

async function fetchChannel(channelId) {
  const body = await call('channels', { part: 'snippet,statistics,contentDetails', id: channelId });
  const c = body.items?.[0];
  if (!c) throw new ApiError('Channel not found.');
  const st = c.statistics ?? {};
  return {
    id: c.id,
    title: c.snippet?.title ?? '',
    handle: c.snippet?.customUrl ?? '',
    thumb: c.snippet?.thumbnails?.default?.url ?? '',
    subs: st.hiddenSubscriberCount ? null : num(st.subscriberCount),
    totalViews: num(st.viewCount),
    videoCount: num(st.videoCount),
    uploadsPlaylist: c.contentDetails?.relatedPlaylists?.uploads ?? `UU${c.id.slice(2)}`,
  };
}

// Returns video ids from a playlist, or null if the playlist doesn't exist.
async function playlistIds(playlistId, max) {
  const ids = [];
  let pageToken;
  try {
    do {
      const body = await call('playlistItems', {
        part: 'contentDetails',
        playlistId,
        maxResults: 50,
        pageToken,
      });
      ids.push(...(body.items ?? []).map((i) => i.contentDetails.videoId));
      pageToken = body.nextPageToken;
    } while (pageToken && ids.length < max);
  } catch (err) {
    if (err.status === 404 || err.reason === 'playlistItemsNotAccessible') return null;
    throw err;
  }
  return ids.slice(0, max);
}

/**
 * Recent long-form and Shorts uploads for a channel. Uses the undocumented
 * per-format upload playlists (UULF = long-form, UUSH = Shorts); if neither
 * exists, falls back to the full uploads playlist and classifies by duration.
 */
async function channelUploads(channel, { long: maxLong, short: maxShort }) {
  const suffix = channel.id.slice(2);
  const [longIds, shortIds] = await Promise.all([
    playlistIds(`UULF${suffix}`, maxLong),
    playlistIds(`UUSH${suffix}`, maxShort),
  ]);

  if (longIds === null && shortIds === null) {
    const all = (await playlistIds(channel.uploadsPlaylist, maxLong + maxShort)) ?? [];
    const byId = await getVideos(all);
    const vids = all.map((id) => byId.get(id)).filter(Boolean);
    const none = { shortIds: null, longIds: null };
    return {
      long: vids.filter((v) => classifyFormat(v, none) === 'long').slice(0, maxLong),
      short: vids.filter((v) => classifyFormat(v, none) === 'short').slice(0, maxShort),
    };
  }

  const byId = await getVideos([...(longIds ?? []), ...(shortIds ?? [])]);
  const pick = (ids) => (ids ?? []).map((id) => byId.get(id)).filter(Boolean);
  return { long: pick(longIds), short: pick(shortIds) };
}

// Bump when the cached record's shape changes so old entries are refetched.
const BASELINE_VERSION = 3;

const compact = (v) => ({
  id: v.id,
  title: v.title,
  publishedAt: v.publishedAt,
  views: v.views,
  likes: v.likes,
  comments: v.comments,
});

function baselineRecord(channel, long, short) {
  return {
    v: BASELINE_VERSION,
    channel,
    long: computeBaseline(long),
    short: computeBaseline(short),
    longIds: long.slice(0, 50).map((v) => v.id),
    shortIds: short.slice(0, 50).map((v) => v.id),
    // Recent uploads, kept for trend and percentile stats.
    recent: { long: long.slice(0, 50).map(compact), short: short.slice(0, 50).map(compact) },
  };
}

// ~5 quota units per channel, cached for 12 hours. With `allowStale`, a failed
// refresh (no quota, offline) falls back to the last record we have, marked
// with `staleSince` (when it was fetched) and `staleReason`.
export function getBaseline(channelId, { fresh = false, allowStale = false } = {}) {
  return once(`c:${channelId}:${fresh}:${allowStale}`, async () => {
    const hit = fresh ? null : await cache.get(`c:${channelId}`);
    if (hit?.v === BASELINE_VERSION) return hit;
    try {
      const channel = await fetchChannel(channelId);
      const { long, short } = await channelUploads(channel, { long: 50, short: 50 });
      const record = baselineRecord(channel, long, short);
      await cache.set(`c:${channelId}`, record, BASELINE_TTL);
      return record;
    } catch (err) {
      const old = allowStale ? await cache.peek(`c:${channelId}`) : null;
      if (old?.value?.v !== BASELINE_VERSION) throw err;
      return { ...old.value, staleSince: old.exp - BASELINE_TTL, staleReason: err.message };
    }
  });
}

function score(video, base) {
  const format = classifyFormat(video, {
    shortIds: new Set(base?.shortIds ?? []),
    longIds: new Set(base?.longIds ?? []),
  });
  const baselineMedian = base?.[format]?.median ?? null;
  return {
    ...video,
    format,
    baselineMedian,
    multiplier: multiplier(video.views, baselineMedian),
    subs: base?.channel?.subs ?? null,
  };
}

// For thumbnail badges: { [videoId]: scored video }.
export async function scoreVideos(ids) {
  const videos = await getVideos(ids);
  const channelIds = [...new Set([...videos.values()].map((v) => v.channelId))];
  const baselines = new Map();
  await mapLimit(channelIds, 4, async (cid) => {
    try {
      baselines.set(cid, await getBaseline(cid));
    } catch (err) {
      if (err.reason === 'quotaExceeded' || err.reason === 'noKey') throw err;
      baselines.set(cid, null); // one bad channel shouldn't sink the batch
    }
  });
  const out = {};
  for (const [id, v] of videos) out[id] = score(v, baselines.get(v.channelId));
  return out;
}

// For the watch-page panel.
export async function videoReport(id) {
  const video = (await getVideos([id])).get(id);
  if (!video) throw new ApiError('Video not found (it may be private or deleted).');
  const base = await getBaseline(video.channelId);
  const scored = score(video, base);
  return {
    video: scored,
    channel: base.channel,
    baseline: base[scored.format],
    trend: channelTrend(base.recent[scored.format]),
  };
}

/**
 * Full stats snapshot for a saved idea: the video, its channel, and how the
 * video compares with the channel's recent uploads. Returns null if the video
 * is gone (deleted or private).
 */
export async function ideaSnapshot(id, { fresh = false } = {}) {
  const video = (await getVideos([id], { fresh })).get(id);
  if (!video) return null;
  const base = await getBaseline(video.channelId);
  const scored = score(video, base);
  const stats = ideaMetrics(scored, {
    channel: base.channel,
    baseline: base[scored.format],
    recent: base.recent[scored.format],
  });
  return { video: scored, channel: base.channel, stats };
}

// Re-fetches every saved idea. Videos are batched (1 unit per 50); channel
// baselines come from the 12h cache when possible.
export async function snapshotMany(ids) {
  await getVideos(ids, { fresh: true });
  const out = new Map();
  await mapLimit(ids, 4, async (id) => {
    try {
      out.set(id, await ideaSnapshot(id));
    } catch (err) {
      if (err.reason === 'quotaExceeded' || err.reason === 'noKey' || err.reason === 'keyInvalid') throw err;
      out.set(id, undefined); // transient failure: leave the idea as it was
    }
  });
  return out;
}

function summarize(videos, baseline) {
  if (!videos.length) return null;
  const views = videos.map((v) => v.views);
  const likeRates = videos.filter((v) => v.views && v.likes != null).map((v) => v.likes / v.views);
  return {
    count: videos.length,
    baselineMedian: baseline?.median ?? null,
    baselineSample: baseline?.sample ?? 0,
    medianViews: median(views),
    meanViews: mean(views),
    uploadsPerWeek: uploadsPerWeek(videos),
    likeRate: mean(likeRates),
    outliers2x: videos.filter((v) => v.multiplier >= 2).length,
    trend: channelTrend(videos),
  };
}

// For the channel panel: up to 200 long-form + 100 Shorts (~13 quota units).
export function analyzeChannel(ref, { fresh = false } = {}) {
  return once(`a:${JSON.stringify(ref)}:${fresh}`, async () => {
    const channelId = await resolveChannelId(ref);
    const hit = fresh ? null : await cache.get(`a:${channelId}`);
    if (hit) return hit;

    const channel = await fetchChannel(channelId);
    const { long, short } = await channelUploads(channel, { long: 200, short: 100 });
    const record = baselineRecord(channel, long, short);
    const tag = (list, format) =>
      list.map((v) => ({
        ...v,
        format,
        baselineMedian: record[format]?.median ?? null,
        multiplier: multiplier(v.views, record[format]?.median),
      }));
    const longScored = tag(long, 'long');
    const shortScored = tag(short, 'short');
    const analysis = {
      channel,
      long: { summary: summarize(longScored, record.long), videos: longScored },
      short: { summary: summarize(shortScored, record.short), videos: shortScored },
      fetchedAt: Date.now(),
    };
    // Keep the lighter baseline cache consistent with what we just computed.
    await cache.set(`c:${channelId}`, record, BASELINE_TTL);
    await cache.set(`a:${channelId}`, analysis, ANALYSIS_TTL);
    return analysis;
  });
}

// ---------- Keyword exploration ----------

const YT = 'https://www.youtube.com';
// Search filters, as they appear in YouTube's own URLs: videos only
// (relevance), and most viewed this year.
const SEARCH_FILTERS = ['EgIQAQ%253D%253D', 'CAMSBAgFEAE%253D'];
const SEARCH_TTL = 6 * HOUR;

function idsFromSearchHtml(html) {
  const ids = [];
  const patterns = [
    /"videoRenderer":\{"videoId":"([\w-]{11})"/g,
    /"reelWatchEndpoint":\{"videoId":"([\w-]{11})"/g,
    /"contentId":"([\w-]{11})","contentType":"LOCKUP_CONTENT_TYPE_VIDEO"/g,
  ];
  for (const re of patterns) for (const m of html.matchAll(re)) ids.push(m[1]);
  return ids;
}

/**
 * Video ids for a keyword. Reads YouTube's own search pages (free, no quota);
 * falls back to the Data API's search.list (100 quota units) if that fails.
 */
export function searchVideoIds(keyword) {
  const key = `s:${keyword.toLowerCase()}`;
  return once(key, async () => {
    const hit = await cache.get(key);
    if (hit) return hit;
    let ids = [];
    let source = 'search page';
    try {
      const pages = await Promise.all(
        SEARCH_FILTERS.map((sp) =>
          fetch(`${YT}/results?search_query=${encodeURIComponent(keyword)}&sp=${sp}`, {
            credentials: 'include',
            headers: { 'accept-language': 'en-US,en;q=0.9' },
          }).then((r) => (r.ok ? r.text() : '')),
        ),
      );
      ids = [...new Set(pages.flatMap(idsFromSearchHtml))];
    } catch {
      ids = [];
    }
    if (ids.length < 5) {
      const body = await call('search', { part: 'id', q: keyword, type: 'video', maxResults: 50 }, undefined, 100);
      ids = (body.items ?? []).map((i) => i.id.videoId).filter(Boolean);
      source = 'YouTube API';
    }
    const result = { ids: ids.slice(0, 50), source };
    await cache.set(key, result, SEARCH_TTL);
    return result;
  });
}

// YouTube search autocomplete (free).
export async function suggestions(keyword) {
  try {
    const res = await fetch(
      `https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&q=${encodeURIComponent(keyword)}`,
    );
    const [, list] = await res.json();
    return (list ?? []).filter((s) => s.toLowerCase() !== keyword.toLowerCase());
  } catch {
    return [];
  }
}

// Suggested videos ("Up next" sidebar) in a watch page's HTML, in order.
export function suggestedFromHtml(html) {
  const start = html.indexOf('"secondaryResults"');
  if (start < 0) return [];
  const part = html.slice(start);
  const ids = [];
  for (const m of part.matchAll(/"contentId":"([\w-]{11})","contentType":"LOCKUP_CONTENT_TYPE_VIDEO"/g)) ids.push(m[1]);
  for (const m of part.matchAll(/"compactVideoRenderer":\{"videoId":"([\w-]{11})"/g)) ids.push(m[1]);
  return [...new Set(ids)];
}

/**
 * What a watch page tells us for free: the "Most replayed" heatmap and the
 * suggested videos. One fetch serves both; cached for 24 hours.
 */
export function watchPage(videoId) {
  const key = `wp:${videoId}`;
  return once(key, async () => {
    const hit = await cache.get(key);
    if (hit) return hit;
    const res = await fetch(`${YT}/watch?v=${videoId}`, { credentials: 'include', headers: { 'accept-language': 'en-US,en;q=0.9' } });
    const html = res.ok ? await res.text() : '';
    const page = { heatmap: parseHeatmap(html), suggested: suggestedFromHtml(html) };
    await cache.set(key, page, 24 * HOUR);
    return page;
  });
}

// "Most replayed" heatmap scraped from the watch page (free). Null if none.
export async function fetchHeatmap(videoId) {
  return (await watchPage(videoId)).heatmap;
}

const webFields = (v) => ({
  title: v.title,
  channelId: v.channelId,
  channelTitle: v.channelTitle,
  publishedAt: v.publishedAt,
  views: v.views,
  thumb: v.thumb,
  format: v.format,
  multiplier: v.multiplier,
  baselineMedian: v.baselineMedian,
  subs: v.subs,
  tags: (v.tags ?? []).slice(0, 8),
});

/**
 * Expands nodes of a video web: fetches each one's suggestions (free) and
 * scores every new video (Data API: ~1 unit per 50 videos plus ~5 per new
 * channel). Mutates and returns `web`.
 */
export async function expandWeb(web, ids, { perNode = 8 } = {}) {
  await mapLimit(ids, 3, async (id) => {
    const { suggested } = await watchPage(id).catch(() => ({ suggested: [] }));
    addSuggestions(web, id, suggested, perNode);
  });
  const unscored = Object.values(web.nodes).filter((n) => !n.title).map((n) => n.id);
  if (unscored.length) {
    const scored = await scoreVideos(unscored);
    for (const id of unscored) {
      if (scored[id]) Object.assign(web.nodes[id], webFields(scored[id]));
      else delete web.nodes[id]; // private or deleted
    }
    web.edges = web.edges.filter((e) => web.nodes[e.from] && web.nodes[e.to]);
  }
  web.updatedAt = Date.now();
  return web;
}

/** A new web around `seedId`: its suggestions, then theirs (two levels). */
export async function buildWeb(seedId, { perNode = 8, secondLevel = 5 } = {}) {
  const web = { seed: seedId, nodes: { [seedId]: { id: seedId, depth: 0 } }, edges: [], createdAt: Date.now() };
  await expandWeb(web, [seedId], { perNode });
  const level1 = web.edges.filter((e) => e.from === seedId).map((e) => e.to);
  await expandWeb(web, level1, { perNode: secondLevel });
  return web;
}

const resultFields = (v) => ({
  id: v.id,
  title: v.title,
  channelId: v.channelId,
  channelTitle: v.channelTitle,
  publishedAt: v.publishedAt,
  durationSec: v.durationSec,
  views: v.views,
  likes: v.likes,
  comments: v.comments,
  thumb: v.thumb,
  format: v.format,
  multiplier: v.multiplier,
  baselineMedian: v.baselineMedian,
  subs: v.subs,
});

/**
 * One level of the rabbit hole: search a keyword, score every result against
 * its channel, and suggest where to dig next.
 */
export async function exploreKeyword(keyword) {
  const { ids, source } = await searchVideoIds(keyword);
  const scored = await scoreVideos(ids);
  const results = ids.map((id) => scored[id]).filter(Boolean);
  const outliers = results.filter((v) => v.multiplier >= OUTLIER_MIN);
  const basis = outliers.length >= 3 ? outliers : results;
  const autocomplete = await suggestions(keyword);
  return {
    keyword,
    source,
    fetchedAt: Date.now(),
    metrics: keywordMetrics(results),
    results: results.map(resultFields),
    related: {
      autocomplete,
      phrases: relatedPhrases(
        basis.map((v) => v.title),
        keyword,
        { tags: basis.flatMap((v) => v.tags ?? []) },
      ),
    },
  };
}

// ---------- Comments ----------

/**
 * The 100 most relevant top-level comments of a video (1 quota unit). Saved
 * permanently in `cm:<id>` (comment research doesn't need refreshing), unless
 * `fresh` is set.
 */
export async function videoComments(videoId, { fresh = false } = {}) {
  const key = `cm:${videoId}`;
  if (!fresh) {
    const { [key]: saved } = await chrome.storage.local.get(key);
    if (saved) return saved;
  }
  let body;
  try {
    body = await call('commentThreads', { part: 'snippet', videoId, order: 'relevance', maxResults: 100, textFormat: 'plainText' });
  } catch (err) {
    if (err.reason === 'commentsDisabled') throw new ApiError('Comments are turned off for this video.', { reason: 'commentsDisabled' });
    throw err;
  }
  const comments = (body.items ?? []).map((t) => {
    const c = t.snippet.topLevelComment.snippet;
    return { text: c.textDisplay ?? c.textOriginal ?? '', likes: c.likeCount ?? 0, replies: t.snippet.totalReplyCount ?? 0, author: c.authorDisplayName ?? '', at: c.publishedAt };
  });
  const result = { videoId, comments, fetchedAt: Date.now() };
  await chrome.storage.local.set({ [key]: result });
  return result;
}

/**
 * Recent top-level comments across a whole channel (any public channel; 1
 * quota unit, cached 12 hours). Used to give avatars real voices: only the
 * text, likes and video id are kept, never author names.
 */
export async function channelComments(channelId) {
  const key = `cc:${channelId}`;
  const hit = await cache.get(key);
  if (hit) return hit;
  let body;
  try {
    body = await call('commentThreads', { part: 'snippet', allThreadsRelatedToChannelId: channelId, maxResults: 100, textFormat: 'plainText' });
  } catch (err) {
    if (err.reason === 'commentsDisabled') return [];
    throw err;
  }
  const comments = (body.items ?? []).map((t) => {
    const c = t.snippet.topLevelComment.snippet;
    return { text: (c.textDisplay ?? c.textOriginal ?? '').slice(0, 500), likes: c.likeCount ?? 0, videoId: c.videoId ?? t.snippet.videoId ?? null };
  });
  await cache.set(key, comments, 12 * HOUR);
  return comments;
}

/** Basic info for one video (cached; 1 unit if not). */
export async function videoInfo(id) {
  const v = (await getVideos([id])).get(id);
  if (!v) throw new ApiError('Video not found (it may be private or deleted).');
  return v;
}
