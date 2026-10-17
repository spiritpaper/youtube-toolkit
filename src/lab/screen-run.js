// Runs test screenings from a page. A full screening is three AI calls per
// run (feed + hook, story, then one for what to change); a title test is one.
// The numbers are computed here from the viewers' answers.

import { send } from '../lib/ui.js';
import { generate, feedHookPrompt, storyPrompt, screeningSummaryPrompt, titleTestPrompt, thumbnailImage } from '../lib/ai.js';
import { calibration as learnCalibration, calibrated, calibrationLine, watchShift } from '../lib/accuracy.js';
import { splitMaterial, avatarBrief, expectedWatch, extractJsonArray, cleanFeed, cleanStory, aggregate, reportText, combineResults, cleanTitleVotes, scoreTitles, LETTERS } from '../lib/screening.js';

/** The channel's real averages, to keep the simulated viewers honest (null if not signed in). */
async function channelBaseline() {
  const auth = await send({ type: 'authStatus' }).catch(() => ({}));
  if (!auth.signedIn) return null;
  const [ov, top, aud] = await Promise.all([
    send({ type: 'myOverview', days: 90 }).catch(() => null),
    send({ type: 'myTopVideos', days: 90 }).catch(() => []),
    send({ type: 'myAudience', days: 90 }).catch(() => null),
  ]);
  const sub = (status) => aud?.subscribed?.find((r) => r.subscribedStatus === status)?.averageViewPercentage ?? null;
  const withCtr = top.filter((r) => r.videoThumbnailImpressions && r.videoThumbnailImpressionsClickRate != null);
  const impressions = withCtr.reduce((n, r) => n + r.videoThumbnailImpressions, 0);
  return {
    avgViewed: ov?.current?.averageViewPercentage ?? null,
    bySub: { subscribed: sub('SUBSCRIBED'), unsubscribed: sub('UNSUBSCRIBED') },
    ctr: impressions ? withCtr.reduce((n, r) => n + r.videoThumbnailImpressionsClickRate * r.videoThumbnailImpressions, 0) / impressions : null,
  };
}

/** Other videos in the same feed: strong saved outliers, then recent radar finds. [{ id, title }] */
async function feedNeighbors(exclude) {
  const { ideas = {}, radar = [] } = await chrome.storage.local.get(['ideas', 'radar']);
  const list = [
    ...Object.values(ideas).sort((a, b) => (b.stats?.multiplier ?? b.multiplier ?? 0) - (a.stats?.multiplier ?? a.multiplier ?? 0)),
    ...radar,
  ].filter((v) => v.title && v.title !== exclude);
  const seen = new Set();
  const unique = list.filter((v) => !seen.has(v.title) && seen.add(v.title));
  // A varied handful, not always the same top five.
  return unique.slice(0, 12).sort(() => Math.random() - 0.5).slice(0, 5).map((v) => ({ id: v.id ?? null, title: v.title }));
}

/** The project's thumbnail: the uploaded one, else the published video's. */
export async function projectThumbnail(project) {
  const { [`th:${project.id}`]: mine } = await chrome.storage.local.get(`th:${project.id}`);
  if (mine) return { mime: /^data:([^;]+)/.exec(mine)?.[1] ?? 'image/jpeg', data: mine.split(',')[1] };
  const vid = project.performance?.videoId ?? project.publishedVideoId;
  return vid ? thumbnailImage(vid) : null;
}

/** Thumbnails for the feed: the tested video's first, then up to three neighbors'. */
async function feedImages(project, neighbors) {
  const own = await projectThumbnail(project);
  if (!own) throw new Error('This project has no thumbnail yet: upload one in its Thumbnail section, or run without it.');
  const others = [];
  for (const n of neighbors.slice(0, 3)) {
    if (!n.id) break; // images must line up with the first neighbors
    const img = await thumbnailImage(n.id);
    if (!img) break;
    others.push(img);
  }
  return { images: [own, ...others], tags: { tested: true, neighbors: others.length } };
}

/** One run of the feed, hook and story stages. */
/** What this audience's past screenings taught (checked against published videos). */
export async function groupCalibration(groupId) {
  const sims = await send({ type: 'screenings' }).catch(() => []);
  return learnCalibration(sims.filter((s) => s.groupId === groupId && s.accuracy));
}

async function runPass({ ai, avatars, brief, anchored, title, material, neighbors, baseline, images, cal, onProgress, label }) {
  onProgress(`${label}The feed: ${avatars.length} viewers see "${title}"${material.hook ? ', and the clickers watch the opening' : ''}…`);
  const one = feedHookPrompt({ avatars: avatars.map((a) => brief[a.id]), title, hook: material.hook?.text ?? '', neighbors: neighbors.map((n) => n.title), baseline, niche: ai.niche, images: images?.tags ?? null, calibration: calibrationLine(cal, 'feed') });
  const feed = cleanFeed(extractJsonArray(await generate({ ...ai, ...one, images: images?.images ?? [] })), avatars);
  const watching = avatars.filter((a) => feed[a.id] && feed[a.id].click !== 'no' && (material.hook ? feed[a.id].stay === true : true));
  let story = {};
  if (watching.length && material.beats.length) {
    onProgress(`${label}The story: ${watching.length} viewer${watching.length === 1 ? '' : 's'} watch the rest, beat by beat…`);
    const two = storyPrompt({ avatars: watching.map(anchored), title, beats: material.beats, baseline, niche: ai.niche, outline: !!material.outline, calibration: calibrationLine(cal, 'story') });
    story = cleanStory(extractJsonArray(await generate({ ...ai, ...two })), watching, material.beats.length);
  }
  return { feed, story, result: aggregate(avatars, feed, story, material.beats.length) };
}

