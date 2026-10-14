// Pure helpers shared by the background worker, extension pages and tests.

export const DAY_MS = 86_400_000;

// Videos younger than this haven't accumulated their views yet, so they would
// drag the channel baseline down. They are excluded when enough others exist.
export const MIN_BASELINE_AGE_DAYS = 3;
export const BASELINE_SAMPLE = 30;

// YouTube Shorts can be up to 3 minutes long.
export const SHORTS_MAX_SECONDS = 180;

export function median(nums) {
  const xs = nums.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!xs.length) return null;
  const mid = xs.length >> 1;
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

export function mean(nums) {
  const xs = nums.filter((n) => Number.isFinite(n));
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

// ISO 8601 duration ("PT1H2M3S", "P1DT2H") -> seconds.
export function parseDuration(iso) {
  if (!iso) return 0;
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(iso);
  if (!m) return 0;
  const [, d = 0, h = 0, min = 0, s = 0] = m;
  return Math.round(+d * 86400 + +h * 3600 + +min * 60 + +s);
}

export function ageDays(publishedAt, now = Date.now()) {
  return Math.max((now - new Date(publishedAt).getTime()) / DAY_MS, 0);
}

/**
 * Baseline for one format (long-form or Shorts): median/mean views of the most
 * recent BASELINE_SAMPLE videos that are at least MIN_BASELINE_AGE_DAYS old.
 * Falls back to including young videos when there are too few mature ones.
 */
export function computeBaseline(videos, now = Date.now()) {
  const usable = videos
    .filter((v) => Number.isFinite(v.views) && v.liveBroadcastContent !== 'upcoming')
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  let pool = usable.filter((v) => ageDays(v.publishedAt, now) >= MIN_BASELINE_AGE_DAYS);
  if (pool.length < 5) pool = usable;
  pool = pool.slice(0, BASELINE_SAMPLE);
  if (!pool.length) return null;
  const views = pool.map((v) => v.views);
  return { median: median(views), mean: mean(views), sample: pool.length };
}

export function multiplier(views, baselineMedian) {
  if (!Number.isFinite(views) || !baselineMedian) return null;
  return views / baselineMedian;
}

// Long-form uploads per week across the span of the given videos.
export function uploadsPerWeek(videos, now = Date.now()) {
  if (videos.length < 2) return null;
  const times = videos.map((v) => new Date(v.publishedAt).getTime());
  const spanDays = (now - Math.min(...times)) / DAY_MS;
  return spanDays > 0 ? (videos.length / spanDays) * 7 : null;
}

export function classifyFormat(video, { shortIds, longIds }) {
  if (shortIds?.has(video.id)) return 'short';
  if (longIds?.has(video.id)) return 'long';
  return video.durationSec > 0 && video.durationSec <= SHORTS_MAX_SECONDS ? 'short' : 'long';
}

export function toCsv(rows, columns) {
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.map((c) => esc(c.label)), ...rows.map((r) => columns.map((c) => esc(c.get(r))))]
    .map((line) => line.join(','))
    .join('\r\n');
}

// Share (0–100) of `others` with fewer views; ties count half.
export function percentileRank(value, others) {
  const xs = others.filter((n) => Number.isFinite(n));
  if (!xs.length || !Number.isFinite(value)) return null;
  const below = xs.filter((x) => x < value).length;
  const equal = xs.filter((x) => x === value).length;
  return ((below + equal / 2) / xs.length) * 100;
}

// Ordinary least squares slope of y on x for [[x, y], ...].
function slope(points) {
  const n = points.length;
  const mx = points.reduce((s, [x]) => s + x, 0) / n;
  const my = points.reduce((s, [, y]) => s + y, 0) / n;
  let num = 0;
  let den = 0;
  for (const [x, y] of points) {
    num += (x - mx) * (y - my);
    den += (x - mx) ** 2;
  }
  return den ? num / den : 0;
}

// View counts keep climbing for a couple of weeks after upload, so the trend
// only uses videos old enough to have mostly settled.
export const TREND_MIN_AGE_DAYS = 14;

