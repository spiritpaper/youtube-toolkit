// Packs your own analytics into a compact, exact data sheet for the AI
// channel review, so every claim in the review can point at a real number,
// a real video and a real moment.

import { retentionSummary, formatTime, median } from './stats.js';

const TRAFFIC = {
  YT_SEARCH: 'YouTube search', SUGGESTED: 'Suggested videos', BROWSE: 'Browse features', EXT_URL: 'External',
  NO_LINK_OTHER: 'Direct / unknown', PLAYLIST: 'Playlists', YT_CHANNEL: 'Channel pages', NOTIFICATION: 'Notifications',
  SUBSCRIBER: 'Subscriptions', SHORTS: 'Shorts feed', END_SCREEN: 'End screens', ANNOTATION: 'Cards & annotations',
  YT_OTHER_PAGE: 'Other YouTube pages', ADVERTISING: 'Ads', HASHTAGS: 'Hashtags', RELATED_VIDEO: 'Related video',
};

const num = (x) => (x == null || !Number.isFinite(Number(x)) ? 'n/a' : Math.round(Number(x)).toLocaleString('en-US'));
const pct = (x, d = 1) => (x == null || !Number.isFinite(x) ? 'n/a' : `${(x * 100).toFixed(d)}%`);
const change = (cur, prev) => (cur == null || !prev ? '' : ` (${cur >= prev ? '+' : ''}${(((cur - prev) / prev) * 100).toFixed(0)}% vs previous period)`);
const mult = (x) => (x == null || !Number.isFinite(x) ? 'n/a' : `${x.toFixed(1)}x`);

