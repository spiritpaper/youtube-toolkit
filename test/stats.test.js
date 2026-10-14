import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  median,
  parseDuration,
  computeBaseline,
  multiplier,
  classifyFormat,
  toCsv,
  DAY_MS,
  percentileRank,
  channelTrend,
  ideaMetrics,
  trackingStats,
} from '../src/lib/stats.js';

test('median handles odd, even, empty and non-finite values', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([]), null);
  assert.equal(median([null, 5, NaN]), 5);
});

test('parseDuration', () => {
  assert.equal(parseDuration('PT1H2M3S'), 3723);
  assert.equal(parseDuration('PT45S'), 45);
  assert.equal(parseDuration('P1DT1M'), 86460);
  assert.equal(parseDuration('P0D'), 0);
  assert.equal(parseDuration(undefined), 0);
});

test('baseline excludes young videos and caps the sample at 30', () => {
  const now = Date.UTC(2026, 0, 31);
  const vid = (daysAgo, views) => ({ views, publishedAt: new Date(now - daysAgo * DAY_MS).toISOString() });
  const videos = [vid(0.5, 10), vid(1, 20), ...Array.from({ length: 40 }, (_, i) => vid(5 + i, 1000 + i))];
  const b = computeBaseline(videos, now);
  assert.equal(b.sample, 30);
  // the 30 newest mature videos have views 1000..1029
  assert.equal(b.median, 1014.5);
});

test('baseline falls back to young videos when too few mature ones exist', () => {
  const now = Date.UTC(2026, 0, 31);
  const videos = [1, 2].map((d) => ({ views: d * 100, publishedAt: new Date(now - d * DAY_MS).toISOString() }));
  assert.equal(computeBaseline(videos, now).median, 150);
  assert.equal(computeBaseline([], now), null);
});

test('multiplier', () => {
  assert.equal(multiplier(5000, 1000), 5);
  assert.equal(multiplier(5000, 0), null);
  assert.equal(multiplier(null, 1000), null);
});

test('classifyFormat prefers playlist membership, then duration', () => {
  const sets = { shortIds: new Set(['s']), longIds: new Set(['l']) };
  assert.equal(classifyFormat({ id: 's', durationSec: 900 }, sets), 'short');
  assert.equal(classifyFormat({ id: 'l', durationSec: 30 }, sets), 'long');
  assert.equal(classifyFormat({ id: 'x', durationSec: 59 }, sets), 'short');
  assert.equal(classifyFormat({ id: 'x', durationSec: 600 }, sets), 'long');
});

test('toCsv escapes quotes, commas and newlines', () => {
  const csv = toCsv([{ a: 'he said "hi", ok', b: 'line1\nline2' }], [
    { label: 'A', get: (r) => r.a },
    { label: 'B', get: (r) => r.b },
  ]);
  assert.equal(csv, 'A,B\r\n"he said ""hi"", ok","line1\nline2"');
});


const NOW = Date.UTC(2026, 5, 1);
const at = (daysAgo) => new Date(NOW - daysAgo * DAY_MS).toISOString();

test('percentileRank counts ties as half', () => {
  assert.equal(percentileRank(50, [10, 20, 50, 100]), 62.5);
  assert.equal(percentileRank(5, []), null);
});

test('channelTrend detects a growing channel', () => {
  // Newer uploads get progressively more views.
  const videos = Array.from({ length: 30 }, (_, i) => ({ publishedAt: at(15 + i * 7), views: 100_000 / (1 + i * 0.1) }));
  const t = channelTrend(videos, NOW);
  assert.equal(t.label, 'growing');
  assert.ok(t.momentum > 1.25);
  assert.ok(t.monthlyChange > 0);
  assert.equal(t.recentCount, 10);
});

