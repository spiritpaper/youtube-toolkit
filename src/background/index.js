import { call, getQuota } from './api.js';
import * as cache from './cache.js';
import {
  scoreVideos,
  videoReport,
  analyzeChannel,
  ideaSnapshot,
  snapshotMany,
  exploreKeyword,
  fetchHeatmap,
  suggestions,
  resolveChannelId,
  buildWeb,
  expandWeb,
  videoComments,
  channelComments,
  videoInfo,
} from './youtube.js';
import {
  recordSnapshot,
  recordSnapshots,
  markUnavailable,
  updateIdea,
  removeIdea,
  listIdeas,
} from '../lib/ideas.js';
import { addNode, getNode, listNodes, updateNode, deleteNodes, deleteHolesOlderThan } from '../lib/explore-store.js';
import { usage, cleanup, exportAll, importAll } from '../lib/storage-admin.js';
import { getNotes, listNoted, addNote, updateNote, deleteNote } from '../lib/notes.js';
import { listGroups, saveGroup, deleteGroup, saveAvatar, deleteAvatar } from '../lib/avatars-store.js';
import { rememberLoadedBuild, reloadIfUpdated, checkForRelease } from './updates.js';
import { companionHello, startDownload, cancelDownload, revealDownload, updateDownloader, clearDownloads } from './companion.js';
import { signIn, signOut, authStatus } from './auth.js';
import { listProjects, createProject, updateProject, deleteProject, mutateProjects, archiveOld, ARCHIVE_DAYS_DEFAULT } from '../lib/projects.js';
import { followKeyword, unfollowKeyword, listKeywords, trendCheck, mutateAlerts } from './trends.js';
import { trackPublished, parseVideoId } from './published.js';
import { videoTotals } from './analytics.js';
import { overview, topVideos, retention, trafficSources, audienceProfile } from './analytics.js';
import { watch, unwatch, compare, radarCheck, markRadarRead, clearRadar, updateBadge, parseChannelInput, gapData, following, updateFollow, mutateWatch, mutateRadar } from './watchlist.js';

// holeRetentionDays: rabbit holes untouched for this long are deleted (0 = keep forever).
const DEFAULT_SETTINGS = { badges: true, watchPanel: true, badgeMin: 0, trackDaily: true, holeRetentionDays: 180, archiveAfterDays: ARCHIVE_DAYS_DEFAULT };
const REFRESH_ALARM = 'refresh-ideas';
const REFRESH_EVERY_MS = 23 * 3_600_000;

async function setup() {
  const current = await chrome.storage.local.get(Object.keys(DEFAULT_SETTINGS));
  const missing = Object.fromEntries(
    Object.entries(DEFAULT_SETTINGS).filter(([k]) => current[k] === undefined),
  );
  await chrome.storage.local.set(missing);
  // Checked every few hours; refreshes at most once a day, so a browser that
  // was closed at the usual time still catches up.
  await chrome.alarms.create(REFRESH_ALARM, { delayInMinutes: 2, periodInMinutes: 240 });
  await cache.prune();
  await updateBadge();
}

chrome.runtime.onInstalled.addListener(setup);
chrome.runtime.onStartup.addListener(setup);
chrome.runtime.onInstalled.addListener(() => rememberLoadedBuild().catch(() => {}));
chrome.runtime.onStartup.addListener(() => rememberLoadedBuild().catch(() => {}));
const UPDATE_ALARM = 'self-update';
// Created once; re-creating it on every service-worker start would keep postponing it.
chrome.alarms.get(UPDATE_ALARM).then((a) => a || chrome.alarms.create(UPDATE_ALARM, { delayInMinutes: 1, periodInMinutes: 5 }));

let refreshing = null;
function refreshIdeas() {
  refreshing ??= (async () => {
    const ids = Object.keys(await listIdeas());
    if (!ids.length) return { updated: 0, missing: 0, failed: 0 };
    const snaps = await snapshotMany(ids);
    const good = [];
    const gone = [];
    for (const [id, snap] of snaps) {
      if (snap) good.push(snap);
      else if (snap === null) gone.push(id);
    }
    await recordSnapshots(good);
    if (gone.length) await markUnavailable(gone);
    await storeMissingHeatmaps(good.map((snap) => snap.video.id));
    await chrome.storage.local.set({ ideasRefreshedAt: Date.now() });
    return { updated: good.length, missing: gone.length, failed: ids.length - good.length - gone.length };
  })().finally(() => (refreshing = null));
  return refreshing;
}

