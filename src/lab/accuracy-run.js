// Checks a test screening against what the published video really did.

import { send } from '../lib/ui.js';
import { generate, accuracyNotesPrompt } from '../lib/ai.js';
import { actualFromAnalytics, compareScreening, comparisonText } from '../lib/accuracy.js';

/** The video a project was published as, and when. */
export function publishedVideo(project) {
  const perf = project.performance;
  const id = perf?.videoId ?? project.publishedVideoId ?? null;
  if (!id) return null;
  const last = perf?.history?.at(-1);
  return { id, publishedAt: perf?.video?.publishedAt ?? null, durationSec: perf?.video?.durationSec ?? null, views: last?.views ?? null, multiplier: last?.multiplier ?? null };
}

/**
 * Fetches the real numbers (Analytics when signed in), compares, optionally
 * asks the AI to explain the differences (reads real comments: 1 API unit),
 * and saves the result on the screening. Returns the updated screening.
 */
export async function checkScreening({ sim, project, ai = null, explain = false, onProgress = () => {} }) {
  const video = publishedVideo(project);
  if (!video) throw new Error('Link the published video in After publishing first.');
  const auth = await send({ type: 'authStatus' }).catch(() => ({}));
  let totals = {};
  let retention = [];
  if (auth.signedIn) {
    onProgress('Reading the video\'s real numbers from YouTube Analytics…');
    [totals, retention] = await Promise.all([
      send({ type: 'myVideoTotals', id: video.id, publishedAt: video.publishedAt }).catch(() => ({})),
      send({ type: 'myRetention', id: video.id, publishedAt: video.publishedAt }).catch(() => []),
    ]);
  }
  const actual = actualFromAnalytics({ totals, retention, durationSec: video.durationSec, views: video.views, multiplier: video.multiplier });
  actual.signedIn = !!auth.signedIn;
  const accuracy = compareScreening(sim, actual);
  let notes = sim.accuracyNotes ?? null;
  if (explain && ai) {
    onProgress('Reading the real comments…');
    const comments = (await send({ type: 'comments', id: video.id }).catch(() => null))?.comments ?? [];
    onProgress('Comparing the forecast with what happened…');
    const p = accuracyNotesPrompt({ title: sim.title, report: sim.report, comparison: comparisonText(sim, actual, accuracy), comments, niche: ai.niche });
    notes = { text: await generate({ ...ai, ...p }), provider: ai.provider, model: ai.model, at: Date.now() };
  }
  return send({ type: 'screeningSave', sim: { ...sim, actual, accuracy, accuracyNotes: notes } });
}
