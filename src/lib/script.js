// Script analysis from a transcript ([{ start (s), text }]): hook, pacing,
// attention devices, keywords, structure, and what was said at the moments
// viewers replayed (heatmap) or left (your own retention curve).
// Pattern matching finds *candidates*; the AI pass explains them.

import { words } from './titles.js';
import { heatmapPeaks } from './stats.js';

export const HOOK_SECONDS = 30;

// Spoken attention devices creators use to grab and hold viewers.
export const DEVICES = {
  openLoop: {
    label: 'Open loop / tease',
    hint: 'Promises something later so viewers stay',
    re: /\b(later in (this|the) video|by the end( of (this|the) video)?|stick around|stay tuned|in a (minute|second|moment|bit)|coming up|wait (until|till|for it)|i'?ll (show|tell|explain|get to)|keep watching|at the end|more on that|we'?ll get (to|there)|spoiler)\b/i,
  },
  turn: {
    label: 'Twist / turn',
    hint: 'A change of direction that resets attention',
    re: /\b(but (then|here'?s|that'?s|it|this)|however|plot twist|turns out|the problem (is|was)|except|instead|suddenly|that'?s when|little did|out of nowhere|the catch)\b/i,
  },
  question: { label: 'Question to the viewer', hint: 'Makes viewers answer in their head', re: /\?|^(why|how|what|have you|did you|do you|would you|can you)\b/i },
  stakes: {
    label: 'Stakes / tension',
    hint: 'Money, risk, mistakes, or something to lose',
    re: /(\$\s?\d|\b(money|lost|lose|losing|risk|danger|dangerous|mistake|mistakes|never|worst|scam|regret|broke|illegal|fail|failed|disaster|warning|trap)\b)/i,
  },
  story: {
    label: 'Story beat',
    hint: 'Personal narrative that pulls viewers along',
    re: /\b(so i|i was|we were|that day|that night|years ago|when i|my first|my last|i remember|i decided|i realized|i had no idea)\b/i,
  },
  proof: { label: 'Specifics / proof', hint: 'Numbers and details that make it credible', re: /\b\d[\d,.]*\s?(%|percent|dollars|yen|euros|hours|days|minutes|km|miles|times|people)?\b/i },
  cta: {
    label: 'Call to action / sponsor',
    hint: 'Subscribe asks and sponsor reads, where viewers often drop',
    re: /\b(subscribe|hit the (like|bell)|like (this|the) video|leave a comment|comment (below|down)|link (is )?(in|below)|patreon|sponsor(ed)?|brought to you|use (my )?code|check out .{0,20}(link|below))\b/i,
  },
};

const PROMISE = /\b(in this video|today (i'?m|we'?re|i will|we will)|i'?m going to|we'?re going to|by the end|you'?ll (learn|see|know)|here'?s (how|why|what)|let me show)\b/i;

// Spoken filler that isn't a topic.
const SPOKEN = new Set(
  "it's that's there's here's what's i'm you're we're they're don't can't won't didn't isn't gonna wanna gotta one also just really very actually going get got thing things lot way kind sort pretty much well okay yeah right like know mean see look little bit even still back now then there here video videos guys today subscribe channel".split(' '),
);
const topicWords = (text) => words(text).filter((w) => w.length > 2 && !/^\d+$/.test(w) && !SPOKEN.has(w));
// Loose match so "japanese" counts for "japan" and "traveling" for "travel".
const stemMatch = (a, b) => a === b || (a.length >= 4 && b.length >= 4 && (a.startsWith(b.slice(0, 5)) || b.startsWith(a.slice(0, 5))));

const lineAt = (segments, t) => segments.findLast((s) => s.start <= t) ?? segments[0];

export function scriptDuration(segments, durationSec) {
  if (durationSec) return durationSec;
  const last = segments[segments.length - 1];
  return last ? last.start + Math.max(3, last.text.split(/\s+/).length / 2.5) : 0;
}

/**
 * Full analysis. options: { title, durationSec, heatmap (points), retention
 * ([{ ratio, watch }]), sections (count) }.
 */
export function analyzeScript(segments, { title = '', durationSec = 0, heatmap = null, retention = null, sections = 8 } = {}) {
  if (!segments?.length) return null;
  const duration = scriptDuration(segments, durationSec);
  const minutes = Math.max(duration / 60, 1 / 60);
  const wordCount = (t) => t.split(/\s+/).filter(Boolean).length;
  const totalWords = segments.reduce((n, s) => n + wordCount(s.text), 0);

  // Hook: everything said in the first 30 seconds.
  const hookSegs = segments.filter((s) => s.start < HOOK_SECONDS);
  const hookText = hookSegs.map((s) => s.text).join(' ');
  const titleWords = [...new Set(topicWords(title))];
  const hookWords = topicWords(hookText);
  const hookHas = (w) => hookWords.some((h) => stemMatch(h, w));
  const hook = {
    text: hookText,
    words: wordCount(hookText),
    checks: [
      { label: 'Echoes the title', pass: titleWords.length ? titleWords.filter(hookHas).length / titleWords.length >= 0.3 : null },
      { label: 'Says what the video will deliver', pass: PROMISE.test(hookText) },
      { label: 'Opens a loop or asks a question', pass: DEVICES.openLoop.re.test(hookText) || DEVICES.question.re.test(hookText) },
      { label: 'Raises stakes', pass: DEVICES.stakes.re.test(hookText) },
      { label: 'Talks to "you"', pass: /\byou(r)?\b/i.test(hookText) },
      { label: 'Gets to the point fast (under ~90 words)', pass: wordCount(hookText) > 0 && wordCount(hookText) <= 90 },
    ],
  };

  // Attention devices, with timestamps and quotes.
  const devices = [];
  for (const s of segments) {
    for (const [type, d] of Object.entries(DEVICES)) {
      if (type === 'proof') continue; // counted, not listed (too frequent)
      const m = d.re.exec(s.text);
      if (m) devices.push({ type, start: s.start, text: s.text, match: m[0] });
    }
  }
  const counts = Object.fromEntries(
    Object.keys(DEVICES).map((type) => [type, type === 'proof' ? segments.filter((s) => DEVICES.proof.re.test(s.text)).length : devices.filter((d) => d.type === type).length]),
  );
  const youCount = segments.reduce((n, s) => n + (s.text.match(/\byou(r|'re|'ll)?\b/gi) ?? []).length, 0);

  // Keywords: most used words and two-word phrases.
  const freq = new Map();
  const first = new Map();
  for (const s of segments) {
    const ws = topicWords(s.text);
    const grams = [...ws, ...ws.slice(1).map((w, i) => `${ws[i]} ${w}`)];
    for (const g of grams) {
      freq.set(g, (freq.get(g) ?? 0) + 1);
      if (!first.has(g)) first.set(g, s.start);
    }
  }
  const keywords = [...freq]
    .filter(([g, n]) => n >= (g.includes(' ') ? 2 : 3))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([term, count]) => ({ term, count, firstAt: first.get(term), inTitle: term.split(' ').every((w) => titleWords.includes(w)) }));
  const titleTerms = titleWords.map((w) => ({ term: w, count: freq.get(w) ?? 0, firstAt: first.get(w) ?? null }));

  // Structure: equal time sections with pace, devices and audience signals.
  const n = Math.max(1, Math.min(sections, Math.ceil(duration / 30)));
  const len = duration / n;
  const heatAt = (a, b) => {
    const pts = (heatmap ?? []).filter((p) => p.start + p.duration > a && p.start < b);
    return pts.length ? pts.reduce((x, p) => x + p.intensity, 0) / pts.length : null;
  };
  const retAt = (t) => {
    if (!retention?.length) return null;
    const r = t / duration;
    return retention.reduce((b, p) => (Math.abs(p.ratio - r) < Math.abs(b.ratio - r) ? p : b)).watch;
  };
  const structure = Array.from({ length: n }, (_, i) => {
    const a = i * len;
    const b = (i + 1) * len;
    const segs = segments.filter((s) => s.start >= a && s.start < b);
    const text = segs.map((s) => s.text).join(' ');
    const top = [...new Set(topicWords(text).filter((w) => w.length > 3))]
      .map((w) => [w, (text.toLowerCase().match(new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g')) ?? []).length])
      .sort((x, y) => y[1] - x[1])
      .slice(0, 3)
      .map(([w]) => w);
    return {
      start: a,
      end: b,
      wpm: Math.round(wordCount(text) / (len / 60)),
      devices: devices.filter((d) => d.start >= a && d.start < b).length,
      topWords: top,
      heat: heatAt(a, b),
      retention: retAt(a),
      firstLine: segs[0]?.text ?? '',
    };
  });

  // What was said where viewers replayed (public heatmap) ...
  const replayed = heatmap?.length
    ? heatmapPeaks(heatmap).map((p) => {
        const bucket = heatmap.find((x) => x.start === p.start)?.duration ?? 10;
        const lines = segments.filter((s) => s.start >= p.start - 4 && s.start <= p.start + bucket + 4).slice(0, 4);
        // No speech at a replayed moment usually means a visual moment (b-roll, a reveal, music).
        return { start: p.start, intensity: p.intensity, lines, silent: lines.length === 0 };
      })
    : [];
  // ... and where viewers left (your own retention curve).
  const dropOffs = [];
  if (retention?.length > 2) {
    const drops = retention
      .slice(1)
      .map((p, i) => ({ ratio: p.ratio, drop: retention[i].watch - p.watch }))
      .filter((d) => d.ratio > 0.03 && d.drop > 0)
      .sort((a, b) => b.drop - a.drop)
      .slice(0, 3);
    for (const d of drops) {
      const t = d.ratio * duration;
      dropOffs.push({ start: t, drop: d.drop, line: lineAt(segments, t), lines: segments.filter((s) => s.start >= t - 10 && s.start <= t + 3) });
    }
  }

  return {
    duration,
    totalWords,
    wpm: Math.round(totalWords / minutes),
    hook,
    devices,
    counts,
    perMinute: Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, v / minutes])),
    youPerMinute: youCount / minutes,
    keywords,
    titleTerms,
    structure,
    replayed,
    dropOffs,
  };
}

/** Hook-library row: how the first 30 seconds of a saved outlier are built. */
export function hookSummary(segments, title) {
  const a = analyzeScript(segments, { title });
  if (!a) return null;
  return { text: a.hook.text, words: a.hook.words, passed: a.hook.checks.filter((c) => c.pass).length, total: a.hook.checks.filter((c) => c.pass !== null).length, checks: a.hook.checks };
}

// ---------- Your own draft scripts ----------

/**
 * Turns a draft (plain text) into timed segments, one per sentence, at a
 * speaking pace of `wpm` words per minute, so it can be analyzed like a
 * transcript.
 */
export function draftSegments(text, wpm = 150) {
  const sentences = text
    .replace(/\r/g, '')
    .split(/(?<=[.!?…])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  let words = 0;
  return sentences.map((s) => {
    const seg = { start: (words / wpm) * 60, text: s };
    words += s.split(/\s+/).length;
    return seg;
  });
}

/**
 * Stretches of at least `minSeconds` where the script uses no attention device:
 * where viewers are most likely to drift. Returns [{ start, end, firstLine }].
 */
export function driftZones(analysis, segments, minSeconds = 60) {
  const times = [0, ...analysis.devices.map((d) => d.start).sort((a, b) => a - b), analysis.duration];
  const zones = [];
  for (let i = 1; i < times.length; i++) {
    const [a, b] = [times[i - 1], times[i]];
    if (b - a >= minSeconds) {
      const seg = segments.find((s) => s.start > a + 1) ?? segments[0];
      zones.push({ start: a, end: b, firstLine: seg?.text ?? '' });
    }
  }
  return zones;
}

/**
 * Re-hook checkpoints at 25%, 50% and 75% of the runtime: the line spoken
 * there, and whether an attention device lands within ±8% of the runtime.
 */
export function rehookCheckpoints(analysis, segments) {
  return [0.25, 0.5, 0.75].map((p) => {
    const t = p * analysis.duration;
    const window = analysis.duration * 0.08;
    const near = analysis.devices.filter((d) => Math.abs(d.start - t) <= window);
    const line = segments.findLast((s) => s.start <= t) ?? segments[0];
    return { at: p, start: t, line: line?.text ?? '', covered: near.length > 0, devices: near };
  });
}

/** Side-by-side numbers: your draft vs a reference outlier. */
export function compareScripts(mine, ref) {
  const pm = (a, k) => a.perMinute[k] ?? 0;
  const keys = ['openLoop', 'turn', 'question', 'stakes', 'story'];
  return [
    { label: 'Length', mine: mine.duration, ref: ref.duration, kind: 'time' },
    { label: 'Hook words (first 30 s)', mine: mine.hook.words, ref: ref.hook.words },
    { label: 'Hook signals', mine: mine.hook.checks.filter((c) => c.pass).length, ref: ref.hook.checks.filter((c) => c.pass).length },
    { label: 'Attention devices / min', mine: keys.reduce((n, k) => n + pm(mine, k), 0), ref: keys.reduce((n, k) => n + pm(ref, k), 0), kind: 'rate' },
    ...keys.map((k) => ({ label: `  ${DEVICES[k].label} / min`, mine: pm(mine, k), ref: pm(ref, k), kind: 'rate' })),
    { label: '"You" / min', mine: mine.youPerMinute, ref: ref.youPerMinute, kind: 'rate' },
  ];
}
