// The lab notebook: your notes, lessons and experiments, and recalling the
// right ones while you write. Pure functions; everything stays on your device.

import { finalNumbers } from './projects.js';

/** #tags in a note: lower-case, unique. "#hook #b-roll" → ['hook', 'b-roll']. */
export function noteTags(text) {
  const out = new Set();
  for (const m of String(text ?? '').matchAll(/(?:^|[\s(])#([\p{L}\p{N}][\p{L}\p{N}_-]{1,29})/gu)) out.add(m[1].toLowerCase());
  return [...out];
}

const STOP = new Set(('the and for are but not you your yours with this that these those from have has had was were will would could should can what when where which who whom why how all any each few more most other some such only own same than too very just also into over under again then once here there about above below after before because until while does did doing done being been its it\'s they them their theirs our ours we us his her him she he i me my mine an a of to in on at by or as is be if so no yes do up out off one two get got make made like really thing things video videos youtube channel').split(' '));

// A light stemmer: enough that "hooks", "hooked" and "hooking" meet.
const stem = (w) => {
  const base = w.replace(/ies$/, 'y').replace(/(?:ss)$/, 'ss').replace(/(?:(?<=[sxz]|ch|sh)es|(?<!s)s|ing|ed|ly)$/, '').replace(/(.)\1$/, '$1').replace(/e$/, '');
  return base.length >= 3 ? base : w;
};

const rawWords = (text) =>
  String(text ?? '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w));

/** Meaningful words of a text, stemmed. */
export const words = (text) => rawWords(text).map(stem);

/**
 * What you're writing about right now: the paragraph around the caret and
 * the heading above it (Markdown "#" or a "**bold**" line).
 */
export function contextAt(text, caret = text.length) {
  const before = text.slice(0, caret);
  const start = before.lastIndexOf('\n\n') + 1;
  const endRel = text.slice(caret).indexOf('\n\n');
  const paragraph = text.slice(start, endRel < 0 ? text.length : caret + endRel).trim();
  const heading = [...before.matchAll(/^(?:#{1,6}\s+(.+)|\*\*(.+?)\*\*\s*:?\s*)$/gm)].at(-1);
  return { paragraph, heading: (heading?.[1] ?? heading?.[2] ?? '').trim() };
}

/**
 * Notebook items that match what you're writing. items: [{ id, text, tags }].
 * Words that are rare across the notebook count more; a matching #tag counts
 * double. An item needs two different matching words (or a tag) to show.
 * Returns [{ item, score, matched }], best first.
 */
export function recall({ paragraph = '', heading = '', title = '' }, items, { limit = 4 } = {}) {
  const query = new Map();
  for (const w of words(paragraph)) query.set(w, (query.get(w) ?? 0) + 1);
  for (const w of words(heading)) query.set(w, (query.get(w) ?? 0) + 1.5);
  for (const w of words(title)) query.set(w, (query.get(w) ?? 0) + 0.5);
  if (!query.size) return [];
  // Show the words as you wrote them, not their stems.
  const shown = new Map();
  for (const w of rawWords(`${paragraph} ${heading} ${title}`)) if (!shown.has(stem(w))) shown.set(stem(w), w);
  const docs = items.map((item) => ({ item, set: new Set(words(item.text)), tags: new Set((item.tags ?? []).map(stem)) }));
  const df = new Map();
  for (const d of docs) for (const w of new Set([...d.set, ...d.tags])) df.set(w, (df.get(w) ?? 0) + 1);
  const idf = (w) => Math.log(1 + docs.length / (df.get(w) ?? 1));
  const out = [];
  for (const d of docs) {
    let score = 0;
    const matched = [];
    let tagHit = false;
    for (const [w, qw] of query) {
      const inTags = d.tags.has(w);
      if (!inTags && !d.set.has(w)) continue;
      tagHit ||= inTags;
      score += Math.min(qw, 3) * idf(w) * (inTags ? 2 : 1);
      matched.push(shown.get(w) ?? w);
    }
    if (matched.length < 2 && !tagHit) continue;
    out.push({ item: d.item, score: score / Math.sqrt(Math.max(8, d.set.size)), matched });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** Bullet points under one "## Section" of a Markdown text. */
function sectionBullets(md, name) {
  const part = String(md ?? '').split(/^##\s+/m).find((p) => p.toLowerCase().startsWith(name.toLowerCase()));
  if (!part) return [];
  const body = part.split('\n').slice(1).join('\n');
  const bullets = body.split('\n').map((l) => /^\s*(?:[-*]|\d+\.)\s+(.+)/.exec(l)?.[1]).filter(Boolean);
  return (bullets.length ? bullets : body.split(/\n{2,}/)).map((t) => t.replace(/\*\*/g, '').trim()).filter((t) => t.length > 8);
}

/** Lessons a checked screening taught ("For the next screening"). */
export function screeningLessons(sim) {
  return sectionBullets(sim.accuracyNotes?.text, 'For the next screening').map((text, i) => ({
    id: `${sim.id}:${i}`,
    text,
    tags: [],
    source: { kind: 'screening', simId: sim.id, projectId: sim.projectId, title: sim.projectTitle ?? sim.title },
    createdAt: sim.accuracyNotes.at ?? sim.at,
  }));
}

export const MEASURES = {
  d7: { label: 'Views at 7 days (× channel median)', unit: '×' },
  multiplier: { label: 'Views now (× channel median)', unit: '×' },
  avgViewed: { label: 'Average % watched', unit: '%' },
  ctr: { label: 'Click-through rate', unit: '%' },
};

/** One project's value for a measure (null if unknown yet). */
export function measureOf(project, measure, sims = []) {
  const f = finalNumbers(project);
  if (measure === 'd7') return f.d7?.multiplier ?? null;
  if (measure === 'multiplier') return f.multiplier;
  const checked = sims.find((s) => s.projectId === project.id && s.actual?.[measure] != null);
  return checked ? checked.actual[measure] : null;
}

const median = (xs) => {
  const v = xs.filter((x) => x != null && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};

/**
 * An experiment's results: its videos against your other published videos
 * on the same measure. { rows: [{ project, value }], value, baseline, n, others, lift }.
 * lift: the experiment's median / the others' median (null if either is missing).
 */
export function experimentResults(exp, projects, sims = []) {
  const ids = new Set(exp.projectIds ?? []);
  const rows = (exp.projectIds ?? []).map((id) => projects[id]).filter(Boolean).map((p) => ({ project: p, value: measureOf(p, exp.measure, sims) }));
  const others = Object.values(projects).filter((p) => !ids.has(p.id) && (p.performance?.history?.length || p.publishedVideoId)).map((p) => measureOf(p, exp.measure, sims)).filter((x) => x != null);
  const value = median(rows.map((r) => r.value));
  const baseline = median(others);
  return { rows, value, baseline, n: rows.filter((r) => r.value != null).length, others: others.length, lift: value != null && baseline ? value / baseline : null };
}

/** A one-line read of the results, careful about small numbers. */
export function resultsVerdict(res) {
  if (!res.n) return 'No results yet: link published videos and give them a week.';
  if (res.baseline == null) return 'No other published videos to compare with yet.';
  const pct = Math.round((res.lift - 1) * 100);
  const dir = Math.abs(pct) < 10 ? 'about the same as' : pct > 0 ? `${pct}% better than` : `${-pct}% worse than`;
  const caution = res.n < 3 ? ` Only ${res.n} video${res.n === 1 ? '' : 's'} so far: treat it as a hint, not proof.` : '';
  return `These videos did ${dir} your other ${res.others} published video${res.others === 1 ? '' : 's'}.${caution}`;
}
