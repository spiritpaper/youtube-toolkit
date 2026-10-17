// Runs a test screening from a page: three AI calls (feed + hook, story,
// what to change), with the numbers computed here from the viewers' answers.

import { send } from '../lib/ui.js';
import { generate, feedHookPrompt, storyPrompt, screeningSummaryPrompt } from '../lib/ai.js';
import { splitMaterial, avatarBrief, expectedWatch, extractJsonArray, cleanFeed, cleanStory, aggregate, reportText } from '../lib/screening.js';

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

/** Other titles in the same feed: strong saved outliers, then recent radar finds. */
async function feedNeighbors(exclude) {
  const { ideas = {}, radar = [] } = await chrome.storage.local.get(['ideas', 'radar']);
  const titles = [
    ...Object.values(ideas).sort((a, b) => (b.stats?.multiplier ?? b.multiplier ?? 0) - (a.stats?.multiplier ?? a.multiplier ?? 0)).map((i) => i.title),
    ...radar.map((r) => r.title),
  ].filter((t) => t && t !== exclude);
  // A varied handful, not always the same top five.
  return [...new Set(titles)].slice(0, 12).sort(() => Math.random() - 0.5).slice(0, 5);
}

/**
 * project: { id, title, outline, script, titles }; group: an avatar group;
 * title: the title to test. principles: optional story-principle names for
 * the fixes. onProgress(text). Returns the saved screening.
 */
export async function runScreening({ ai, project, group, title, principles = [], onProgress = () => {} }) {
  const avatars = group.avatars;
  if (!avatars.length) throw new Error('This audience group has no avatars yet.');
  const material = splitMaterial({ script: project.script, outline: project.outline });
  onProgress('Checking your channel\'s real averages…');
  const [baseline, neighbors] = await Promise.all([channelBaseline(), feedNeighbors(title)]);
  const brief = Object.fromEntries(avatars.map((a) => [a.id, avatarBrief(a)]));
  // The story stage also gets each viewer's typical watch time, as an anchor.
  const anchored = (a) => `${brief[a.id]} Typically watches about ${expectedWatch(a, baseline)}% of a video like this.`;

  onProgress(`The feed: ${avatars.length} viewers see "${title}"${material.hook ? ', and the clickers watch the opening' : ''}…`);
  const one = feedHookPrompt({ avatars: avatars.map((a) => brief[a.id]), title, hook: material.hook?.text ?? '', neighbors, baseline, niche: ai.niche });
  const feed = cleanFeed(extractJsonArray(await generate({ ...ai, ...one })), avatars);

  const watching = avatars.filter((a) => feed[a.id] && feed[a.id].click !== 'no' && (material.hook ? feed[a.id].stay === true : true));
  let story = {};
  if (watching.length && material.beats.length) {
    onProgress(`The story: ${watching.length} viewer${watching.length === 1 ? '' : 's'} watch the rest, beat by beat…`);
    const two = storyPrompt({ avatars: watching.map(anchored), title, beats: material.beats, baseline, niche: ai.niche, outline: !!material.outline });
    story = cleanStory(extractJsonArray(await generate({ ...ai, ...two })), watching, material.beats.length);
  }

  const result = aggregate(avatars, feed, story, material.beats.length);
  const report = reportText({ avatars, feed, story, result, material });
  onProgress('Turning their reactions into what to change…');
  const three = screeningSummaryPrompt({ title, report, niche: ai.niche, principles });
  const summary = await generate({ ...ai, ...three });

  return send({
    type: 'screeningSave',
    sim: {
      projectId: project.id,
      projectTitle: project.title,
      groupId: group.id,
      groupName: group.name,
      title,
      avatars, // as they were, so later edits don't change the record
      material: { hook: material.hook, beats: material.beats, duration: material.duration ?? null, outline: !!material.outline },
      baseline,
      neighbors,
      feed,
      story,
      result,
      report,
      summary: { text: summary, provider: ai.provider, model: ai.model },
    },
  });
}
