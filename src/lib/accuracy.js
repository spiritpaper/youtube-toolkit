// Forecast vs reality for test screenings, and the calibration that makes
// the next screenings better. Pure functions; the pages fetch the data.
//
// A checked screening carries:
//   actual:   what really happened (from YouTube Analytics when signed in)
//   accuracy: how far the forecast was from it
// Calibration is learned from every checked screening of an audience group.

const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);

/** Share still watching at a point (0–1 of the video) on a real retention curve. */
function watchAt(points, ratio) {
  if (!points?.length) return null;
  let best = points[0];
  for (const p of points) if (Math.abs(p.ratio - ratio) < Math.abs(best.ratio - ratio)) best = p;
  return Math.min(1, Math.max(0, best.watch)); // rewatches can push it above 1
}

/** Where the real curve drops most (after the first 5%): { ratio, drop }. */
function steepestDrop(points) {
  let best = null;
  for (let i = 1; i < (points?.length ?? 0); i++) {
    if (points[i].ratio < 0.05) continue;
    const drop = points[i - 1].watch - points[i].watch;
    if (!best || drop > best.drop) best = { ratio: points[i].ratio, drop };
  }
  return best;
}

/**
 * What really happened, from Analytics: totals ({ averageViewPercentage,
 * videoThumbnailImpressionsClickRate, views, likes, … }), the retention
 * curve, and the real video length.
 */
export function actualFromAnalytics({ totals = {}, retention = [], durationSec = null, views = null, multiplier = null }) {
  const len = durationSec || null;
  return {
    at: Date.now(),
    views: totals.views ?? views ?? null,
    multiplier,
    avgViewed: totals.averageViewPercentage ?? null, // percent
    ctr: totals.videoThumbnailImpressionsClickRate ?? null, // percent
    impressions: totals.videoThumbnailImpressions ?? null,
    likeRate: totals.views ? (totals.likes ?? 0) / totals.views : null,
    hold30: len && retention.length ? watchAt(retention, Math.min(1, 30 / len)) : null,
    durationSec: len,
    retention: retention.map((p) => ({ ratio: p.ratio, watch: p.watch })),
    drop: steepestDrop(retention),
  };
}

/**
 * Compares a screening (sim) with what happened. Errors are forecast minus
 * real, in percentage points (positive = the screening was too optimistic).
 */
export function compareScreening(sim, actual) {
  const r = sim.result;
  const beats = sim.material?.beats ?? [];
  const total = sim.material?.duration || (beats.length ? beats.at(-1).start + 60 : null);
  const out = {
    watchErr: r.watchedShare != null && actual.avgViewed != null ? r1(r.watchedShare * 100 - actual.avgViewed) : null,
    hookErr: r.hookHold != null && actual.hold30 != null ? r1(r.hookHold * 100 - actual.hold30 * 100) : null,
    ctrRatio: r.clickShare > 0 && actual.ctr != null ? actual.ctr / 100 / r.clickShare : null,
    curve: [],
    curveErr: null,
    dropMatch: null,
  };
  // The predicted still-watching curve against the real one, at the same point in the video.
  if (total && actual.retention?.length && beats.every((b) => b.start != null)) {
    for (const c of r.curve) {
      const at = Math.min(1, beats[c.i].start / total);
      const real = watchAt(actual.retention, at);
      // Predicted "watching" is among clickers; the real curve too (among viewers).
      if (real != null) out.curve.push({ i: c.i, at, predicted: c.watching, real });
    }
    if (out.curve.length) out.curveErr = r1((out.curve.reduce((n, p) => n + Math.abs(p.predicted - p.real), 0) / out.curve.length) * 100);
    // Did the screening's biggest drop-off land near the real one (within ~10% of the video)?
    const top = r.leaves?.[0];
    if (top && actual.drop) out.dropMatch = Math.abs(beats[top.i].start / total - actual.drop.ratio) <= 0.1;
  }
  const errs = [out.watchErr, out.hookErr, out.curveErr].filter((x) => x != null).map(Math.abs);
  out.meanErr = errs.length ? r1(errs.reduce((a, b) => a + b, 0) / errs.length) : null;
  out.verdict = out.meanErr == null ? null : out.meanErr <= 8 ? 'close' : out.meanErr <= 18 ? 'fair' : 'off';
  return out;
}