/**
 * Is the channel growing? Compares the median views of the most recent
 * uploads with the ones before them ("momentum"), and fits a log-linear trend
 * of views against upload date ("monthlyChange", e.g. 0.12 = +12% per month).
 */
export function channelTrend(videos, now = Date.now()) {
  const usable = videos
    .filter((v) => Number.isFinite(v.views) && v.views > 0)
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  let pool = usable.filter((v) => ageDays(v.publishedAt, now) >= TREND_MIN_AGE_DAYS);
  if (pool.length < 8) pool = usable.filter((v) => ageDays(v.publishedAt, now) >= MIN_BASELINE_AGE_DAYS);
  pool = pool.slice(0, 50);
  if (pool.length < 8) return null;

  const k = Math.max(3, Math.min(10, Math.floor(pool.length / 3)));
  const recentMedian = median(pool.slice(0, k).map((v) => v.views));
  const priorMedian = median(pool.slice(k).map((v) => v.views));
  const momentum = priorMedian ? recentMedian / priorMedian : null;
  const perDay = slope(pool.map((v) => [new Date(v.publishedAt).getTime() / DAY_MS, Math.log10(v.views)]));
  const monthlyChange = 10 ** (perDay * 30) - 1;
  const label = momentum == null ? null : momentum >= 1.25 ? 'growing' : momentum <= 0.8 ? 'declining' : 'stable';
  return { label, momentum, monthlyChange, recentMedian, priorMedian, recentCount: k, sample: pool.length };
}

/**
 * Everything we know about how a video performs relative to its channel.
 * `recent` is the channel's recent uploads of the same format.
 */
export function ideaMetrics(video, { channel, baseline, recent = [] }, now = Date.now()) {
  const age = ageDays(video.publishedAt, now);
  const others = recent.filter((v) => v.id !== video.id);
  const rate = (n, d) => (Number.isFinite(n) && d ? n / d : null);
  const likeRate = rate(video.likes, video.views);
  const channelLikeRate = median(others.map((v) => rate(v.likes, v.views)));
  const trend = channelTrend(recent, now);
  return {
    ageDays: age,
    viewsPerDay: rate(video.views, Math.max(age, 1 / 24)),
    likeRate,
    commentRate: rate(video.comments, video.views),
    subs: channel?.subs ?? null,
    channelTotalViews: channel?.totalViews ?? null,
    channelVideoCount: channel?.videoCount ?? null,
    viewsPerSub: rate(video.views, channel?.subs),
    baselineMedian: baseline?.median ?? null,
    baselineMean: baseline?.mean ?? null,
    baselineSample: baseline?.sample ?? 0,
    multiplier: multiplier(video.views, baseline?.median),
    vsAverage: multiplier(video.views, baseline?.mean),
    aboveAverage: baseline?.mean && Number.isFinite(video.views) ? video.views > baseline.mean : null,
    percentile: percentileRank(video.views, others.map((v) => v.views)),
    channelLikeRate,
    likeRateVsChannel: rate(likeRate, channelLikeRate),
    uploadsPerWeek: uploadsPerWeek(recent, now),
    trend: trend?.label ?? null,
    momentum: trend?.momentum ?? null,
    monthlyChange: trend?.monthlyChange ?? null,
    recentMedian: trend?.recentMedian ?? null,
    priorMedian: trend?.priorMedian ?? null,
  };
}

// What changed between the first and latest snapshot of a tracked idea.
export function trackingStats(history = []) {
  if (history.length < 2) return null;
  const first = history[0];
  const last = history[history.length - 1];
  const days = (last.t - first.t) / DAY_MS;
  const gained = Number.isFinite(last.views) && Number.isFinite(first.views) ? last.views - first.views : null;
  return {
    days,
    viewsGained: gained,
    viewsPerDay: gained != null && days > 0 ? gained / days : null,
    growthPct: gained != null && first.views ? gained / first.views : null,
    subsChange: Number.isFinite(last.subs) && Number.isFinite(first.subs) ? last.subs - first.subs : null,
  };
}