test('channelTrend detects decline, ignores too-young videos, and needs 8 videos', () => {
  const declining = Array.from({ length: 30 }, (_, i) => ({ publishedAt: at(15 + i * 7), views: 10_000 * (1 + i * 0.1) }));
  assert.equal(channelTrend(declining, NOW).label, 'declining');
  const flat = Array.from({ length: 20 }, (_, i) => ({ publishedAt: at(15 + i), views: 5000 }));
  // A brand-new video with few views must not drag the trend down.
  flat.push({ publishedAt: at(1), views: 10 });
  assert.equal(channelTrend(flat, NOW).label, 'stable');
  assert.equal(channelTrend(flat.slice(0, 5), NOW), null);
});

test('ideaMetrics compares a video with its channel', () => {
  const recent = Array.from({ length: 20 }, (_, i) => ({ id: `v${i}`, publishedAt: at(20 + i), views: 1000 + i * 100, likes: 20, comments: 2 }));
  const video = { id: 'hit', publishedAt: at(10), views: 9000, likes: 450, comments: 30 };
  const m = ideaMetrics(video, { channel: { subs: 3000 }, baseline: { median: 2000, mean: 2500, sample: 20 }, recent }, NOW);
  assert.equal(m.multiplier, 4.5);
  assert.equal(m.vsAverage, 3.6);
  assert.equal(m.aboveAverage, true);
  assert.equal(m.percentile, 100);
  assert.equal(m.viewsPerSub, 3);
  assert.equal(m.viewsPerDay, 900);
  assert.equal(m.likeRate, 0.05);
  assert.ok(m.likeRateVsChannel > 1);
  assert.ok(['growing', 'stable', 'declining'].includes(m.trend));
});

test('trackingStats measures change since the first snapshot', () => {
  const t = trackingStats([
    { t: 0, views: 1000, subs: 500 },
    { t: 5 * DAY_MS, views: 1500, subs: 520 },
    { t: 10 * DAY_MS, views: 3000, subs: 560 },
  ]);
  assert.deepEqual(t, { days: 10, viewsGained: 2000, viewsPerDay: 200, growthPct: 2, subsChange: 60 });
  assert.equal(trackingStats([{ t: 0, views: 1 }]), null);
});

import { keywordMetrics, relatedPhrases, parseHeatmap, heatmapPeaks, heatmapSummary, formatTime } from '../src/lib/stats.js';

test('keywordMetrics rewards outliers, small channels, freshness and demand', () => {
  const v = (mult, subs, daysAgo, views) => ({ multiplier: mult, subs, publishedAt: at(daysAgo), views });
  const hot = keywordMetrics([v(5, 10_000, 30, 500_000), v(3, 20_000, 60, 300_000), v(1, 900_000, 400, 50_000), v(2.5, 40_000, 10, 1_000_000)], NOW);
  assert.equal(hot.outliers, 3);
  assert.equal(hot.smallChannelOutliers, 3);
  assert.equal(hot.outlierRate, 0.75);
  assert.equal(hot.freshness, 0.75);
  const cold = keywordMetrics([v(0.5, 5_000_000, 900, 2000), v(1, 2_000_000, 1200, 3000)], NOW);
  assert.ok(hot.opportunity > 70, `hot ${hot.opportunity}`);
  assert.ok(cold.opportunity < 15, `cold ${cold.opportunity}`);
  assert.equal(keywordMetrics([], NOW), null);
});

test('relatedPhrases finds recurring angles beyond the keyword', () => {
  const titles = [
    'Budget travel in Japan for $30 a day',
    'Japan on a budget: cheap eats guide',
    'Budget travel hacks for Europe trains',
    'Europe trains are cheaper than you think',
    'Hostel life budget travel tips',
    'My budget travel tips after 40 countries',
  ];
  const out = relatedPhrases(titles, 'budget travel');
  assert.ok(out.includes('budget travel tips') || out.includes('travel tips'), out.join(', '));
  assert.ok(out.some((p) => p.includes('japan')), out.join(', '));
  assert.ok(out.some((p) => p.includes('europe')), out.join(', '));
  assert.ok(!out.includes('budget travel'));
});

