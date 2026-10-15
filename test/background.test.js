// Exercises the background worker's data layer against a fake YouTube API.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const DAY = 86_400_000;
const store = {};
globalThis.chrome = {
  storage: {
    local: {
      async get(keys) {
        if (keys == null) return { ...store };
        const list = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
        return Object.fromEntries(list.filter((k) => k in store).map((k) => [k, structuredClone(store[k])]));
      },
      async set(obj) { Object.assign(store, structuredClone(obj)); },
      async remove(keys) { for (const k of [].concat(keys)) delete store[k]; },
    },
  },
};

// Fake channel UCaaaaaaaaaaaaaaaaaaaaaa: 60 long videos (10k views each, except
// one 80k outlier) and 20 Shorts (1k views each). Channel UCbbb... has no
// per-format playlists, forcing the duration-based fallback.
const A = 'UC' + 'a'.repeat(22);
const B = 'UC' + 'b'.repeat(22);
const videos = new Map();
const lists = { [`UULF${A.slice(2)}`]: [], [`UUSH${A.slice(2)}`]: [], [`UU${B.slice(2)}`]: [] };
const now = Date.now();
for (let i = 0; i < 60; i++) {
  const id = `long${String(i).padStart(7, '0')}`;
  videos.set(id, { id, ch: A, views: i === 7 ? 80_000 : 10_000, dur: 'PT10M', days: 4 + i });
  lists[`UULF${A.slice(2)}`].push(id);
}
for (let i = 0; i < 20; i++) {
  const id = `shrt${String(i).padStart(7, '0')}`;
  videos.set(id, { id, ch: A, views: 1_000, dur: 'PT40S', days: 4 + i });
  lists[`UUSH${A.slice(2)}`].push(id);
}
for (let i = 0; i < 10; i++) {
  const id = `bvid${String(i).padStart(7, '0')}`;
  videos.set(id, { id, ch: B, views: i < 5 ? 500 : 100, dur: i < 5 ? 'PT20M' : 'PT30S', days: 5 + i });
  lists[`UU${B.slice(2)}`].push(id);
}

const calls = [];
globalThis.fetch = async (url) => {
  const u = new URL(url);
  const p = Object.fromEntries(u.searchParams);
  const endpoint = u.pathname.split('/').pop();
  calls.push(endpoint);
  const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
  if (p.key !== 'good-key') {
    return json({ error: { message: 'API key not valid. Please pass a valid API key.', errors: [{ reason: 'badRequest' }] } }, 400);
  }
  if (endpoint === 'channels') {
    const id = p.id ?? (p.forHandle === '@alpha' ? A : null);
    if (!id) return json({ items: [] });
    return json({
      items: [{
        id,
        snippet: { title: id === A ? 'Alpha' : 'Beta', customUrl: '@alpha', thumbnails: {} },
        statistics: { subscriberCount: '50000', viewCount: '1000000', videoCount: '80' },
        contentDetails: { relatedPlaylists: { uploads: `UU${id.slice(2)}` } },
      }],
    });
  }
  if (endpoint === 'playlistItems') {
    const all = lists[p.playlistId];
    if (!all) return json({ error: { message: 'not found', errors: [{ reason: 'playlistNotFound' }] } }, 404);
    const start = Number(p.pageToken ?? 0);
    const page = all.slice(start, start + 50);
    return json({
      items: page.map((videoId) => ({ contentDetails: { videoId } })),
      nextPageToken: start + 50 < all.length ? String(start + 50) : undefined,
    });
  }
  if (endpoint === 'videos') {
    const ids = p.id.split(',');
    assert.ok(ids.length <= 50, 'videos.list must be called with at most 50 ids');
    return json({
      items: ids.filter((id) => videos.has(id)).map((id) => {
        const v = videos.get(id);
        return {
          id,
          snippet: { title: `Video ${id}`, channelId: v.ch, channelTitle: 'x', publishedAt: new Date(now - v.days * DAY).toISOString(), thumbnails: {} },
          statistics: { viewCount: String(v.views), likeCount: '100', commentCount: '10' },
          contentDetails: { duration: v.dur },
        };
      }),
    });
  }
  if (endpoint === 'search') {
    return json({ items: [{ id: { videoId: 'long0000002' } }, { id: { videoId: 'long0000007' } }] });
  }
  throw new Error(`unexpected endpoint ${endpoint}`);
};