// Heatmaps are free to fetch, so saved ideas get one whenever it's missing.
async function storeMissingHeatmaps(ids) {
  const keys = ids.map((id) => `hm:${id}`);
  const have = await chrome.storage.local.get(keys);
  for (const id of ids.filter((id) => !have[`hm:${id}`])) {
    const points = await fetchHeatmap(id).catch(() => null);
    if (points) await chrome.storage.local.set({ [`hm:${id}`]: { points, at: Date.now() } });
  }
}

chrome.alarms.onAlarm.addListener(async ({ name }) => {
  if (name === UPDATE_ALARM) {
    if (await reloadIfUpdated().catch(() => false)) return;
    await checkForRelease().catch(() => {});
    return;
  }
  if (name !== REFRESH_ALARM) return;
  const s = await chrome.storage.local.get(['trackDaily', 'apiKey', 'ideasRefreshedAt', 'holeRetentionDays']);
  if (s.holeRetentionDays > 0) await deleteHolesOlderThan(s.holeRetentionDays).catch(() => {});
  await archivePublished().catch(() => {});
  await cache.prune().catch(() => {});
  if (!s.apiKey) return;
  await trackPublished().catch(() => {}); // has its own schedule
  const { radarCheckedAt = 0 } = await chrome.storage.local.get('radarCheckedAt');
  if (Date.now() - radarCheckedAt >= REFRESH_EVERY_MS) await radarCheck().catch(() => {});
  const { trendsCheckedAt = 0 } = await chrome.storage.local.get('trendsCheckedAt');
  if (Date.now() - trendsCheckedAt >= REFRESH_EVERY_MS) await trendCheck().catch(() => {});
  if (s.trackDaily === false) return;
  if (Date.now() - (s.ideasRefreshedAt ?? 0) < REFRESH_EVERY_MS) return;
  refreshIdeas().catch(() => {}); // retried on the next alarm
});

async function archivePublished() {
  const { archiveAfterDays = ARCHIVE_DAYS_DEFAULT } = await chrome.storage.local.get('archiveAfterDays');
  return archiveOld(archiveAfterDays);
}

async function saveIdea(video, foundVia) {
  // Store a full stats snapshot; fall back to what the page already had.
  const snap = await ideaSnapshot(video.id).catch(() => null);
  await recordSnapshot(snap ?? { video }, { isSave: true });
  const existing = (await listIdeas())[video.id];
  if (foundVia && !existing?.foundVia) await updateIdea(video.id, { foundVia });
  storeMissingHeatmaps([video.id]).catch(() => {});
  return true;
}

async function saveTranscript({ id, segments, lang, kind }) {
  await chrome.storage.local.set({ [`tx:${id}`]: { segments, lang: lang ?? '', kind: kind ?? '', at: Date.now() } });
  return true;
}

async function explore({ keyword, parentId }) {
  const exploration = await exploreKeyword(keyword.trim());
  const node = await addNode({ parentId, exploration });
  return { ...node, ...exploration };
}

// Video webs are stored one per key (vw:<seed id>) so each can be deleted cleanly.
const MAX_WEBS = 30;
async function saveWeb(web) {
  await chrome.storage.local.set({ [`vw:${web.seed}`]: web });
  const all = await chrome.storage.local.get(null);
  const webs = Object.entries(all).filter(([k]) => k.startsWith('vw:')).sort((a, b) => (b[1].updatedAt ?? 0) - (a[1].updatedAt ?? 0));
  if (webs.length > MAX_WEBS) await chrome.storage.local.remove(webs.slice(MAX_WEBS).map(([k]) => k));
  return web;
}