test('parseHeatmap reads the replay markers from watch-page HTML', () => {
  const markers = Array.from({ length: 100 }, (_, i) => ({ startMillis: String(i * 6000), durationMillis: '6000', intensityScoreNormalized: i === 40 ? 1 : i === 70 ? 0.8 : 0.2 }));
  const html = `..."markersList":{"markerType":"MARKER_TYPE_HEATMAP","markers":${JSON.stringify(markers)},"markersMetadata":{}}...`;
  const points = parseHeatmap(html);
  assert.equal(points.length, 100);
  assert.deepEqual(points[40], { start: 240, duration: 6, intensity: 1 });
  assert.deepEqual(heatmapPeaks(points, { count: 2 }).map((p) => p.start), [240, 420]);
  assert.ok(heatmapSummary(points).holdRatio > 0);
  assert.equal(parseHeatmap('<html>no markers</html>'), null);
  assert.equal(formatTime(3725), '1:02:05');
  assert.equal(formatTime(65), '1:05');
});

import { channelProfile, newOutliers, change } from '../src/lib/stats.js';

test('channelProfile summarizes a channel like-for-like', () => {
  const long = Array.from({ length: 20 }, (_, i) => ({ id: `l${i}`, publishedAt: at(5 + i * 7), views: i === 2 ? 50_000 : 10_000, likes: 400 }));
  const p = channelProfile({ channel: { id: 'UC1', title: 'Me', subs: 20_000 }, long: { median: 10_000 }, short: null, recent: { long, short: [] } }, NOW);
  assert.equal(p.hitRate, 1 / 20);
  assert.equal(p.viewsPerSub, 0.5);
  assert.equal(p.likeRate, 0.04);
  assert.ok(p.uploadsPerWeek > 0.9 && p.uploadsPerWeek < 1.1);
  assert.equal(p.medianShort, null);
});

test('newOutliers finds fresh breakouts not seen before', () => {
  const base = {
    long: { median: 1000 },
    short: { median: 100 },
    recent: {
      long: [
        { id: 'fresh-hit', publishedAt: at(3), views: 5000 },
        { id: 'fresh-meh', publishedAt: at(3), views: 900 },
        { id: 'old-hit', publishedAt: at(40), views: 9000 },
        { id: 'seen-hit', publishedAt: at(2), views: 4000 },
      ],
      short: [{ id: 'short-hit', publishedAt: at(1), views: 300 }],
    },
  };
  const out = newOutliers(base, new Set(['seen-hit']), NOW);
  assert.deepEqual(out.map((o) => o.id), ['fresh-hit', 'short-hit']);
  assert.equal(out[0].multiplier, 5);
  assert.equal(change(120, 100), 0.2);
  assert.equal(change(5, 0), null);
});

import { retentionSummary } from '../src/lib/stats.js';

test('retentionSummary finds checkpoints, the steepest drop and rewatches', () => {
  const points = Array.from({ length: 100 }, (_, i) => {
    const ratio = (i + 1) / 100;
    let watch = 1 - ratio * 0.5;
    if (i >= 60) watch -= 0.15; // a sudden drop at 61%
    if (i === 30) watch += 0.1; // a rewatched moment
    return { ratio, watch, relative: 0.6 };
  });
  const s = retentionSummary(points);
  assert.ok(Math.abs(s.at10 - 0.95) < 0.01);
  assert.ok(Math.abs(s.steepestDrop.ratio - 0.61) < 0.001);
  assert.deepEqual(s.rewatchMoments, [0.31]);
  assert.ok(Math.abs(s.relative - 0.6) < 1e-9);
  assert.equal(retentionSummary([]), null);
});

import { channelGrowth } from '../src/lib/stats.js';

test('channelGrowth measures change over a window of daily snapshots', () => {
  const day = 86_400_000;
  const now = 100 * day;
  const h = [0, 50, 75, 90, 100].map((d, i) => ({ t: d * day, subs: 1000 + i * 100, totalViews: 1e6 + i * 1e5, videoCount: 10 + i }));
  const g = channelGrowth(h, 30, now);
  assert.equal(g.subs, 200); // from day 75 (1200) to day 100 (1400)
  assert.equal(g.days, 25);
  assert.equal(channelGrowth(h, 365, now).subs, 400);
  assert.equal(channelGrowth(h.slice(0, 1), 30, now), null);
});
