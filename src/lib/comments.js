// Audience research from comments: questions, requests, pain points and the
// moments people mention. Pattern matching; the AI pass turns them into ideas.

import { words } from './titles.js';

// A question mark anywhere (comments ask mid-sentence), or a question opener.
const QUESTION = /\?|^(how|why|what|where|when|which|who|any tips|anyone know|does anyone)\b/im;
const REQUEST =
  /\b(make|do|film|cover|try|review|need|want)\s+(a|an|more|another|part|the)?\s*(video|videos|part 2|part two|series|episode|one)\b|\b(part 2|part two|next video|please (make|do|cover|talk)|can you (make|do|try|cover|review|talk)|would love (a|to see)|do one (on|about)|you should (make|do|try|cover|go)|would be (cool|great|nice|interesting) (to|if)|next time you|hope you (make|do|cover))/i;
const PAIN = /\b(i wish|wish you|too (long|short|fast|slow|much)|didn'?t (work|help)|doesn'?t work|hard to|struggl|confus|frustrat|disappoint|problem (is|was)|annoying|expensive|scam|mistake|regret)\b/i;
const TIMESTAMP = /\b(\d{1,2}:\d{2}(?::\d{2})?)\b/g;
const PRAISE = /\b(best (video|part)|love(d)? (this|the|how)|so (helpful|useful|good)|thank you|thanks|underrated|subscribed|finally someone)\b/i;

const toSec = (ts) => ts.split(':').reduce((a, p) => a * 60 + Number(p), 0);

/** comments: [{ text, likes, replies, author }] (top-level). */
export function analyzeComments(comments) {
  const byLikes = (a, b) => b.likes - a.likes;
  // Requests ("can you make a video…?") get their own list rather than counting as questions.
  const questions = comments.filter((c) => QUESTION.test(c.text) && !REQUEST.test(c.text)).sort(byLikes);
  const requests = comments.filter((c) => REQUEST.test(c.text)).sort(byLikes);
  const pains = comments.filter((c) => PAIN.test(c.text)).sort(byLikes);
  const praise = comments.filter((c) => PRAISE.test(c.text)).sort(byLikes);
  // Timestamps people mention, merged when they fall within 10 seconds of each other.
  const mentions = comments
    .flatMap((c) => [...c.text.matchAll(TIMESTAMP)].map((m) => ({ sec: toSec(m[1]), c })))
    .sort((a, b) => a.sec - b.sec);
  const moments = [];
  for (const m of mentions) {
    const last = moments[moments.length - 1];
    if (last && m.sec - last.start <= 10) {
      last.mentions++;
      last.likes += m.c.likes;
      if (last.examples.length < 3) last.examples.push(m.c);
    } else moments.push({ start: m.sec, mentions: 1, likes: m.c.likes, examples: [m.c] });
  }
  const freq = new Map();
  for (const c of comments) for (const w of new Set(words(c.text).filter((x) => x.length > 3))) freq.set(w, (freq.get(w) ?? 0) + 1);
  return {
    total: comments.length,
    questions,
    requests,
    pains,
    praise,
    moments: moments.sort((a, b) => b.mentions - a.mentions || b.likes - a.likes),
    topWords: [...freq].filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([word, count]) => ({ word, count })),
  };
}