// ---------- Keyword exploration ----------

// Thresholds used for keyword research, after 1of10's outlier-hunting presets.
export const OUTLIER_MIN = 2;
export const SMALL_CHANNEL_SUBS = 50_000;

const clamp01 = (x) => Math.max(0, Math.min(1, x));

/**
 * How promising a keyword is, from its search results (each a scored video
 * with `subs`). Opportunity (0–100) rewards keywords where outliers are
 * common, recent videos still get views, and small channels can rank:
 *   40% outlier rate (≥2x; 50%+ of results scores full marks)
 *   20% small-channel share (channels under 50K subs; 50%+ scores full)
 *   20% freshness (results from the last 6 months)
 *   20% demand (median views of the last year's results; 1M+ scores full)
 */
export function keywordMetrics(results, now = Date.now()) {
  const scored = results.filter((v) => Number.isFinite(v.multiplier));
  if (!results.length) return null;
  const share = (list, pred) => (list.length ? list.filter(pred).length / list.length : 0);
  const outlierRate = share(scored, (v) => v.multiplier >= OUTLIER_MIN);
  const smallShare = share(results.filter((v) => Number.isFinite(v.subs)), (v) => v.subs < SMALL_CHANNEL_SUBS);
  const freshness = share(results, (v) => ageDays(v.publishedAt, now) <= 182);
  const lastYear = results.filter((v) => ageDays(v.publishedAt, now) <= 365);
  const recentMedianViews = median(lastYear.map((v) => v.views));
  const demand = recentMedianViews ? clamp01(Math.log10(recentMedianViews) / 6) : 0;
  const opportunity = Math.round(
    100 * (0.4 * clamp01(outlierRate / 0.5) + 0.2 * clamp01(smallShare / 0.5) + 0.2 * freshness + 0.2 * demand),
  );
  return {
    results: results.length,
    opportunity,
    outlierRate,
    outliers: scored.filter((v) => v.multiplier >= OUTLIER_MIN).length,
    smallChannelOutliers: scored.filter((v) => v.multiplier >= OUTLIER_MIN && v.subs < SMALL_CHANNEL_SUBS).length,
    smallShare,
    freshness,
    medianViews: median(results.map((v) => v.views)),
    recentMedianViews,
    medianSubs: median(results.map((v) => v.subs)),
    medianMultiplier: median(scored.map((v) => v.multiplier)),
  };
}

const STOPWORDS = new Set(
  ('a an the and or but of to in on at for with from by is are was were be been it its this that these those i you he she we they my your our ' +
    'me us them how what why when where who which vs versus do does did not no so if than then just can will get got make made into out up ' +
    'about over after before new full official video videos part ep episode shorts short 2024 2025 2026 2027 ' +
    'actually really very insanely literally ever every thing things ultimate complete most best worst top need know ' +
    'should would could here there way ways one two three first last time times day days intro watch try tried trying ' +
    'all more less much many some any only own still even also too being going go goes like look looks')
    .split(' '),
);

/**
 * Frequent 2–3 word phrases in titles (and tags), excluding the current
 * keyword's own words — candidates for the next level of the rabbit hole.
 */