const median = (xs) => {
  const v = xs.filter((x) => x != null && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};

/**
 * What past checked screenings teach about an audience: average misses on
 * watch time and the opening (points), and how "would click" maps to real
 * click-through. `sims`: checked screenings, newest first; the last 10 count.
 */
export function calibration(sims) {
  const recent = sims.filter((s) => s.accuracy).slice(0, 10);
  const avg = (k) => {
    const v = recent.map((s) => s.accuracy[k]).filter((x) => x != null);
    return v.length ? { value: r1(v.reduce((a, b) => a + b, 0) / v.length), n: v.length } : null;
  };
  const ratios = recent.map((s) => s.accuracy.ctrRatio).filter((x) => x != null && x > 0);
  return {
    n: recent.length,
    watch: avg('watchErr'), // + means screenings predict too much watch time
    hook: avg('hookErr'),
    ctrRatio: ratios.length ? { value: median(ratios), n: ratios.length } : null,
    // Older first, to show whether forecasts are getting closer.
    history: [...recent].reverse().map((s) => ({ at: s.actual?.at ?? s.at, meanErr: s.accuracy.meanErr, title: s.projectTitle })),
  };
}

/** The screening's numbers corrected by what past screenings got wrong. */
export function calibrated(result, cal) {
  if (!cal?.n) return null;
  const clampPct = (x) => Math.min(1, Math.max(0, x));
  return {
    ctr: cal.ctrRatio && result.clickShare > 0 ? result.clickShare * cal.ctrRatio.value * 100 : null, // percent
    watched: cal.watch && result.watchedShare != null ? clampPct(result.watchedShare - cal.watch.value / 100) : null,
    hookHold: cal.hook && result.hookHold != null ? clampPct(result.hookHold - cal.hook.value / 100) : null,
    n: cal.n,
  };
}

/**
 * A line for one stage's prompt, so the simulated viewers lean the right
 * way. Only the correction for that stage: the opening for "feed" (never
 * the click decision itself), watch time for "story".
 */
export function calibrationLine(cal, stage) {
  if (!cal?.n) return '';
  const from = `Calibration from ${cal.n} published video${cal.n === 1 ? '' : 's'} with this audience`;
  if (stage === 'feed' && cal.hook && Math.abs(cal.hook.value) >= 3) {
    return `${from}: past screenings had ${Math.abs(cal.hook.value)} points ${cal.hook.value > 0 ? 'more' : 'fewer'} viewers staying past the opening than really did, so for the opening, expect ${cal.hook.value > 0 ? 'more' : 'fewer'} of the clickers to leave. (This is about the opening only, not about who clicks.)`;
  }
  if (stage === 'story' && cal.watch && Math.abs(cal.watch.value) >= 3) {
    return `${from}: past screenings predicted ${Math.abs(cal.watch.value)} points ${cal.watch.value > 0 ? 'more' : 'less'} watch time than real viewers gave, so expect viewers to leave ${cal.watch.value > 0 ? 'earlier' : 'later'} than your first instinct.`;
  }
  return '';
}

/** Shift (in points) to apply to each viewer's expected watch time. */
export const watchShift = (cal) => (cal?.watch ? Math.max(-25, Math.min(25, -cal.watch.value)) : 0);

const pts = (x) => (x == null ? 'n/a' : `${Math.round(x * 100)}%`);

/** Forecast vs reality as text (for the notes prompt and copying). */
export function comparisonText(sim, actual, acc) {
  const r = sim.result;
  const lines = [
    `Watch on average: forecast ${pts(r.watchedShare)}, real ${actual.avgViewed == null ? 'n/a (not signed in)' : `${Math.round(actual.avgViewed)}%`}${acc.watchErr != null ? ` (${acc.watchErr > 0 ? '+' : ''}${acc.watchErr} pts)` : ''}`,
    `Still watching at 0:30: forecast ${pts(r.hookHold)}, real ${pts(actual.hold30)}${acc.hookErr != null ? ` (${acc.hookErr > 0 ? '+' : ''}${acc.hookErr} pts)` : ''}`,
    `Would click: forecast ${pts(r.clickShare)} of this audience; real click-through ${actual.ctr == null ? 'n/a' : `${actual.ctr.toFixed(1)}% of impressions`}`,
    acc.curve.length && `Still watching through the video (forecast → real): ${acc.curve.map((p) => `${Math.round(p.at * 100)}%: ${pts(p.predicted)} → ${pts(p.real)}`).join(', ')}`,
    actual.drop && `Real steepest drop: ${Math.round(actual.drop.ratio * 100)}% into the video${acc.dropMatch != null ? ` (the screening's biggest drop-off ${acc.dropMatch ? 'was close to it' : 'was elsewhere'})` : ''}`,
    actual.views != null && `Views so far: ${Math.round(actual.views).toLocaleString('en-US')}${actual.multiplier != null ? ` (${actual.multiplier.toFixed(1)}x the channel median)` : ''}`,
  ];
  return lines.filter(Boolean).join('\n');
}
