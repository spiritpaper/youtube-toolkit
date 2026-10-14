// Google sign-in parsing, the Analytics client, and the competitor radar.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const DAY = 86_400_000;
const local = {};
const session = {};
const area = (store) => ({
  async get(keys) {
    if (keys == null) return structuredClone(store);
    const list = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
    return Object.fromEntries(list.filter((k) => k in store).map((k) => [k, structuredClone(store[k])]));
  },
  async set(obj) { Object.assign(store, structuredClone(obj)); },
  async remove(keys) { for (const k of [].concat(keys)) delete store[k]; },
});
let badge = '';
globalThis.chrome = {
  storage: { local: area(local), session: area(session) },
  identity: { getRedirectURL: () => 'https://abc.chromiumapp.org/' },
  action: { setBadgeText: async ({ text }) => (badge = text), setBadgeBackgroundColor: async () => {} },
};

let analyticsReply;
let dataApi;
const requests = [];
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url);
  requests.push(u);
  const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
  if (u.hostname === 'youtubeanalytics.googleapis.com') {
    assert.equal(init.headers.authorization, 'Bearer tok');
    return analyticsReply(Object.fromEntries(u.searchParams), json);
  }
  if (u.hostname === 'www.googleapis.com') return dataApi(u.pathname.split('/').pop(), Object.fromEntries(u.searchParams), json);
  throw new Error(`unexpected ${url}`);
};

const auth = await import('../src/background/auth.js');
const analytics = await import('../src/background/analytics.js');
const wl = await import('../src/background/watchlist.js');

beforeEach(() => {
  for (const s of [local, session]) for (const k of Object.keys(s)) delete s[k];
  session.googleToken = { token: 'tok', expiresAt: Date.now() + 3_600_000 };
  local.google = { clientId: 'cid', signedIn: true };
  local.apiKey = 'key';
  requests.length = 0;
});

test('parseRedirect reads the token and checks state and scopes', () => {
  const scope = encodeURIComponent(auth.SCOPES.join(' '));
  const ok = auth.parseRedirect(`https://abc.chromiumapp.org/#access_token=tok&expires_in=3600&state=s1&scope=${scope}`, 's1');
  assert.equal(ok.token, 'tok');
  assert.ok(ok.expiresAt > Date.now() + 3_000_000);
  assert.throws(() => auth.parseRedirect('https://abc.chromiumapp.org/#access_token=tok&state=other', 's1'), /did not match/);
  assert.throws(() => auth.parseRedirect('https://abc.chromiumapp.org/#error=access_denied&state=s1', 's1'), /cancelled/);
  assert.throws(
    () => auth.parseRedirect(`https://abc.chromiumapp.org/#access_token=tok&state=s1&scope=${encodeURIComponent(auth.SCOPES[1])}`, 's1'),
    /both YouTube permissions/,
  );
});

test('signed-out users get a clear error instead of a popup', async () => {
  delete session.googleToken;
  local.google = { clientId: 'cid' };
  await assert.rejects(auth.getToken(), (e) => e.reason === 'signedOut');
});

test('analytics rows become objects; thumbnail CTR is optional', async () => {
  analyticsReply = (p, json) => {
    if (p.metrics.startsWith('videoThumbnail')) return json({ error: { message: 'Unknown identifier' } }, 400);
    return json({ columnHeaders: [{ name: 'video' }, { name: 'views' }], rows: [['vid1', 120], ['vid2', 80]] });
  };
  const rows = await analytics.topVideos(28);
  assert.deepEqual(rows, [{ video: 'vid1', views: 120 }, { video: 'vid2', views: 80 }]);
  assert.equal(requests.filter((r) => r.hostname === 'youtubeanalytics.googleapis.com').length, 2);
  assert.equal(requests[0].searchParams.get('ids'), 'channel==MINE');
});

