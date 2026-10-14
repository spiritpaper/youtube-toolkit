// Saved ideas ("swipe file"), stored as one map keyed by video id.
// Writes are serialized through `mutate`, so all of them must happen in one
// context (the background worker); extension pages only read and send messages.

let chain = Promise.resolve();
export function mutateIdeas(fn) {
  return mutate(fn);
}

function mutate(fn) {
  chain = chain.then(async () => {
    const { ideas = {} } = await chrome.storage.local.get('ideas');
    const next = fn(ideas) ?? ideas;
    await chrome.storage.local.set({ ideas: next });
    return next;
  });
  return chain;
}

export async function listIdeas() {
  const { ideas = {} } = await chrome.storage.local.get('ideas');
  return ideas;
}

const MAX_HISTORY = 400;
const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();

/**
 * Saves an idea (isSave) or records a new stats snapshot for an existing one.
 * `snap` is { video, channel, stats } from the background; channel/stats may
 * be null if the API call failed, in which case only the basics are stored.
 * Each call appends to `history` (one entry per day) so growth can be tracked.
 */
export function recordSnapshot(snap, { isSave = false } = {}) {
  return recordSnapshots([snap], { isSave });
}

// Batched so a refresh of many ideas rewrites storage once, not once per idea.
export function recordSnapshots(snaps, { isSave = false } = {}) {
  return mutate((ideas) => {
    for (const snap of snaps) applySnapshot(ideas, snap, isSave);
  });
}

function applySnapshot(ideas, snap, isSave) {
  const { video, channel = null, stats = null } = snap;
  const prev = ideas[video.id];
  if (!prev && !isSave) return; // removed while a refresh was running
  const now = Date.now();

  let history = prev?.history ?? [];
  // Ideas saved before tracking existed still know their views at save time.
  if (prev && !prev.history && Number.isFinite(prev.views)) {
    history = [{ t: prev.savedAt, views: prev.views, multiplier: prev.multiplier, baselineMedian: prev.baselineMedian }];
  }
  const entry = {
    t: now,
    views: video.views,
    likes: video.likes,
    comments: video.comments,
    subs: channel?.subs ?? null,
    baselineMedian: stats?.baselineMedian ?? video.baselineMedian ?? null,
    multiplier: stats?.multiplier ?? video.multiplier ?? null,
  };
  const last = history[history.length - 1];
  history = last && sameDay(last.t, now) && history.length > 1 ? [...history.slice(0, -1), entry] : [...history, entry];

  ideas[video.id] = {
    ...prev,
    id: video.id,
    title: video.title,
    channelId: video.channelId,
    channelTitle: video.channelTitle,
    publishedAt: video.publishedAt,
    durationSec: video.durationSec,
    thumb: video.thumb,
    format: video.format,
    views: video.views,
    likes: video.likes,
    comments: video.comments,
    multiplier: entry.multiplier,
    baselineMedian: entry.baselineMedian,
    stats: stats ?? prev?.stats ?? null,
    unavailable: false,
    savedAt: prev?.savedAt ?? now,
    updatedAt: now,
    notes: prev?.notes ?? '',
    tags: prev?.tags ?? [],
    history: history.slice(-MAX_HISTORY),
  };
}

export function markUnavailable(ids) {
  return mutate((ideas) => {
    for (const id of ids) if (ideas[id]) ideas[id] = { ...ideas[id], unavailable: true, updatedAt: Date.now() };
  });
}

export function updateIdea(id, patch) {
  return mutate((ideas) => {
    if (ideas[id]) ideas[id] = { ...ideas[id], ...patch };
  });
}

export async function removeIdea(id) {
  await mutate((ideas) => {
    delete ideas[id];
  });
  await chrome.storage.local.remove([`tx:${id}`, `hm:${id}`]);
}
