// Title tester: a transparent packaging checklist plus "which proven outliers
// does this title resemble". These are heuristics drawn from common creator
// guidance, not a CTR prediction.

const STOP = new Set(
  'a an the and or but of to in on at for with from by is are was were be it its this that i you he she we they my your our me us them how what why when where who which do does did not no so if than then just can will get got make made into out up about over after before'.split(
    ' ',
  ),
);
const CURIOSITY = /\b(secret|nobody|no one|truth|actually|really|why|how|mistake|mistakes|wrong|never|stop|before you|don'?t|warning|hidden|finally|tested|tried|honest|surprising|shocking|insane|impossible|worst|best|vs\.?|versus|challenge|exposed|myth|real reason)\b/i;
const EMOTION = /\b(love|hate|regret|scared|afraid|crazy|insane|unbelievable|shocking|perfect|ruined|broke|rich|poor|free|cheap|expensive|dangerous|illegal|banned|lost|won|quit|failed)\b/i;

export const MOBILE_CHARS = 60; // roughly where titles start to cut off on phones
export const MAX_CHARS = 100; // YouTube's hard limit

export function words(title) {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s$%']/gu, ' ')
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w));
}

/**
 * Checklist for one title. Each check: { id, label, pass (true/false/null =
 * not applicable), detail, weight }. `score` is the weighted share passed (0–100).
 */
export function titleChecks(title, { keyword = '', thumbnailText = '' } = {}) {
  const t = title.trim();
  const len = [...t].length;
  const caps = (t.match(/\b[A-Z]{3,}\b/g) ?? []).filter((w) => !/^(USA|UK|EU|AI|DIY|TV|NYC|LA|USD|GPS|VPN|NBA|NFL|IRL|POV|ASMR|FAQ)$/.test(w));
  const kw = keyword.trim().toLowerCase();
  const kwPos = kw ? t.toLowerCase().indexOf(kw) : -1;
  const thumbWords = new Set(words(thumbnailText));
  const overlap = thumbWords.size ? words(t).filter((w) => thumbWords.has(w)).length / thumbWords.size : 0;

  const checks = [
    {
      id: 'length',
      label: 'Fits on mobile',
      pass: len <= MOBILE_CHARS,
      detail: len <= MOBILE_CHARS ? `${len} characters` : `${len} characters: phones cut it off after about ${MOBILE_CHARS}`,
      weight: 2,
    },
    { id: 'notTooShort', label: 'Long enough to say something', pass: len >= 20, detail: `${len} characters`, weight: 1 },
    {
      id: 'keyword',
      label: 'Keyword near the start',
      pass: kw ? kwPos >= 0 && kwPos <= 40 : null,
      detail: !kw ? 'Add a target keyword to check' : kwPos < 0 ? `"${keyword}" isn't in the title` : `"${keyword}" starts at character ${kwPos + 1}`,
      weight: 1,
    },
    { id: 'number', label: 'Specific number', pass: /\d|\$/.test(t), detail: /\d|\$/.test(t) ? 'Numbers make a promise concrete' : 'A number, amount or time span can make it concrete', weight: 1 },
    { id: 'curiosity', label: 'Curiosity or tension', pass: CURIOSITY.test(t) || /\?$/.test(t), detail: (t.match(CURIOSITY) ?? [])[0] ? `Uses "${(t.match(CURIOSITY) ?? [])[0]}"` : /\?$/.test(t) ? 'Asks a question' : 'No open loop: what will viewers wonder about?', weight: 2 },
    { id: 'emotion', label: 'Emotional or high-stakes word', pass: EMOTION.test(t), detail: EMOTION.test(t) ? `Uses "${t.match(EMOTION)[0]}"` : 'Stakes (money, risk, regret, winning) raise interest', weight: 1 },
    { id: 'person', label: 'Personal angle (I / you)', pass: /\b(i|i'm|i've|my|you|your)\b/i.test(t), detail: 'First-person stories and direct "you" titles tend to feel personal', weight: 1 },
    { id: 'caps', label: 'Easy on CAPS', pass: caps.length <= 1, detail: caps.length ? `${caps.length} all-caps word${caps.length > 1 ? 's' : ''}` : 'No shouting', weight: 1 },
    {
      id: 'thumbnail',
      label: "Doesn't repeat the thumbnail text",
      pass: thumbWords.size ? overlap < 0.5 : null,
      detail: !thumbWords.size ? 'Add the thumbnail text to check' : overlap < 0.5 ? 'Title and thumbnail say different things' : 'Title repeats the thumbnail; let them complement each other',
      weight: 1,
    },
    { id: 'limit', label: 'Under YouTube\'s 100-character limit', pass: len <= MAX_CHARS, detail: `${len} / ${MAX_CHARS}`, weight: 3 },
  ];
  const scored = checks.filter((c) => c.pass !== null);
  const total = scored.reduce((n, c) => n + c.weight, 0);
  const got = scored.reduce((n, c) => n + (c.pass ? c.weight : 0), 0);
  return { title: t, length: len, checks, score: total ? Math.round((got / total) * 100) : 0 };
}

// Structural features shared by titles, e.g. "number", "question", "vs".
export function features(title) {
  const t = title.toLowerCase();
  return [
    /\d/.test(t) && 'number',
    /\$|€|£|\bdollars?\b|\bcheap|\bfree\b/.test(t) && 'money',
    /\?/.test(t) && 'question',
    /\b(i|i'm|i've|my)\b/.test(t) && 'first person',
    /\b(you|your)\b/.test(t) && 'you',
    /\b(vs\.?|versus)\b/.test(t) && 'comparison',
    /\b(day|days|hours?|week|weeks|month|months|year|years)\b/.test(t) && 'time span',
    /\b(tried|tested|test|spent|lived|survived)\b/.test(t) && 'experiment',
    /\b(how to|guide|tips|ways)\b/.test(t) && 'how-to',
    /\b(never|stop|mistakes?|wrong|don'?t)\b/.test(t) && 'warning',
  ].filter(Boolean);
}

/**
 * The proven titles (saved ideas, competitor outliers) a draft most resembles,
 * by shared words and shared structure. corpus: [{ title, multiplier, ... }].
 */
export function similarTitles(title, corpus, limit = 3) {
  const w = new Set(words(title));
  const f = new Set(features(title));
  return corpus
    .map((item) => {
      const iw = new Set(words(item.title));
      const shared = [...w].filter((x) => iw.has(x));
      const union = new Set([...w, ...iw]).size || 1;
      const sharedFeatures = features(item.title).filter((x) => f.has(x));
      return { ...item, similarity: shared.length / union + 0.08 * sharedFeatures.length, sharedWords: shared, sharedFeatures };
    })
    .filter((x) => x.similarity > 0.1)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}