// YouTube's own pages and autocomplete, for keyword exploration.
const apiFetch = globalThis.fetch;
let searchHtml = '';
globalThis.fetch = async (url, init) => {
  const u = new URL(url);
  const text = (body) => ({ ok: true, status: 200, text: async () => body, json: async () => JSON.parse(body) });
  if (u.hostname === 'www.youtube.com' && u.pathname === '/results') {
    calls.push('search-page');
    return text(searchHtml);
  }
  if (u.hostname === 'www.youtube.com' && u.pathname === '/watch') {
    calls.push('watch-page');
    const markers = Array.from({ length: 100 }, (_, i) => ({ startMillis: String(i * 1000), durationMillis: '1000', intensityScoreNormalized: i === 50 ? 1 : 0.3 }));
    return text(`"markerType":"MARKER_TYPE_HEATMAP","markers":${JSON.stringify(markers)}`);
  }
  if (u.hostname === 'suggestqueries.google.com') {
    return text(JSON.stringify([u.searchParams.get('q'), [u.searchParams.get('q'), `${u.searchParams.get('q')} tips`, `${u.searchParams.get('q')} japan`]]));
  }
  return apiFetch(url, init);
};

const yt = await import('../src/background/youtube.js');
const api = await import('../src/background/api.js');

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  store.apiKey = 'good-key';
  calls.length = 0;
});

test('scores long-form and Shorts against their own medians', async () => {
  const out = await yt.scoreVideos(['long0000007', 'long0000001', 'shrt0000003']);
  assert.equal(out.long0000007.format, 'long');
  assert.equal(out.long0000007.baselineMedian, 10_000);
  assert.equal(out.long0000007.multiplier, 8);
  assert.equal(out.long0000001.multiplier, 1);
  assert.equal(out.shrt0000003.format, 'short');
  assert.equal(out.shrt0000003.multiplier, 1);
  // videos(batch) + channels + UULF + UUSH + videos(long) + videos(short)
  assert.ok(calls.length <= 6, `too many API calls: ${calls}`);
});

test('second request is served from cache', async () => {
  await yt.scoreVideos(['long0000007']);
  const before = calls.length;
  await yt.scoreVideos(['long0000007']);
  assert.equal(calls.length, before);
});

test('falls back to the full uploads playlist and duration when per-format playlists are missing', async () => {
  const out = await yt.scoreVideos(['bvid0000000', 'bvid0000009']);
  assert.equal(out.bvid0000000.format, 'long');
  assert.equal(out.bvid0000000.baselineMedian, 500);
  assert.equal(out.bvid0000009.format, 'short');
  assert.equal(out.bvid0000009.baselineMedian, 100);
});

test('analyzeChannel resolves a handle and paginates', async () => {
  const a = await yt.analyzeChannel({ handle: '@alpha' });
  assert.equal(a.channel.id, A);
  assert.equal(a.long.videos.length, 60);
  assert.equal(a.short.videos.length, 20);
  assert.equal(a.long.summary.outliers2x, 1);
  assert.equal(a.long.videos.find((v) => v.id === 'long0000007').multiplier, 8);
});

test('videoReport returns channel info and the matching baseline', async () => {
  const r = await yt.videoReport('shrt0000000');
  assert.equal(r.video.format, 'short');
  assert.equal(r.baseline.median, 1_000);
  assert.equal(r.channel.subs, 50_000);
});

test('invalid key surfaces a friendly keyInvalid error', async () => {
  store.apiKey = 'bad';
  await assert.rejects(yt.scoreVideos(['neverCached']), (err) => err.reason === 'keyInvalid');
});

test('a failed refresh falls back to the last channel record when allowed', async () => {
  const fresh = await yt.getBaseline(B, { fresh: true });
  store.apiKey = 'bad';
  await assert.rejects(yt.getBaseline(B, { fresh: true }), (err) => err.reason === 'keyInvalid');
  const stale = await yt.getBaseline(B, { fresh: true, allowStale: true });
  assert.equal(stale.long.median, fresh.long.median);
  assert.ok(stale.staleSince <= Date.now() && /key/i.test(stale.staleReason));
});

test('quota counter tracks calls', async () => {
  await yt.scoreVideos(['long0000003']);
  const n = calls.length;
  await new Promise((r) => setTimeout(r, 10));
  assert.equal((await api.getQuota()).used, n);
});

test('ideaSnapshot computes per-idea stats; snapshots build a daily history', async () => {
  const ideasLib = await import('../src/lib/ideas.js');
  const snap = await yt.ideaSnapshot('long0000007');
  assert.equal(snap.stats.multiplier, 8);
  assert.equal(snap.stats.aboveAverage, true);
  assert.ok(snap.stats.percentile > 95);
  assert.equal(snap.stats.subs, 50_000);

  await ideasLib.recordSnapshot(snap, { isSave: true });
  let idea = (await ideasLib.listIdeas()).long0000007;
  assert.equal(idea.history.length, 1);
  assert.equal(idea.stats.multiplier, 8);

  // A refresh on the same day adds one more point, the next same-day refresh replaces it.
  await ideasLib.recordSnapshots([snap]);
  await ideasLib.recordSnapshots([{ ...snap, video: { ...snap.video, views: 90_000 } }]);
  idea = (await ideasLib.listIdeas()).long0000007;
  assert.equal(idea.history.length, 2);
  assert.equal(idea.history[1].views, 90_000);

  // Snapshots for ideas that were removed are ignored.
  await ideasLib.removeIdea('long0000007');
  await ideasLib.recordSnapshots([snap]);
  assert.equal((await ideasLib.listIdeas()).long0000007, undefined);
});