test('retention maps the curve', async () => {
  analyticsReply = (p, json) => {
    assert.equal(p.filters, 'video==abc');
    assert.equal(p.dimensions, 'elapsedVideoTimeRatio');
    return json({
      columnHeaders: [{ name: 'elapsedVideoTimeRatio' }, { name: 'audienceWatchRatio' }, { name: 'relativeRetentionPerformance' }],
      rows: [[0.01, 1.2, 0.7], [0.02, 0.9, 0.6]],
    });
  };
  assert.deepEqual(await analytics.retention('abc', '2026-01-02T00:00:00Z'), [
    { ratio: 0.01, watch: 1.2, relative: 0.7 },
    { ratio: 0.02, watch: 0.9, relative: 0.6 },
  ]);
});

test('a disabled Analytics API gets an actionable message', async () => {
  analyticsReply = (p, json) => json({ error: { message: 'YouTube Analytics API has not been used in project 123 before or it is disabled.' } }, 403);
  await assert.rejects(analytics.trafficSources(7), (e) => e.reason === 'apiDisabled' && /Enable the "YouTube Analytics API"/.test(e.message));
});

test('parseChannelInput accepts handles, URLs and ids', () => {
  assert.deepEqual(wl.parseChannelInput('@MrBeast'), { handle: '@MrBeast' });
  assert.deepEqual(wl.parseChannelInput('https://www.youtube.com/@veritasium/videos'), { handle: '@veritasium' });
  assert.deepEqual(wl.parseChannelInput('https://www.youtube.com/channel/UCX6OQ3DkcsbYNE6H8uQQuVA'), { id: 'UCX6OQ3DkcsbYNE6H8uQQuVA' });
  assert.deepEqual(wl.parseChannelInput('mkbhd'), { handle: '@mkbhd' });
  assert.equal(wl.parseChannelInput('  '), null);
});

test('radar reports only new outliers after a channel is watched', async () => {
  const CH = 'UC' + 'c'.repeat(22);
  const now = Date.now();
  let uploads = Array.from({ length: 12 }, (_, i) => ({ id: `old${String(i).padStart(8, '0')}`, days: 5 + i * 3, views: 1000 }));
  dataApi = (endpoint, p, json) => {
    if (endpoint === 'channels') {
      return json({ items: [{ id: CH, snippet: { title: 'Rival', thumbnails: {} }, statistics: { subscriberCount: '9000' }, contentDetails: { relatedPlaylists: { uploads: `UU${CH.slice(2)}` } } }] });
    }
    if (endpoint === 'playlistItems') {
      if (!p.playlistId.startsWith('UULF')) return json({ error: { errors: [{ reason: 'playlistNotFound' }] } }, 404);
      return json({ items: uploads.map((u) => ({ contentDetails: { videoId: u.id } })) });
    }
    if (endpoint === 'videos') {
      return json({
        items: p.id.split(',').map((id) => {
          const u = uploads.find((x) => x.id === id);
          return { id, snippet: { title: `T ${id}`, channelId: CH, channelTitle: 'Rival', publishedAt: new Date(now - u.days * DAY).toISOString(), thumbnails: {} }, statistics: { viewCount: String(u.views) }, contentDetails: { duration: 'PT10M' } };
        }),
      });
    }
    throw new Error(endpoint);
  };
  await wl.watch('@rival');
  assert.equal(await wl.radarCheck(), 0, 'existing videos are not reported');

  uploads = [{ id: 'newhit00001', days: 4, views: 6000 }, ...uploads];
  assert.equal(await wl.radarCheck(), 1);
  assert.equal(local.radar[0].id, 'newhit00001');
  assert.equal(local.radar[0].title, 'T newhit00001');
  assert.equal(badge, '1');
  assert.equal(await wl.radarCheck(), 0, 'reported once');
  await wl.markRadarRead();
  assert.equal(badge, '');

  const rows = await wl.compare(null);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, 'Rival');
  assert.equal(rows[0].subs, 9000);
});