/** What was said around `sec` in a saved transcript, if there is one. */
export function lineAt(segments, sec) {
  if (!segments?.length || sec == null) return null;
  let best = segments[0];
  for (const s of segments) if (s.start <= sec) best = s;
  const i = segments.indexOf(best);
  return segments
    .slice(Math.max(0, i - 1), i + 2)
    .map((s) => s.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .slice(0, 260);
}

/**
 * The data sheet. Inputs are what the My channel page already loads:
 * ov (overview), top (top videos), pub (public info + outlier score by id),
 * traffic (channel traffic sources), curves (retention by id), transcripts
 * (segments by id), profile (your channel profile), peers (followed
 * channels' profiles). Returns { text, stats } where `stats` is a short
 * summary kept with the saved review.
 */
export function reviewData({ me, days, ov, top = [], pub = {}, traffic = [], curves = {}, transcripts = {}, profile = null, peers = [] }) {
  const c = ov?.current ?? {};
  const p = ov?.previous ?? {};
  const net = (o) => (o.subscribersGained ?? 0) - (o.subscribersLost ?? 0);
  const lines = [];
  lines.push(`# Channel: ${me?.title ?? 'my channel'}`);
  lines.push(`Period: last ${days} days (${ov?.startDate ?? '?'} to ${ov?.endDate ?? '?'}), compared with the ${days} days before. YouTube Analytics data, not estimates.`);
  lines.push('');
  lines.push('## Totals');
  lines.push(`- Views: ${num(c.views)}${change(c.views, p.views)}`);
  lines.push(`- Watch time: ${num((c.estimatedMinutesWatched ?? 0) / 60)} hours${change(c.estimatedMinutesWatched, p.estimatedMinutesWatched)}`);
  lines.push(`- Average view duration: ${c.averageViewDuration == null ? 'n/a' : formatTime(c.averageViewDuration)}${change(c.averageViewDuration, p.averageViewDuration)}`);
  lines.push(`- Average % viewed: ${c.averageViewPercentage == null ? 'n/a' : `${Number(c.averageViewPercentage).toFixed(1)}%`}${change(c.averageViewPercentage, p.averageViewPercentage)}`);
  lines.push(`- Subscribers: +${num(c.subscribersGained)} / -${num(c.subscribersLost)} (net ${num(net(c))}; previous period net ${num(net(p))})`);
  lines.push(`- Likes ${num(c.likes)}, comments ${num(c.comments)}, shares ${num(c.shares)}`);
  if (ov?.daily?.length >= 7) {
    const half = Math.floor(ov.daily.length / 2);
    const avg = (rows) => rows.reduce((s, r) => s + (r.views ?? 0), 0) / rows.length;
    lines.push(`- Daily views: first half of the period averaged ${num(avg(ov.daily.slice(0, half)))}/day, second half ${num(avg(ov.daily.slice(half)))}/day`);
  }

  if (profile) {
    lines.push('');
    lines.push('## Channel profile (public data, last ~30 uploads)');
    lines.push(`- Subscribers ${num(profile.subs)}, median views per long-form video ${num(profile.medianLong)}, per Short ${num(profile.medianShort)}`);
    lines.push(`- Uploads per week: ${profile.uploadsPerWeek?.toFixed(1) ?? 'n/a'} long-form, ${profile.shortsPerWeek?.toFixed(1) ?? 'n/a'} Shorts`);
    lines.push(`- Hit rate: ${pct(profile.hitRate, 0)} of recent long-form videos reached 2x+ the channel's own median`);
    lines.push(`- Trend: ${profile.trend ?? 'n/a'}${profile.momentum ? ` (median views of the last ~10 uploads are ${mult(profile.momentum)} the median of the uploads before them)` : ''}`);
    lines.push(`- Median like rate ${pct(profile.likeRate, 2)}, views per subscriber ${pct(profile.viewsPerSub, 0)}`);
  }
  const others = peers.filter((x) => !x.error && x.medianLong);
  if (others.length) {
    lines.push('');
    lines.push('## Channels I follow (for comparison)');
    for (const o of others.slice(0, 8)) {
      lines.push(`- ${o.title}: ${num(o.subs)} subs, median ${num(o.medianLong)} views, ${o.uploadsPerWeek?.toFixed(1) ?? 'n/a'} uploads/week, hit rate ${pct(o.hitRate, 0)}, trend ${o.trend ?? 'n/a'}`);
    }
    lines.push(`- Peer medians: ${num(median(others.map((o) => o.medianLong)))} views per video, ${median(others.map((o) => o.uploadsPerWeek).filter((x) => x != null))?.toFixed(1) ?? 'n/a'} uploads/week`);
  }

  if (traffic.length) {
    const total = traffic.reduce((s, t) => s + (t.views ?? 0), 0) || 1;
    lines.push('');
    lines.push('## Where views came from (channel)');
    for (const t of traffic.slice(0, 8)) lines.push(`- ${TRAFFIC[t.insightTrafficSourceType] ?? t.insightTrafficSourceType}: ${pct(t.views / total, 0)} of views`);
  }

  const hasCtr = top.some((r) => r.videoThumbnailImpressionsClickRate != null);
  lines.push('');
  lines.push(`## Videos with the most views in the period (${top.length})`);
  if (!hasCtr) lines.push('(Impressions and click-through rate are not available from the API for this channel, so do not judge CTR.)');
  const avgPct = median(top.map((r) => r.averageViewPercentage).filter((x) => x != null));
  for (const [i, r] of top.slice(0, 25).entries()) {
    const v = pub[r.video] ?? {};
    const bits = [
      `${num(r.views)} views in period`,
      v.views != null && `${num(v.views)} lifetime`,
      v.multiplier != null && `outlier score ${mult(v.multiplier)} of my median`,
      v.durationSec && `length ${formatTime(v.durationSec)}`,
      v.format === 'short' && 'Short',
      r.averageViewPercentage != null && `avg ${Number(r.averageViewPercentage).toFixed(1)}% viewed`,
      r.averageViewDuration != null && `avg duration ${formatTime(r.averageViewDuration)}`,
      r.subscribersGained != null && `+${num(r.subscribersGained)} subs`,
      r.videoThumbnailImpressions != null && `${num(r.videoThumbnailImpressions)} impressions`,
      r.videoThumbnailImpressionsClickRate != null && `CTR ${Number(r.videoThumbnailImpressionsClickRate).toFixed(1)}%`,
      v.publishedAt && `published ${String(v.publishedAt).slice(0, 10)}`,
    ].filter(Boolean);
    lines.push(`${i + 1}. "${v.title ?? r.video}" [${r.video}]: ${bits.join(', ')}`);
  }
  if (avgPct != null) lines.push(`(Median avg % viewed across these videos: ${avgPct.toFixed(1)}%)`);

  const withCurves = Object.entries(curves).filter(([, pts]) => pts?.length);
  if (withCurves.length) {
    lines.push('');
    lines.push('## Retention (audience still watching, from my analytics)');
    for (const [id, pts] of withCurves) {
      const v = pub[id] ?? {};
      const s = retentionSummary(pts);
      if (!s) continue;
      const dur = v.durationSec;
      const when = (ratio) => (dur ? formatTime(ratio * dur) : `${Math.round(ratio * 100)}% through`);
      const out = [`### "${v.title ?? id}"${dur ? ` (${formatTime(dur)})` : ''}`];
      out.push(`- Still watching: ${pct(s.at10, 0)} at 10%, ${pct(s.at50, 0)} at the halfway point, ${pct(s.at90, 0)} at 90%`);
      const intro = pts.find((x) => x.ratio >= 0.05) ?? pts[0];
      out.push(`- Opening: ${pct(intro?.watch, 0)} still watching at ${when(intro?.ratio ?? 0.05)}`);
      if (s.steepestDrop) {
        const said = lineAt(transcripts[id], dur ? s.steepestDrop.ratio * dur : null);
        out.push(`- Steepest drop after the intro: -${pct(s.steepestDrop.drop, 1)} of viewers at ${when(s.steepestDrop.ratio)}${said ? `. Said there: "${said}"` : ''}`);
      }
      if (s.rewatchMoments.length) out.push(`- Rewatched (bumps in the curve) at: ${s.rewatchMoments.slice(0, 4).map(when).join(', ')}`);
      if (s.relative != null) out.push(`- Retention vs YouTube videos of similar length: ${s.relative.toFixed(2)} (0.5 = typical, 1.0 = best)`);
      if (!transcripts[id]) out.push('- (No transcript saved, so the words at these moments are unknown.)');
      lines.push(...out);
    }
  }

  return {
    text: lines.join('\n'),
    stats: {
      days,
      views: c.views ?? null,
      avgPct: c.averageViewPercentage ?? null,
      netSubs: net(c),
      videos: top.length,
      retention: withCurves.length,
      ctr: hasCtr,
    },
  };
}