test('legacy ideas get their save-time views as the first history point', async () => {
  const ideasLib = await import('../src/lib/ideas.js');
  store.ideas = { long0000003: { id: 'long0000003', views: 7000, savedAt: 1000, multiplier: 0.7, notes: 'keep me' } };
  const snap = await yt.ideaSnapshot('long0000003');
  await ideasLib.recordSnapshots([snap]);
  const idea = (await ideasLib.listIdeas()).long0000003;
  assert.equal(idea.history[0].views, 7000);
  assert.equal(idea.history[0].t, 1000);
  assert.equal(idea.history[1].views, 10_000);
  assert.equal(idea.notes, 'keep me');
});

test('snapshotMany marks deleted videos as null', async () => {
  const out = await yt.snapshotMany(['long0000001', 'deletedVid1']);
  assert.ok(out.get('long0000001'));
  assert.equal(out.get('deletedVid1'), null);
});

test('exploreKeyword scrapes search results for free and scores them', async () => {
  const found = ['long0000007', 'long0000001', 'shrt0000002', 'long0000004', 'long0000005'];
  searchHtml = found.map((id) => `"videoRenderer":{"videoId":"${id}"`).join(' ');
  const ex = await yt.exploreKeyword('alpha topic');
  assert.equal(ex.source, 'search page');
  assert.deepEqual(ex.results.map((r) => r.id), found);
  assert.equal(ex.results[0].multiplier, 8);
  assert.equal(ex.results[0].subs, 50_000);
  assert.equal(ex.metrics.outliers, 1);
  assert.deepEqual(ex.related.autocomplete, ['alpha topic tips', 'alpha topic japan']);
  assert.ok(!calls.includes('search'), 'no 100-unit API search needed');
});

test('search falls back to the API when the page yields nothing', async () => {
  searchHtml = '<html>consent page</html>';
  const ex = await yt.exploreKeyword('fallback topic');
  assert.equal(ex.source, 'YouTube API');
  assert.deepEqual(ex.results.map((r) => r.id), ['long0000002', 'long0000007']);
  assert.equal((await api.getQuota()).used >= 100, true);
});

test('fetchHeatmap parses and caches the replay heatmap', async () => {
  const points = await yt.fetchHeatmap('long0000009');
  assert.equal(points.length, 100);
  const before = calls.filter((c) => c === 'watch-page').length;
  await yt.fetchHeatmap('long0000009');
  assert.equal(calls.filter((c) => c === 'watch-page').length, before);
});

test('keyword alerts report only new recent outliers, once', async () => {
  globalThis.chrome.action = { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} };
  const trends = await import('../src/background/trends.js');
  const cacheMod = await import('../src/background/cache.js');
  const before = ['long0000001', 'long0000002', 'long0000003', 'long0000004', 'long0000005'];
  searchHtml = before.map((id) => `"videoRenderer":{"videoId":"${id}"`).join(' ');
  await trends.followKeyword('alpha travel');
  assert.deepEqual(Object.keys(await trends.listKeywords()), ['alpha travel']);

  await cacheMod.prune({ all: true }); // a day later: fresh search results
  searchHtml = [...before, 'long0000007', 'long0000006'].map((id) => `"videoRenderer":{"videoId":"${id}"`).join(' ');
  assert.equal(await trends.trendCheck(), 1, 'only the 8x video is an outlier');
  assert.equal(store.radar[0].id, 'long0000007');
  assert.equal(store.radar[0].source.keyword, 'alpha travel');
  assert.equal(await trends.trendCheck(), 0, 'not reported twice');
  await trends.unfollowKeyword('Alpha Travel');
  assert.deepEqual(await trends.listKeywords(), {});
});

test('published projects are tracked against their channel median', async () => {
  const projects = await import('../src/lib/projects.js');
  const published = await import('../src/background/published.js');
  assert.equal(published.parseVideoId('https://youtu.be/long0000007?t=3'), 'long0000007');
  assert.equal(published.parseVideoId('nonsense'), null);
  const p = await projects.createProject({ title: 'My video' });
  await projects.updateProject(p.id, { publishedVideoId: 'long0000007' });
  assert.equal(await published.trackPublished({ ids: [p.id], force: true }), 1);
  let perf = (await projects.listProjects())[p.id].performance;
  assert.equal(perf.videoId, 'long0000007');
  assert.equal(perf.history.length, 1);
  assert.equal(perf.history[0].multiplier, 8);
  assert.ok(perf.history[0].hours > 24 * 10);
  assert.deepEqual(perf.milestones, {}, 'linked 11 days late: milestones stay unknown');
  assert.equal(await published.trackPublished(), 0, 'not due again yet');
});
