// Keyword trend alerts: followed keywords are checked daily for new outlier
// videos (2x+ their channel's median, published in the last 30 days). Search
// pages are free; only recent videos get scored, so each keyword costs about
// 1 unit plus ~5 per channel that isn't cached yet.

import { searchVideoIds, getVideos, scoreVideos } from './youtube.js';
import { addRadarItems } from './watchlist.js';
import { ageDays, OUTLIER_MIN } from '../lib/stats.js';

export const MAX_KEYWORDS = 15;
const RECENT_DAYS = 30;

async function load() {
  const { keywordAlerts = {} } = await chrome.storage.local.get('keywordAlerts');
  return keywordAlerts;
}
let chain = Promise.resolve();
function mutate(fn) {
  chain = chain.then(async () => {
    const all = await load();
    const result = await fn(all);
    await chrome.storage.local.set({ keywordAlerts: all });
    return result;
  });
  return chain;
}

export function listKeywords() {
  return load();
}

/** Follows a keyword. Videos already in its results count as seen. */
export async function followKeyword(keyword) {
  const kw = keyword.trim();
  if (!kw) throw new Error('Enter a keyword.');
  const { ids } = await searchVideoIds(kw);
  return mutate((all) => {
    if (!all[kw.toLowerCase()] && Object.keys(all).length >= MAX_KEYWORDS) {
      throw new Error(`You can follow up to ${MAX_KEYWORDS} keywords. Remove one first.`);
    }
    all[kw.toLowerCase()] = { keyword: kw, addedAt: Date.now(), seen: ids, lastChecked: null, found: all[kw.toLowerCase()]?.found ?? 0 };
    return all[kw.toLowerCase()];
  });
}

export function unfollowKeyword(keyword) {
  return mutate((all) => {
    delete all[keyword.toLowerCase()];
    return true;
  });
}

/** Daily check of every followed keyword. Returns how many alerts were added. */
export async function trendCheck() {
  const all = await load();
  let added = 0;
  for (const entry of Object.values(all)) {
    try {
      const { ids } = await searchVideoIds(entry.keyword);
      const fresh = ids.filter((id) => !entry.seen.includes(id));
      if (!fresh.length) {
        await mutate((a) => a[entry.keyword.toLowerCase()] && (a[entry.keyword.toLowerCase()].lastChecked = Date.now()));
        continue;
      }
      const details = await getVideos(fresh);
      const recent = fresh.filter((id) => details.get(id) && ageDays(details.get(id).publishedAt) <= RECENT_DAYS);
      const scored = recent.length ? await scoreVideos(recent) : {};
      const hits = Object.values(scored)
        .filter((v) => v.multiplier >= OUTLIER_MIN)
        .map((v) => ({
          id: v.id,
          title: v.title,
          thumb: v.thumb,
          channelId: v.channelId,
          channelTitle: v.channelTitle,
          format: v.format,
          multiplier: v.multiplier,
          views: v.views,
          publishedAt: v.publishedAt,
          baselineMedian: v.baselineMedian,
          source: { type: 'keyword', keyword: entry.keyword },
          foundAt: Date.now(),
          read: false,
        }));
      if (hits.length) await addRadarItems(hits);
      added += hits.length;
      await mutate((a) => {
        const e = a[entry.keyword.toLowerCase()];
        if (!e) return;
        e.seen = [...new Set([...e.seen, ...fresh])].slice(-600);
        e.lastChecked = Date.now();
        e.found = (e.found ?? 0) + hits.length;
      });
    } catch (err) {
      if (['quotaExceeded', 'noKey', 'keyInvalid'].includes(err.reason)) throw err;
    }
  }
  await chrome.storage.local.set({ trendsCheckedAt: Date.now() });
  return added;
}