export function relatedPhrases(titles, keyword, { tags = [], limit = 12 } = {}) {
  const seen = new Set(keyword.toLowerCase().split(/\s+/));
  const words = (t) =>
    t
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s']/gu, ' ')
      .split(/\s+/)
      .filter(Boolean);
  const counts = new Map();
  const add = (phrase, w = 1) => counts.set(phrase, (counts.get(phrase) ?? 0) + w);
  for (const title of titles) {
    const ws = words(title);
    const inTitle = new Set();
    for (let n = 2; n <= 3; n++) {
      for (let i = 0; i + n <= ws.length; i++) {
        const gram = ws.slice(i, i + n);
        if (STOPWORDS.has(gram[0]) || STOPWORDS.has(gram[n - 1])) continue;
        if (gram.every((g) => seen.has(g) || STOPWORDS.has(g))) continue;
        inTitle.add(gram.join(' '));
      }
    }
    for (const w of ws) if (w.length >= 3 && !seen.has(w) && !STOPWORDS.has(w) && !/^\d+$/.test(w)) inTitle.add(`+${w}`);
    for (const p of inTitle) add(p); // count each phrase once per title
  }
  for (const tag of tags) {
    const t = words(tag).join(' ');
    if (t && t !== keyword.toLowerCase() && t.split(' ').length <= 4 && !t.split(' ').every((g) => seen.has(g))) add(t, 0.5);
  }
  return [...counts]
    .filter(([, c]) => c >= 1.5)
    .sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)
    // Drop phrases contained in a higher-ranked one ("budget travel" vs "budget travel tips").
    .filter(([p], i, arr) => {
      const bare = p.replace(/^\+/, '');
      return !arr.slice(0, i).some(([q]) => {
        const other = q.replace(/^\+/, '');
        return other.split(' ').some((w) => bare.split(' ').includes(w));
      });
    })
    .slice(0, limit)
    // Single words ("+japan") become refinements of the keyword itself.
    .map(([p]) => (p.startsWith('+') ? `${keyword} ${p.slice(1)}` : p));
}

// ---------- "Most replayed" heatmap ----------

/**
 * Extracts YouTube's "Most replayed" heatmap from a watch page's HTML:
 * ~100 buckets of { start, duration } (seconds) and a 0–1 intensity, where 1
 * is the most replayed moment. Returns null when the video has none.
 */
export function parseHeatmap(html) {
  const m = /"markerType":"MARKER_TYPE_HEATMAP","markers":(\[[^\]]*\])/.exec(html);
  if (!m) return null;
  try {
    const points = JSON.parse(m[1]).map((p) => ({
      start: Number(p.startMillis) / 1000,
      duration: Number(p.durationMillis) / 1000,
      intensity: Number(p.intensityScoreNormalized),
    }));
    return points.length ? points : null;
  } catch {
    return null;
  }
}

// The most replayed moments: local maxima, at least `gap` buckets apart.
export function heatmapPeaks(points, { count = 3, gap = 5, skipIntro = 3 } = {}) {
  if (!points?.length) return [];
  const candidates = points
    .map((p, i) => ({ ...p, i }))
    .filter((p) => p.i >= skipIntro) // the first seconds are always "replayed" by autoplay
    .sort((a, b) => b.intensity - a.intensity);
  const picked = [];
  for (const c of candidates) {
    if (picked.length >= count) break;
    if (picked.every((p) => Math.abs(p.i - c.i) >= gap)) picked.push(c);
  }
  return picked.sort((a, b) => a.start - b.start).map(({ start, intensity }) => ({ start, intensity }));
}

// Where viewers drop off: average intensity of the last half vs the first half (after the intro).
export function heatmapSummary(points) {
  if (!points?.length) return null;
  const body = points.slice(3);
  const half = Math.floor(body.length / 2);
  const firstHalf = mean(body.slice(0, half).map((p) => p.intensity));
  const secondHalf = mean(body.slice(half).map((p) => p.intensity));
  return {
    peaks: heatmapPeaks(points),
    holdRatio: firstHalf ? secondHalf / firstHalf : null,
    avgIntensity: mean(body.map((p) => p.intensity)),
  };
}

export function formatTime(sec) {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}

// ---------- Channel comparison & radar ----------

/**
 * Public, like-for-like profile of a channel from its cached baseline record
 * (same math for your channel and competitors).
 */