/**
 * A full screening. project: { id, title, outline, script, titles }; group:
 * an avatar group; title: the title to test. thumbnail: include the
 * thumbnail in the feed (an image call). passes: 1, or 2 to run twice and
 * combine. principles: optional story-principle names for the fixes.
 * onProgress(text). Returns the saved screening.
 */
export async function runScreening({ ai, project, group, title, thumbnail = false, passes = 1, principles = [], onProgress = () => {} }) {
  const avatars = group.avatars;
  if (!avatars.length) throw new Error('This audience group has no avatars yet.');
  const material = splitMaterial({ script: project.script, outline: project.outline });
  onProgress('Checking your channel\'s real averages…');
  const [baseline, neighbors, cal] = await Promise.all([channelBaseline(), feedNeighbors(title), groupCalibration(group.id)]);
  const images = thumbnail ? (onProgress('Loading the thumbnails for the feed…'), await feedImages(project, neighbors)) : null;
  const brief = Object.fromEntries(avatars.map((a) => [a.id, avatarBrief(a)]));
  // The story stage also gets each viewer's typical watch time, as an anchor.
  // Past misses shift it (e.g. this audience really watches 10 points less than screenings predicted).
  const shift = watchShift(cal);
  const anchored = (a) => `${brief[a.id]} Typically watches about ${Math.min(90, Math.max(5, expectedWatch(a, baseline) + shift))}% of a video like this.`;

  const runs = [];
  for (let p = 0; p < passes; p++) {
    runs.push(await runPass({ ai, avatars, brief, anchored, title, material, neighbors, baseline, images, cal, onProgress, label: passes > 1 ? `Run ${p + 1} of ${passes}. ` : '' }));
  }
  const result = combineResults(runs.map((r) => r.result));
  const reports = runs.map((r, i) => `${passes > 1 ? `RUN ${i + 1}\n` : ''}${reportText({ avatars, feed: r.feed, story: r.story, result: r.result, material })}`);
  const report = reports.join('\n\n');
  onProgress('Turning their reactions into what to change…');
  const three = screeningSummaryPrompt({ title, report, niche: ai.niche, principles });
  const summary = await generate({ ...ai, ...three });

  return send({
    type: 'screeningSave',
    sim: {
      kind: 'screening',
      projectId: project.id,
      projectTitle: project.title,
      groupId: group.id,
      groupName: group.name,
      title,
      thumbnail: !!images,
      avatars, // as they were, so later edits don't change the record
      material: { hook: material.hook, beats: material.beats, duration: material.duration ?? null, outline: !!material.outline },
      baseline,
      neighbors: neighbors.map((n) => n.title),
      feed: runs[0].feed,
      story: runs[0].story,
      runs: passes > 1 ? runs.map((r) => ({ feed: r.feed, story: r.story, result: r.result })) : undefined,
      result,
      calibration: cal.n ? cal : null,
      calibrated: calibrated(result, cal),
      report,
      summary: { text: summary, provider: ai.provider, model: ai.model },
    },
  });
}

/**
 * Title A/B: every viewer judges each title (in a random order). One AI call,
 * plus the thumbnail if asked. Returns the saved test.
 */
export async function runTitleTest({ ai, project, group, titles, thumbnail = false, onProgress = () => {} }) {
  const avatars = group.avatars;
  if (!avatars.length) throw new Error('This audience group has no avatars yet.');
  const list = [...new Set(titles.map((t) => t.trim()).filter(Boolean))].slice(0, LETTERS.length);
  if (list.length < 2) throw new Error('Add at least two title options to compare (in the project\'s Titles section).');
  const order = [...list].sort(() => Math.random() - 0.5); // no title always goes first
  onProgress('Checking your channel\'s real averages…');
  const [baseline, neighbors] = await Promise.all([channelBaseline(), feedNeighbors(null)]);
  const thumb = thumbnail ? await projectThumbnail(project) : null;
  if (thumbnail && !thumb) throw new Error('This project has no thumbnail yet: upload one in its Thumbnail section, or compare without it.');
  onProgress(`${avatars.length} viewers judge ${order.length} titles…`);
  const p = titleTestPrompt({ avatars: avatars.map(avatarBrief), titles: order, neighbors: neighbors.map((n) => n.title), baseline, niche: ai.niche, thumbnail: !!thumb });
  const votes = cleanTitleVotes(extractJsonArray(await generate({ ...ai, ...p, images: thumb ? [thumb] : [] })), avatars, order.length);
  const scored = scoreTitles(avatars, votes, order);
  return send({
    type: 'screeningSave',
    sim: {
      kind: 'titles',
      projectId: project.id,
      projectTitle: project.title,
      groupId: group.id,
      groupName: group.name,
      title: `${order.length} titles`,
      thumbnail: !!thumb,
      avatars,
      baseline,
      titles: order,
      votes,
      scored,
      summary: { provider: ai.provider, model: ai.model },
    },
  });
}
