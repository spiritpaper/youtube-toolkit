import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reviewData, lineAt } from '../src/lib/channel-review.js';
import { channelReviewPrompt } from '../src/lib/ai.js';

const curve = Array.from({ length: 100 }, (_, i) => ({ ratio: i / 100, watch: i < 40 ? 0.9 - i * 0.005 : 0.5 - (i - 40) * 0.004, relative: 0.42 }));
curve[40].watch = 0.62; // a cliff right after 0.39
const input = {
  me: { title: 'Dev Diaries' },
  days: 28,
  ov: {
    startDate: '2026-09-14', endDate: '2026-10-12',
    current: { views: 12000, estimatedMinutesWatched: 30000, averageViewDuration: 150, averageViewPercentage: 31.5, subscribersGained: 120, subscribersLost: 30, likes: 400, comments: 50, shares: 20 },
    previous: { views: 15000, estimatedMinutesWatched: 36000, averageViewDuration: 160, averageViewPercentage: 33, subscribersGained: 150, subscribersLost: 20 },
    daily: Array.from({ length: 28 }, (_, i) => ({ day: `d${i}`, views: i < 14 ? 500 : 357 })),
  },
  top: [
    { video: 'vid00000001', views: 8000, averageViewPercentage: 28, averageViewDuration: 168, subscribersGained: 90, estimatedMinutesWatched: 20000 },
    { video: 'vid00000002', views: 2000, averageViewPercentage: 45, averageViewDuration: 27, subscribersGained: 5, estimatedMinutesWatched: 900 },
  ],
  pub: {
    vid00000001: { title: 'I built a game in 7 days', views: 40000, multiplier: 2.4, durationSec: 600, format: 'long', publishedAt: '2026-09-20T10:00:00Z' },
    vid00000002: { title: 'One line of Rust', views: 3000, multiplier: 0.3, durationSec: 60, format: 'short' },
  },
  traffic: [{ insightTrafficSourceType: 'BROWSE', views: 6000 }, { insightTrafficSourceType: 'YT_SEARCH', views: 3000 }, { insightTrafficSourceType: 'SUGGESTED', views: 3000 }],
  curves: { vid00000001: curve },
  transcripts: { vid00000001: [{ start: 0, text: 'Day one.' }, { start: 230, text: 'Before we go on, let me tell you about my setup.' }, { start: 240, text: 'It has a desk.' }] },
  profile: { subs: 5000, medianLong: 16000, medianShort: 2000, uploadsPerWeek: 0.5, shortsPerWeek: 2, hitRate: 0.2, trend: 'declining', momentum: 0.7, likeRate: 0.04, viewsPerSub: 3.2 },
  peers: [{ title: 'Peer A', subs: 20000, medianLong: 40000, uploadsPerWeek: 1, hitRate: 0.3, trend: 'growing' }, { error: 'x' }],
};

test('the review data sheet carries exact numbers, places and words', () => {
  const { text, stats } = reviewData(input);
  assert.match(text, /Views: 12,000 \(-20% vs previous period\)/);
  assert.match(text, /net 90; previous period net 130/);
  assert.match(text, /first half of the period averaged 500\/day, second half 357\/day/);
  assert.match(text, /"I built a game in 7 days" \[vid00000001\]: 8,000 views in period, 40,000 lifetime, outlier score 2\.4x of my median, length 10:00/);
  assert.match(text, /not available from the API.*do not judge CTR/);
  assert.match(text, /Browse features: 50% of views/);
  assert.match(text, /Steepest drop after the intro: -.* at 4:06\. Said there: ".*let me tell you about my setup/);
  assert.match(text, /Peer A: 20,000 subs, median 40,000 views/);
  assert.ok(!text.includes('undefined') && !text.includes('NaN'));
  assert.deepEqual(stats, { days: 28, views: 12000, avgPct: 31.5, netSubs: 90, videos: 2, retention: 1, ctr: false });
});

test('missing pieces are left out, not invented', () => {
  const { text } = reviewData({ days: 7, ov: { current: {}, previous: {} }, top: [] });
  assert.ok(!text.includes('undefined') && !text.includes('NaN'));
  assert.ok(!/Retention|Channels I follow|Where views came from/.test(text));
  assert.equal(lineAt([], 10), null);
});

test('the review prompt asks for what, where, evidence, fix and check, without softening', () => {
  const { system, prompt } = channelReviewPrompt('DATA-SHEET', 'coding vlogs');
  assert.match(system, /not to hold back/);
  assert.match(system, /Use ONLY the data provided/);
  assert.match(prompt, /DATA-SHEET/);
  assert.match(prompt, /coding vlogs/);
  for (const part of ['**What:**', '**Where:**', '**Evidence:**', '**Fix:**', '**Check:**']) assert.ok(prompt.includes(part), part);
});