export function channelProfile(base, now = Date.now()) {
  const c = base.channel ?? {};
  const long = base.recent?.long ?? [];
  const short = base.recent?.short ?? [];
  const lm = base.long?.median ?? null;
  const sm = base.short?.median ?? null;
  // Share of recent, settled videos that hit 2x the channel's own median.
  const hitRate = (list, med) => {
    const mature = list.filter((v) => ageDays(v.publishedAt, now) >= MIN_BASELINE_AGE_DAYS).slice(0, BASELINE_SAMPLE);
    return mature.length && med ? mature.filter((v) => v.views / med >= OUTLIER_MIN).length / mature.length : null;
  };
  const trend = channelTrend(long.length >= 8 ? long : short, now);
  const rate = (v) => (v.views ? v.likes / v.views : null);
  return {
    id: c.id,
    title: c.title,
    handle: c.handle,
    thumb: c.thumb,
    subs: c.subs ?? null,
    videoCount: c.videoCount ?? null,
    totalViews: c.totalViews ?? null,
    medianLong: lm,
    medianShort: sm,
    uploadsPerWeek: uploadsPerWeek(long.slice(0, BASELINE_SAMPLE), now),
    shortsPerWeek: uploadsPerWeek(short.slice(0, BASELINE_SAMPLE), now),
    hitRate: hitRate(long, lm),
    shortsHitRate: hitRate(short, sm),
    trend: trend?.label ?? null,
    momentum: trend?.momentum ?? null,
    monthlyChange: trend?.monthlyChange ?? null,
    likeRate: median(long.map(rate)),
    viewsPerSub: lm && c.subs ? lm / c.subs : null,
  };
}

/**
 * Recent uploads that are already outliers and haven't been reported yet.
 * `base` is a baseline record; returns [{ id, format, multiplier, views, publishedAt }].
 */
export function newOutliers(base, seen = new Set(), now = Date.now(), { maxAgeDays = 14, min = OUTLIER_MIN } = {}) {
  const out = [];
  for (const format of ['long', 'short']) {
    const med = base[format]?.median;
    if (!med) continue;
    for (const v of base.recent?.[format] ?? []) {
      if (seen.has(v.id) || ageDays(v.publishedAt, now) > maxAgeDays) continue;
      const m = v.views / med;
      if (m >= min) out.push({ id: v.id, format, multiplier: m, views: v.views, publishedAt: v.publishedAt });
    }
  }
  return out.sort((a, b) => b.multiplier - a.multiplier);
}

// Relative change from `prev` to `cur` (0.12 = +12%); null when undefined.
export function change(cur, prev) {
  return Number.isFinite(cur) && Number.isFinite(prev) && prev !== 0 ? (cur - prev) / Math.abs(prev) : null;
}

/**
 * Plain-language checkpoints from an audience-retention curve
 * ([{ ratio, watch, relative }], ratio 0–1 through the video).
 */
export function retentionSummary(points) {
  if (!points?.length) return null;
  const at = (r) => points.reduce((best, p) => (Math.abs(p.ratio - r) < Math.abs(best.ratio - r) ? p : best)).watch;
  let steepest = null;
  for (let i = 1; i < points.length; i++) {
    if (points[i].ratio < 0.05) continue; // the opening drop is reported separately
    const drop = points[i - 1].watch - points[i].watch;
    if (!steepest || drop > steepest.drop) steepest = { drop, ratio: points[i].ratio };
  }
  const rewatches = points.filter((p, i) => i > 0 && i < points.length - 1 && p.watch > points[i - 1].watch + 0.02 && p.watch >= points[i + 1].watch);
  return {
    start: points[0].watch,
    at10: at(0.1),
    at50: at(0.5),
    at90: at(0.9),
    steepestDrop: steepest,
    rewatchMoments: rewatches.map((p) => p.ratio),
    relative: mean(points.map((p) => p.relative)),
  };
}

/**
 * Change over the last `days` days from a channel's daily history, using the
 * oldest snapshot inside the window. null when there isn't enough history.
 */
export function channelGrowth(history = [], days = 30, now = Date.now()) {
  if (history.length < 2) return null;
  const since = now - days * DAY_MS;
  const last = history[history.length - 1];
  const first = history.find((s) => s.t >= since) ?? history[0];
  if (first === last) return null;
  const d = (k) => (Number.isFinite(last[k]) && Number.isFinite(first[k]) ? last[k] - first[k] : null);
  return {
    days: (last.t - first.t) / DAY_MS,
    subs: d('subs'),
    views: d('totalViews'),
    videos: d('videoCount'),
    subsPct: first.subs ? d('subs') / first.subs : null,
  };
}
