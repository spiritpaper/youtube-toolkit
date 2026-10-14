// After publishing: tracks the videos linked to Idea-board projects. Every
// background tick for the first week (so the 48-hour and 7-day marks are
// accurate to a few hours), then daily until day 30. ~1 unit per 50 videos.

import { getVideos, getBaseline } from './youtube.js';
import { mutateProjects, listProjects } from '../lib/projects.js';
import { multiplier, classifyFormat } from '../lib/stats.js';

const HOUR = 3_600_000;
const TRACK_DAYS = 30;

export function parseVideoId(input) {
  const s = String(input ?? '').trim();
  return (/(?:v=|youtu\.be\/|shorts\/|live\/)([\w-]{11})/.exec(s) ?? /^([\w-]{11})$/.exec(s))?.[1] ?? null;
}

function snapshotFor(video, base) {
  const format = classifyFormat(video, { shortIds: new Set(base?.shortIds ?? []), longIds: new Set(base?.longIds ?? []) });
  const median = base?.[format]?.median ?? null;
  return {
    t: Date.now(),
    hours: (Date.now() - new Date(video.publishedAt).getTime()) / HOUR,
    views: video.views,
    likes: video.likes,
    comments: video.comments,
    baselineMedian: median,
    multiplier: multiplier(video.views, median),
  };
}

/** Snapshots tracked projects. `ids` limits it to some projects; `force` ignores the schedule. */
export async function trackPublished({ ids = null, force = false } = {}) {
  const projects = Object.values(await listProjects()).filter((p) => p.publishedVideoId && (!ids || ids.includes(p.id)));
  const due = projects.filter((p) => {
    const perf = p.performance;
    if (force || !perf?.history?.length) return true;
    const last = perf.history[perf.history.length - 1];
    const age = last.hours / 24;
    if (age > TRACK_DAYS) return false;
    return Date.now() - last.t >= (age < 8 ? 3.5 * HOUR : 23 * HOUR);
  });
  if (!due.length) return 0;
  const videos = await getVideos(due.map((p) => p.publishedVideoId), { fresh: true });
  const snaps = new Map();
  for (const p of due) {
    const v = videos.get(p.publishedVideoId);
    if (!v) continue;
    const base = await getBaseline(v.channelId).catch(() => null);
    snaps.set(p.id, { video: v, snap: snapshotFor(v, base) });
  }
  await mutateProjects((all) => {
    for (const [id, { video, snap }] of snaps) {
      const p = all[id];
      if (!p || p.publishedVideoId !== video.id) continue;
      const perf = p.performance?.videoId === video.id ? p.performance : { videoId: video.id, history: [], milestones: {} };
      perf.video = { id: video.id, title: video.title, thumb: video.thumb, channelId: video.channelId, channelTitle: video.channelTitle, publishedAt: video.publishedAt, durationSec: video.durationSec };
      perf.history = [...perf.history, snap].slice(-200);
      // The first snapshot taken soon after each milestone (if the video was
      // linked too late, that milestone stays unknown rather than wrong).
      if (snap.hours >= 48 && snap.hours < 72 && !perf.milestones.h48) perf.milestones.h48 = snap;
      if (snap.hours >= 168 && snap.hours < 216 && !perf.milestones.d7) perf.milestones.d7 = snap;
      p.performance = perf;
    }
  });
  return snaps.size;
}

