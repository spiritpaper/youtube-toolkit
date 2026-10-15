// Short-form candidates inside a long video: 25–58 second stretches around
// the moments viewers replay most (public heatmap) and the script's attention
// devices, cut at sentence boundaries so each one can stand alone.

const MIN_LEN = 25;
const MAX_LEN = 58;
const LEAD_IN = 8; // look back this far for a sentence start before the moment
const BONUS = { turn: 0.35, question: 0.25, stakes: 0.3, story: 0.25, openLoop: 0.1, proof: 0.2 };

const endsSentence = (text) => /[.!?…]["')\]]?\s*$/.test(text.trim());

function heatAt(heatmap, t) {
  if (!heatmap?.length) return 0;
  const b = heatmap.find((p) => t >= p.start && t < p.start + (p.duration || 1)) ?? heatmap.at(-1);
  return b?.intensity ?? 0;
}

/**
 * Up to `max` non-overlapping candidates: { start, end, text, heat, reasons },
 * best first. `devices` are from analyzeScript (type + start).
 */
export function shortCandidates(segments, { heatmap = null, devices = [], max = 6 } = {}) {
  if (!segments?.length) return [];
  const duration = segments.at(-1).start + (segments.at(-1).dur ?? 4);
  if (duration < MIN_LEN * 2) return [];

  // Anchors: replay peaks and attention devices, scored.
  const anchors = [];
  for (const p of heatmap ?? []) if (p.intensity >= 0.45) anchors.push({ t: p.start, score: p.intensity, reason: `replayed (${Math.round(p.intensity * 100)}%)` });
  for (const d of devices) {
    if (!BONUS[d.type]) continue;
    anchors.push({ t: d.start, score: BONUS[d.type] + heatAt(heatmap, d.start) * 0.5, reason: d.type });
  }
  if (!anchors.length) {
    // No heatmap or devices: fall back to evenly spaced stretches.
    for (let t = 30; t < duration - MIN_LEN; t += duration / 6) anchors.push({ t, score: 0.1, reason: 'evenly spaced' });
  }
  anchors.sort((a, b) => b.score - a.score);

  const idxAt = (t) => {
    let i = 0;
    for (let k = 0; k < segments.length; k++) if (segments[k].start <= t) i = k;
    return i;
  };
  const chosen = [];
  for (const a of anchors) {
    if (chosen.length >= max) break;
    // Walk back to the start of the sentence, at most LEAD_IN seconds.
    let si = idxAt(a.t);
    while (si > 0 && segments[si - 1].start >= a.t - LEAD_IN && !endsSentence(segments[si - 1].text)) si--;
    const start = segments[si].start;
    // End at the first sentence end past the minimum length, within the maximum.
    let ei = si;
    let end = start;
    for (let k = si; k < segments.length; k++) {
      const segEnd = segments[k].start + (segments[k].dur ?? (segments[k + 1]?.start ?? segments[k].start + 4) - segments[k].start);
      if (segEnd - start > MAX_LEN) break;
      ei = k;
      end = segEnd;
      if (segEnd - start >= MIN_LEN && endsSentence(segments[k].text)) break;
    }
    if (end - start < MIN_LEN) continue;
    if (chosen.some((c) => start < c.end && end > c.start)) {
      // Same stretch: just add the reason.
      const c = chosen.find((x) => start < x.end && end > x.start);
      if (!c.reasons.includes(a.reason)) c.reasons.push(a.reason);
      continue;
    }
    const inside = segments.slice(si, ei + 1);
    const heat = heatmap?.length ? inside.reduce((s, x) => s + heatAt(heatmap, x.start), 0) / inside.length : null;
    chosen.push({ start, end, text: inside.map((s) => s.text).join(' ').replace(/\s+/g, ' ').trim(), heat, reasons: [a.reason] });
  }
  return chosen;
}
