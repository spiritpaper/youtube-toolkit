// Content gaps: topics that keep producing outliers for your competitors but
// don't appear in your own recent titles.

import { words } from './titles.js';

// Ignore generic words that don't describe a topic.
const GENERIC = new Set(
  'video videos part episode ep official new full best worst top every things thing ultimate complete really actually first last time times day days week year years better ways way most much more less only still ever never always nobody everyone people guy guys world life must need should know visit watch go going see look like want'.split(
    ' ',
  ),
);

function topicsOf(title) {
  const ws = words(title).filter((w) => w.length >= 3 && !/^\d+$/.test(w));
  const out = new Set();
  for (let i = 0; i < ws.length; i++) {
    if (!GENERIC.has(ws[i])) out.add(ws[i]);
    if (i + 1 < ws.length && !GENERIC.has(ws[i]) && !GENERIC.has(ws[i + 1])) out.add(`${ws[i]} ${ws[i + 1]}`);
  }
  return out;
}

/**
 * outliers: competitor videos [{ id, title, multiplier, channelId, channelTitle, ... }]
 * myTitles: your recent video titles.
 * all: (optional) titles of all the competitors' recent uploads (outliers
 *   included). When given, topics are ranked by *lift*: how much more common
 *   they are among outliers than among the other uploads, so niche-wide words
 *   ("travel") drop out.
 * Returns topics sorted by score: [{ topic, videos, channels, strength, lift, coveredBy }].
 * A topic needs 2+ outlier videos, or one 5x+ breakout. Strength sums
 * log2(multiplier) across its videos and rewards appearing on several channels.
 */
export function contentGaps(outliers, myTitles, { all = null, limit = 15, includeCovered = false, minLift = 1.3 } = {}) {
  const byTopic = new Map();
  for (const v of outliers) {
    for (const topic of topicsOf(v.title)) {
      if (!byTopic.has(topic)) byTopic.set(topic, []);
      byTopic.get(topic).push(v);
    }
  }
  const mine = myTitles.map((t) => ` ${words(t).join(' ')} `);
  // How often each topic appears across all recent uploads.
  let baseRate = null;
  if (all?.length) {
    baseRate = new Map();
    for (const t of all) for (const topic of topicsOf(t)) baseRate.set(topic, (baseRate.get(topic) ?? 0) + 1);
  }
  const gaps = [];
  for (const [topic, videos] of byTopic) {
    const strongest = Math.max(...videos.map((v) => v.multiplier));
    if (videos.length < 2 && strongest < 5) continue;
    const channels = [...new Set(videos.map((v) => v.channelTitle))];
    const strength = videos.reduce((n, v) => n + Math.log2(Math.max(v.multiplier, 1)), 0) * (1 + 0.5 * (channels.length - 1));
    const coveredBy = mine.filter((t) => t.includes(` ${topic} `)).length;
    if (coveredBy && !includeCovered) continue;
    let lift = null;
    if (baseRate) {
      // Share among outliers vs share among non-outliers (+1 smoothing).
      const inOthers = Math.max((baseRate.get(topic) ?? 0) - videos.length, 0);
      const others = Math.max(all.length - outliers.length, 0);
      lift = videos.length / outliers.length / ((inOthers + 1) / (others + 1));
      if (lift < minLift) continue; // about as common in ordinary uploads
    }
    // Two-word topics ("rail pass") say more than single words ("rail").
    const score = strength * Math.min(lift ?? 1, 4) * (topic.includes(' ') ? 1.5 : 1);
    const commonness = baseRate ? topic.split(' ').reduce((n, w) => n + (baseRate.get(w) ?? 0), 0) : 0;
    gaps.push({ topic, videos: [...videos].sort((a, b) => b.multiplier - a.multiplier), channels, strength, lift, score, commonness, coveredBy });
  }
  // On ties, the more specific topic (made of rarer words) wins.
  gaps.sort((a, b) => b.score - a.score || b.topic.split(' ').length - a.topic.split(' ').length || a.commonness - b.commonness);
  // A topic whose videos are all already listed under a stronger topic adds
  // nothing ("night trains" and "europe" for the same two videos).
  const kept = [];
  for (const g of gaps) {
    const dup = kept.some((k) => {
      const ids = new Set(k.videos.map((v) => v.id));
      return g.videos.every((v) => ids.has(v.id));
    });
    if (!dup) kept.push(g);
    if (kept.length >= limit) break;
  }
  return kept;
}