const webHandlers = {
  webBuild: async ({ seed }) => saveWeb(await buildWeb(seed)),
  webExpand: async ({ seed, id, perNode = 8 }) => {
    const { [`vw:${seed}`]: web } = await chrome.storage.local.get(`vw:${seed}`);
    if (!web) throw new Error('This web was deleted.');
    return saveWeb(await expandWeb(web, [id], { perNode: Math.min(perNode, 20) }));
  },
  webGet: async ({ seed }) => (await chrome.storage.local.get(`vw:${seed}`))[`vw:${seed}`] ?? null,
  webList: async () => {
    const all = await chrome.storage.local.get(null);
    return Object.entries(all)
      .filter(([k]) => k.startsWith('vw:'))
      .map(([, w]) => ({ seed: w.seed, title: w.nodes[w.seed]?.title ?? w.seed, size: Object.keys(w.nodes).length, updatedAt: w.updatedAt }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  },
  webDelete: async ({ seed }) => {
    await chrome.storage.local.remove(`vw:${seed}`);
    return true;
  },
};

// Your AI channel reviews, newest first, so you can compare them over time.
async function saveChannelReview(review) {
  const { channelReviews = [] } = await chrome.storage.local.get('channelReviews');
  const saved = { ...review, at: Date.now() };
  await chrome.storage.local.set({ channelReviews: [saved, ...channelReviews].slice(0, 12) });
  return saved;
}

async function saveAiRun(run) {
  const { aiRuns = [] } = await chrome.storage.local.get('aiRuns');
  await chrome.storage.local.set({ aiRuns: [{ ...run, at: Date.now() }, ...aiRuns].slice(0, 20) });
  return true;
}

const handlers = {
  scoreVideos: ({ ids }) => scoreVideos(ids),
  videoReport: ({ id }) => videoReport(id),
  analyzeChannel: ({ ref, fresh }) => analyzeChannel(ref, { fresh }),
  saveIdea: ({ video, foundVia }) => saveIdea(video, foundVia),
  updateIdea: ({ id, patch }) => updateIdea(id, patch).then(() => true),
  removeIdea: ({ id }) => removeIdea(id).then(() => true),
  savedIds: () => listIdeas().then((ideas) => Object.keys(ideas)),
  refreshIdeas: () => refreshIdeas(),
  saveAiRun: ({ run }) => saveAiRun(run),
  heatmap: ({ id }) => fetchHeatmap(id),
  openExplorer: async ({ keyword }) => {
    const url = chrome.runtime.getURL(`src/explore/explore.html${keyword ? `?q=${encodeURIComponent(keyword)}` : ''}`);
    await chrome.tabs.create({ url });
    return true;
  },
  saveTranscript: (msg) => saveTranscript(msg),
  saveScriptAi: async ({ id, key, ai }) => {
    // AI results live with the transcript, so deleting transcripts removes them too.
    const k = `tx:${id}`;
    const { [k]: tx } = await chrome.storage.local.get(k);
    if (!tx) throw new Error('Save the transcript first.');
    await chrome.storage.local.set({ [k]: { ...tx, [key]: { ...ai, at: Date.now() } } });
    return true;
  },
  ...webHandlers,
  projects: () => listProjects(),
  projectCreate: ({ data }) => createProject(data),
  projectUpdate: ({ id, patch }) => updateProject(id, patch),
  projectDelete: ({ id }) => deleteProject(id),
  projectsArchiveOld: () => archivePublished(),
  saveChannelReview: ({ review }) => saveChannelReview(review),
  channelReviews: async () => (await chrome.storage.local.get('channelReviews')).channelReviews ?? [],
  deleteChannelReview: async ({ at }) => {
    const { channelReviews = [] } = await chrome.storage.local.get('channelReviews');
    await chrome.storage.local.set({ channelReviews: channelReviews.filter((r) => r.at !== at) });
    return true;
  },
  checkForUpdate: () => checkForRelease({ force: true }),
  companionHello: () => companionHello(),
  downloadStart: (msg) => startDownload(msg),
  downloadCancel: ({ job }) => cancelDownload(job),
  downloadReveal: ({ file }) => revealDownload(file),
  downloaderUpdate: () => updateDownloader(),
  downloadsClear: () => clearDownloads(),
  reloadIfUpdated: () => reloadIfUpdated(),
  notesGet: ({ id }) => getNotes(id),
  notesList: () => listNoted(),
  notesAdd: ({ id, note }) => addNote(id, note),
  notesUpdate: ({ id, noteId, patch }) => updateNote(id, noteId, patch),
  notesDelete: ({ id, noteId }) => deleteNote(id, noteId),
  projectPublish: async ({ id, input }) => {
    const videoId = parseVideoId(input);
    if (!videoId) throw new Error('Paste the link of your published video.');
    await updateProject(id, { publishedVideoId: videoId, status: 'published' });
    await trackPublished({ ids: [id], force: true });
    return (await listProjects())[id];
  },
  projectTrack: async ({ id }) => {
    await trackPublished({ ids: [id], force: true });
    return (await listProjects())[id];
  },
  myVideoTotals: ({ id, publishedAt }) => videoTotals(id, publishedAt),
  openPage: async ({ page, query = '' }) => {
    const pages = { script: 'src/script/script.html', ideas: 'src/ideas/ideas.html', web: 'src/web/web.html', audience: 'src/audience/audience.html', downloads: 'src/downloads/downloads.html' };
    await chrome.tabs.create({ url: chrome.runtime.getURL(`${pages[page]}${query}`) });
    return true;
  },
  explore: (msg) => explore(msg),
  suggest: ({ keyword }) => suggestions(keyword),
  exploreNodes: () => listNodes(),
  exploreNode: ({ id }) => getNode(id),
  updateNode: ({ id, patch }) => updateNode(id, patch),
  deleteNodes: ({ ids }) => deleteNodes(ids),
  storageUsage: () => usage(),
  cleanup: (msg) => cleanup(msg),
  exportData: () => exportAll(),
  importData: ({ backup }) => importAll(backup, { mutateWatch, mutateRadar, mutateAlerts, mutateProjects }),
  // Your channel (Google sign-in)
  authStatus: () => authStatus(),
  setClientId: async ({ clientId }) => {
    const { google = {} } = await chrome.storage.local.get('google');
    await chrome.storage.local.set({ google: { ...google, clientId: clientId.trim() } });
    return true;
  },
  signIn: () => signIn(),
  signOut: () => signOut(),
  myOverview: ({ days }) => overview(days),
  myTopVideos: ({ days }) => topVideos(days),
  myRetention: ({ id, publishedAt }) => retention(id, publishedAt),
  myTraffic: ({ days, id }) => trafficSources(days, id),
  myAudience: ({ days }) => audienceProfile(days),
  avatarGroups: () => listGroups(),
  avatarGroupSave: ({ group }) => saveGroup(group),
  avatarGroupDelete: ({ id }) => deleteGroup(id),
  avatarSave: ({ groupId, avatar }) => saveAvatar(groupId, avatar),
  avatarDelete: ({ groupId, avatarId }) => deleteAvatar(groupId, avatarId),
  channelComments: ({ channelId }) => channelComments(channelId),
  // Competitors & radar
  watch: ({ input, role }) => watch(input, { role }),
  following: () => following(),
  updateFollow: ({ id, patch }) => updateFollow(id, patch),
  unwatch: ({ id }) => unwatch(id),
  compare: async () => {
    const { google = {} } = await chrome.storage.local.get('google');
    return compare(google.signedIn ? google.me?.id : google.compareAs);
  },
  setCompareAs: async ({ input }) => {
    const ref = parseChannelInput(input);
    if (!ref) throw new Error('Enter your channel @handle, URL or ID.');
    const id = await resolveChannelId(ref);
    const { google = {} } = await chrome.storage.local.get('google');
    await chrome.storage.local.set({ google: { ...google, compareAs: id } });
    return id;
  },
  gapData: async () => {
    const { google = {} } = await chrome.storage.local.get('google');
    return gapData(google.signedIn ? google.me?.id : google.compareAs);
  },
  radarCheck: async () => (await radarCheck()) + (await trendCheck()),
  followKeyword: ({ keyword }) => followKeyword(keyword),
  unfollowKeyword: ({ keyword }) => unfollowKeyword(keyword),
  keywords: () => listKeywords(),
  comments: ({ id, fresh }) => videoComments(id, { fresh }),
  videoInfo: ({ id }) => videoInfo(id),
  radarRead: ({ ids }) => markRadarRead(ids),
  radarClear: () => clearRadar(),
  quota: () => getQuota(),
  clearCache: () => cache.prune({ all: true }),
  // Validates a key with a 1-unit request before it is saved.
  testKey: async ({ key }) => {
    await call('videos', { part: 'id', id: 'dQw4w9WgXcQ' }, key);
    return true;
  },
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handler = handlers[msg?.type];
  if (!handler) return false;
  handler(msg).then(
    (data) => sendResponse({ ok: true, data }),
    (err) => sendResponse({ ok: false, error: err.message, reason: err.reason ?? '' }),
  );
  return true; // keep the channel open for the async response
});
