// YouTube Analytics API (your own channel only). Uses its own quota, separate
// from the Data API's 10,000 units.

import { getToken, AuthError } from './auth.js';
import * as cache from './cache.js';

const BASE = 'https://youtubeanalytics.googleapis.com/v2/reports';
const TTL = 3 * 3_600_000;

// Rows come back as arrays; turn them into objects keyed by column name.
export function toObjects(body) {
  const cols = (body.columnHeaders ?? []).map((c) => c.name);
  return (body.rows ?? []).map((row) => Object.fromEntries(row.map((v, i) => [cols[i], v])));
}

const ymd = (d) => d.toISOString().slice(0, 10);
const daysAgo = (n) => ymd(new Date(Date.now() - n * 86_400_000));

async function report(params, { retried = false } = {}) {
  const key = `ya:${JSON.stringify(params)}`;
  const hit = await cache.get(key);
  if (hit) return hit;
  const token = await getToken();
  const url = new URL(BASE);
  url.search = new URLSearchParams({ ids: 'channel==MINE', ...params });
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  const body = await res.json().catch(() => ({}));
  if (res.status === 401 && !retried) {
    await chrome.storage.session.remove('googleToken');
    return report(params, { retried: true });
  }
  if (!res.ok) {
    const msg = body.error?.message ?? `HTTP ${res.status}`;
    if (res.status === 403 && /not been used|disabled/i.test(msg)) {
      throw new AuthError('Enable the "YouTube Analytics API" in your Google Cloud project.', 'apiDisabled');
    }
    throw new AuthError(`YouTube Analytics: ${msg}`, 'analytics');
  }
  const rows = toObjects(body);
  await cache.set(key, rows, TTL);
  return rows;
}

const TOTALS = 'views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,subscribersLost,likes,comments,shares';

/**
 * Channel totals for the last `days` days and the period before it, plus a
 * daily series. Analytics data lags by about two days, so periods end 2 days ago.
 */
export async function overview(days = 28) {
  const end = 2;
  const [current, previous, daily] = await Promise.all([
    report({ startDate: daysAgo(end + days - 1), endDate: daysAgo(end), metrics: TOTALS }),
    report({ startDate: daysAgo(end + 2 * days - 1), endDate: daysAgo(end + days), metrics: TOTALS }),
    report({
      startDate: daysAgo(end + days - 1),
      endDate: daysAgo(end),
      metrics: 'views,estimatedMinutesWatched,subscribersGained,subscribersLost',
      dimensions: 'day',
      sort: 'day',
    }),
  ]);
  return { days, startDate: daysAgo(end + days - 1), endDate: daysAgo(end), current: current[0] ?? {}, previous: previous[0] ?? {}, daily };
}

// Not every account gets thumbnail impressions through the API; remember a refusal.
let thumbnailMetricsUnavailable = false;

/** Your top videos in the period, with thumbnail CTR where the API provides it. */
export async function topVideos(days = 28, limit = 50) {
  const range = { startDate: daysAgo(days + 1), endDate: daysAgo(2) };
  const rows = await report({
    ...range,
    metrics: 'views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,likes',
    dimensions: 'video',
    sort: '-views',
    maxResults: String(limit),
  });
  if (!thumbnailMetricsUnavailable && rows.length) {
    try {
      const ctr = await report({
        ...range,
        metrics: 'videoThumbnailImpressions,videoThumbnailImpressionsClickRate',
        dimensions: 'video',
        sort: '-videoThumbnailImpressions',
        maxResults: String(limit),
      });
      const byId = new Map(ctr.map((r) => [r.video, r]));
      for (const r of rows) Object.assign(r, byId.get(r.video) ?? {});
    } catch {
      thumbnailMetricsUnavailable = true;
    }
  }
  return rows;
}

/**
 * Audience retention for one video: 100 points of { ratio (0–1 through the
 * video), watch (share of viewers still watching; >1 means rewatches),
 * relative (0–1 vs. YouTube videos of similar length) }.
 */
export async function retention(videoId, publishedAt) {
  const rows = await report({
    startDate: (publishedAt ?? '2006-01-01').slice(0, 10),
    endDate: daysAgo(1),
    metrics: 'audienceWatchRatio,relativeRetentionPerformance',
    dimensions: 'elapsedVideoTimeRatio',
    filters: `video==${videoId}`,
    sort: 'elapsedVideoTimeRatio',
  });
  return rows.map((r) => ({ ratio: r.elapsedVideoTimeRatio, watch: r.audienceWatchRatio, relative: r.relativeRetentionPerformance }));
}

/** Where a video's (or the channel's) views come from. */
export async function trafficSources(days = 28, videoId = null) {
  return report({
    startDate: daysAgo(days + 1),
    endDate: daysAgo(2),
    metrics: 'views,estimatedMinutesWatched',
    dimensions: 'insightTrafficSourceType',
    sort: '-views',
    ...(videoId ? { filters: `video==${videoId}` } : {}),
  });
}

/** Lifetime totals for one of your videos, with thumbnail CTR where available. */
export async function videoTotals(videoId, publishedAt) {
  const range = { startDate: (publishedAt ?? '2006-01-01').slice(0, 10), endDate: daysAgo(0) };
  const [row] = await report({ ...range, metrics: 'views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,likes,shares', filters: `video==${videoId}` });
  const out = { ...(row ?? {}) };
  if (!thumbnailMetricsUnavailable) {
    try {
      const [ctr] = await report({ ...range, metrics: 'videoThumbnailImpressions,videoThumbnailImpressionsClickRate', filters: `video==${videoId}` });
      Object.assign(out, ctr ?? {});
    } catch {
      thumbnailMetricsUnavailable = true;
    }
  }
  return out;
}
