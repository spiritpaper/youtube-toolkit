// Test screenings: run a video (title, hook, script) past an avatar group.
// The AI plays the viewers; every number here is computed from their
// answers, weighted by each avatar's share of the audience.
//
// Stored per screening as `sim:<id>`:
//   { id, projectId, groupId, groupName, title, at, material, feed, story,
//     result (aggregate()), summary: { text, provider, model }, provider, model }

export const WPM = 150; // speaking pace used to place beats in time
const HOOK_WORDS = 75; // about the first 30 seconds

const cut = (t, n) => (t.length > n ? `${t.slice(0, n).replace(/\s+\S*$/, '')}…` : t);
const words = (s) => String(s ?? '').split(/\s+/).filter(Boolean);

/**
 * Splits a script into the hook (first ~30 s) and up to `max` beats of similar
 * length, cut at paragraph or sentence ends. Without a script, outline lines
 * become the beats (no times). Returns { hook, beats, timed }.
 */
export function splitMaterial({ script = '', outline = '' } = {}, { max = 8 } = {}) {
  const text = String(script).trim();
  if (text) {
    const all = words(text);
    const hook = all.slice(0, HOOK_WORDS).join(' ');
    const restWords = all.slice(HOOK_WORDS);
    if (!restWords.length) return { hook: { text: hook, end: Math.round((all.length / WPM) * 60) }, beats: [], timed: true };
    // Sentences after the hook, grouped into beats of roughly equal length.
    const rest = restWords.join(' ');
    const sentences = rest.split(/(?<=[.!?…])\s+/).filter(Boolean);
    const n = Math.min(max, Math.max(1, Math.round(restWords.length / 120)));
    const target = restWords.length / n;
    const beats = [];
    let cur = [];
    let count = 0;
    let at = HOOK_WORDS;
    for (const s of sentences) {
      cur.push(s);
      count += words(s).length;
      if (count >= target && beats.length < n - 1) {
        beats.push({ text: cur.join(' '), startWord: at, words: count });
        at += count;
        cur = [];
        count = 0;
      }
    }
    if (cur.length) beats.push({ text: cur.join(' '), startWord: at, words: count });
    return {
      hook: { text: hook, end: Math.round((Math.min(all.length, HOOK_WORDS) / WPM) * 60) },
      beats: beats.map((b, i) => ({ i, start: Math.round((b.startWord / WPM) * 60), text: b.text.slice(0, 1400), first: cut(b.text.split(/(?<=[.!?…])\s/)[0], 160) })),
      duration: Math.round((all.length / WPM) * 60),
      timed: true,
    };
  }
  const lines = String(outline).split('\n').map((l) => l.replace(/^\s*(?:[-*+]|\d+[.)]|#+)\s*/, '').trim()).filter((l) => l.length > 3);
  if (!lines.length) return { hook: null, beats: [], timed: false };
  // The first outline line stands in for the hook; the rest become beats.
  const rest = lines.slice(1);
  const per = Math.max(1, Math.ceil(rest.length / max));
  const beats = [];
  for (let i = 0; i < rest.length; i += per) {
    const text = rest.slice(i, i + per).join(' · ');
    beats.push({ i: beats.length, start: null, text: text.slice(0, 1400), first: cut(text, 160) });
  }
  return { hook: { text: lines[0], end: null }, beats, timed: false, outline: true };
}

// Rules of thumb when the channel's own numbers aren't available: the share of
// a long video people typically watch, by relationship to the channel.
export const TYPICAL_WATCH = { subscriber: 50, returning: 42, new: 30 };
const DEVICE_SHIFT = { tv: 8, computer: 2, tablet: 0, phone: -4 };

/**
 * About how much of a video like this the viewer would watch, in percent,
 * before anything about this particular video. Uses the channel's real
 * subscriber / non-subscriber averages when known (baseline.bySub).
 */
export function expectedWatch(a, baseline = null) {
  const real = baseline?.bySub;
  let base;
  if (real && (real.subscribed != null || real.unsubscribed != null)) {
    base = a.relationship === 'subscriber' ? real.subscribed ?? real.unsubscribed : a.relationship === 'returning' ? ((real.subscribed ?? real.unsubscribed) + (real.unsubscribed ?? real.subscribed)) / 2 : real.unsubscribed ?? real.subscribed;
  } else {
    base = TYPICAL_WATCH[a.relationship] ?? TYPICAL_WATCH.new;
  }
  return Math.round(Math.min(90, Math.max(8, base + (DEVICE_SHIFT[a.device] ?? 0))));
}

/** A compact description of an avatar for the prompts. */
export function avatarBrief(a) {
  return [
    `[${a.id}] ${a.name}, ${a.age ?? '?'}${a.gender ? `, ${a.gender}` : ''}, ${a.occupation || 'unknown job'}${a.location ? `, ${a.location}` : ''}.`,
    a.lifeStage && `Situation: ${a.lifeStage}.`,
    `Knows the topic: ${a.knowledge}. ${a.relationship === 'subscriber' ? 'Subscribed.' : a.relationship === 'returning' ? 'Has watched before.' : 'Has never watched this channel.'} Finds videos via ${a.discovery}, on a ${a.device}.`,
    a.interests?.length && `Interests: ${a.interests.join(', ')}.`,
    a.wants && `Wants: ${a.wants}`,
    a.beliefs?.length && `Believes: ${a.beliefs.join('; ')}.`,
    a.frustrations?.length && `Frustrated by: ${a.frustrations.join('; ')}.`,
    a.moves && `Moved by: ${a.moves}`,
    a.turnoffs && `Clicks away when: ${a.turnoffs}`,
    a.habits && `Watching habits: ${a.habits}`,
  ].filter(Boolean).join(' ');
}

/** The JSON array in a model's answer (fenced or not), or throws. */
export function extractJsonArray(text) {
  const t = String(text ?? '');
  for (const c of [/```(?:json)?\s*([\s\S]*?)```/i.exec(t)?.[1], t].filter(Boolean)) {
    const start = c.indexOf('[');
    const end = c.lastIndexOf(']');
    if (start < 0 || end <= start) continue;
    try {
      const arr = JSON.parse(c.slice(start, end + 1));
      if (Array.isArray(arr)) return arr;
    } catch {
      // next candidate
    }
  }
  throw new Error('The AI answered in an unexpected format. Try again.');
}

const clampN = (v, lo, hi) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : null;
};
const s = (v, max = 300) => (v == null ? '' : String(v).trim().slice(0, max));
const yes = (v) => v === true || /^(yes|true|y)$/i.test(String(v ?? '').trim());

/** Cleans the feed + hook answers, keyed to known avatars. */
export function cleanFeed(arr, avatars) {
  const ids = new Set(avatars.map((a) => a.id));
  const out = {};
  for (const r of arr) {
    const id = s(r.id, 40);
    if (!ids.has(id)) continue;
    const click = ['yes', 'maybe', 'no'].includes(String(r.click).toLowerCase()) ? String(r.click).toLowerCase() : 'no';
    const clicked = click !== 'no';
    const stay = clicked && r.stay != null ? yes(r.stay) : null;
    out[id] = {
      click,
      firstThought: s(r.firstThought),
      clickWhy: s(r.clickWhy),
      stay,
      leaveAt: clicked && stay === false ? clampN(r.leaveAt, 0, 60) : null,
      hookFeeling: clicked ? s(r.hookFeeling, 60) : '',
      hookWhy: clicked ? s(r.hookWhy) : '',
    };
  }
  return out;
}

/** Cleans the story answers. Beats after a viewer leaves are dropped. */
export function cleanStory(arr, avatars, beatCount) {
  const ids = new Set(avatars.map((a) => a.id));
  const out = {};
  for (const r of arr) {
    const id = s(r.id, 40);
    if (!ids.has(id)) continue;
    const beats = [];
    for (const b of Array.isArray(r.beats) ? r.beats : []) {
      const i = Math.round(Number(b.i));
      if (!(i >= 0 && i < beatCount) || beats.some((x) => x.i === i)) continue;
      beats.push({ i, attention: clampN(b.attention, 0, 10) ?? 5, emotion: s(b.emotion, 40), thought: s(b.thought, 240), leave: yes(b.leave) });
    }
    beats.sort((a, b) => a.i - b.i);
    const left = beats.findIndex((b) => b.leave);
    const kept = left >= 0 ? beats.slice(0, left + 1) : beats;
    const e = r.end ?? {};
    const reached = left < 0 && kept.length > 0 && kept.at(-1).i === beatCount - 1;
    out[id] = {
      beats: kept,
      leftAt: left >= 0 ? kept[left].i : null,
      end: reached
        ? { score: clampN(e.score, 1, 10), like: yes(e.like), comment: s(e.comment, 400) || null, subscribe: yes(e.subscribe), share: yes(e.share), watchNext: yes(e.watchNext), tellFriend: s(e.tellFriend), changed: s(e.changed) }
        : null,
    };
  }
  return out;
}

/**
 * Weighted numbers from the answers. Each avatar counts by its weight; the
 * estimated % watched assumes beats of equal length (as split), the hook
 * counted as the first slice.
 */
export function aggregate(avatars, feed, story, beatCount) {
  const total = avatars.reduce((n, a) => n + a.weight, 0) || 1;
  const w = (pred) => avatars.filter(pred).reduce((n, a) => n + a.weight, 0);
  const clicked = (a) => feed[a.id] && feed[a.id].click !== 'no';
  const clickShare = (w((a) => feed[a.id]?.click === 'yes') + 0.5 * w((a) => feed[a.id]?.click === 'maybe')) / total;
  const clickers = w(clicked);
  const stayed = w((a) => clicked(a) && feed[a.id].stay === true);
  const hookHold = clickers ? stayed / clickers : null;

  // Attention per beat among those still watching, and where people left.
  const curve = [];
  const leaves = [];
  for (let i = 0; i < beatCount; i++) {
    const at = avatars.filter((a) => story[a.id]?.beats.some((b) => b.i === i));
    const weight = at.reduce((n, a) => n + a.weight, 0);
    const att = weight ? at.reduce((n, a) => n + story[a.id].beats.find((b) => b.i === i).attention * a.weight, 0) / weight : null;
    const emotions = {};
    for (const a of at) {
      const e = story[a.id].beats.find((b) => b.i === i).emotion.toLowerCase();
      if (e) emotions[e] = (emotions[e] ?? 0) + a.weight;
    }
    const left = at.filter((a) => story[a.id].leftAt === i);
    curve.push({ i, watching: clickers ? weight / clickers : 0, attention: att, emotion: Object.entries(emotions).sort((x, y) => y[1] - x[1])[0]?.[0] ?? '' });
    if (left.length) leaves.push({ i, share: clickers ? left.reduce((n, a) => n + a.weight, 0) / clickers : 0, who: left.map((a) => a.id) });
  }

  // Estimated share of the video watched, among clickers.
  const slices = beatCount + 1; // hook + beats
  let watched = 0;
  for (const a of avatars.filter(clicked)) {
    const f = feed[a.id];
    let frac;
    if (f.stay !== true) frac = (Math.min(f.leaveAt ?? 15, 30) / 30) / slices;
    else if (!story[a.id]) frac = 1 / slices;
    else if (story[a.id].leftAt != null) frac = (1 + story[a.id].leftAt + 0.5) / slices;
    else frac = (1 + story[a.id].beats.length) / slices;
    watched += Math.min(1, frac) * a.weight;
  }
  const finishers = avatars.filter((a) => story[a.id]?.end);
  const fw = finishers.reduce((n, a) => n + a.weight, 0);
  const endShare = (key) => (fw ? finishers.filter((a) => story[a.id].end[key]).reduce((n, a) => n + a.weight, 0) / fw : null);
  return {
    clickShare,
    hookHold,
    watchedShare: clickers ? watched / clickers : null,
    finishShare: clickers ? fw / clickers : null,
    score: fw ? finishers.reduce((n, a) => n + (story[a.id].end.score ?? 5) * a.weight, 0) / fw : null,
    like: endShare('like'),
    subscribe: endShare('subscribe'),
    share: endShare('share'),
    watchNext: endShare('watchNext'),
    curve,
    leaves: leaves.sort((x, y) => y.share - x.share),
    counts: { avatars: avatars.length, clicked: avatars.filter(clicked).length, stayed: avatars.filter((a) => clicked(a) && feed[a.id].stay === true).length, finished: finishers.length },
  };
}

const p = (x) => (x == null ? 'n/a' : `${Math.round(x * 100)}%`);
const clock = (sec) => (sec == null ? '' : `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`);

/** The results as text, for the "what to change" call and for copying. */
export function reportText({ avatars, feed, story, result, material }) {
  const name = Object.fromEntries(avatars.map((a) => [a.id, a]));
  const lines = [
    `Viewers: ${avatars.length}. Would click: ${p(result.clickShare)} (weighted). Stay past the hook: ${p(result.hookHold)} of clickers. Estimated share watched: ${p(result.watchedShare)}. Reach the end: ${p(result.finishShare)}.`,
    result.score != null && `Among those who finished: score ${result.score.toFixed(1)}/10, like ${p(result.like)}, subscribe ${p(result.subscribe)}, share ${p(result.share)}, watch another ${p(result.watchNext)}.`,
    '',
    'Feed and hook:',
    ...avatars.map((a) => {
      const f = feed[a.id];
      if (!f) return null;
      const share = `${Math.round(a.weight * 100)}% of audience`;
      const who = [a.age, a.occupation, share].filter(Boolean).join(', ');
      const parts = [
        `click ${f.click}.`,
        f.firstThought && `"${f.firstThought}"`,
        f.clickWhy,
        f.stay === false && `Left the hook at ${f.leaveAt ?? '?'}s${f.hookWhy ? `: ${f.hookWhy}` : '.'}`,
        f.stay === true && `Stayed past the hook${f.hookFeeling ? ` (${f.hookFeeling})` : ''}${f.hookWhy ? `: ${f.hookWhy}` : '.'}`,
      ].filter(Boolean);
      return `- ${a.name} (${who}): ${parts.join(' ')}`;
    }).filter(Boolean),
  ];
  if (material.beats.length) {
    lines.push('', 'Beats (attention among those still watching, main emotion, who left):');
    for (const c of result.curve) {
      const b = material.beats[c.i];
      const left = result.leaves.find((l) => l.i === c.i);
      lines.push(`- Beat ${c.i}${b.start != null ? ` (${clock(b.start)})` : ''} "${b.first}": attention ${c.attention == null ? 'n/a' : c.attention.toFixed(1)}/10, ${c.emotion || '—'}${left ? `; left here: ${left.who.map((id) => name[id]?.name).join(', ')}` : ''}`);
    }
    lines.push('', 'Thoughts during the video:');
    for (const a of avatars) {
      const st = story[a.id];
      if (!st) continue;
      const notable = st.beats.filter((b) => b.leave || b.attention <= 4 || b.attention >= 9).slice(0, 4);
      for (const b of notable) lines.push(`- ${a.name}, beat ${b.i} (${[`${b.attention}/10`, b.emotion, b.leave && 'LEFT'].filter(Boolean).join(', ')})${b.thought ? `: "${b.thought}"` : ''}`);
      if (st.end?.comment) lines.push(`- ${a.name}'s comment: "${st.end.comment}"`);
      if (st.end?.tellFriend) lines.push(`- ${a.name} would tell a friend: "${st.end.tellFriend}"`);
    }
  }
  return lines.filter((l) => l !== false && l != null).join('\n');
}

// ---------- title A/B ----------

export const LETTERS = 'ABCD';

/** Cleans the title test answers: per viewer, one vote per title letter. */
export function cleanTitleVotes(arr, avatars, titleCount) {
  const ids = new Set(avatars.map((a) => a.id));
  const out = {};
  for (const r of arr) {
    const id = s(r.id, 40);
    if (!ids.has(id)) continue;
    const votes = {};
    for (const v of Array.isArray(r.votes) ? r.votes : []) {
      const k = String(v.title ?? '').trim().toUpperCase().charAt(0);
      const i = LETTERS.indexOf(k);
      if (i < 0 || i >= titleCount || votes[i]) continue;
      const click = ['yes', 'maybe', 'no'].includes(String(v.click).toLowerCase()) ? String(v.click).toLowerCase() : 'no';
      votes[i] = { click, thought: s(v.thought, 240) };
    }
    out[id] = { votes, favorite: LETTERS.indexOf(String(r.favorite ?? '').trim().toUpperCase().charAt(0)) };
  }
  return out;
}

/**
 * Per title: weighted click share ("maybe" counts half), who'd click, and
 * who it wins over (would click this title and not every other one).
 * Returns { titles: [...], winner }.
 */
export function scoreTitles(avatars, votes, titles) {
  const total = avatars.reduce((n, a) => n + a.weight, 0) || 1;
  const v = (a, i) => votes[a.id]?.votes[i]?.click ?? 'no';
  const rows = titles.map((title, i) => {
    const yes = avatars.filter((a) => v(a, i) === 'yes');
    const maybe = avatars.filter((a) => v(a, i) === 'maybe');
    const share = (yes.reduce((n, a) => n + a.weight, 0) + 0.5 * maybe.reduce((n, a) => n + a.weight, 0)) / total;
    const winsOver = avatars.filter((a) => v(a, i) !== 'no' && titles.some((_, j) => j !== i && v(a, j) === 'no'));
    const favorites = avatars.filter((a) => votes[a.id]?.favorite === i);
    return { title, letter: LETTERS[i], clickShare: share, yes: yes.map((a) => a.id), maybe: maybe.map((a) => a.id), winsOver: winsOver.map((a) => a.id), favorites: favorites.map((a) => a.id), favoriteShare: favorites.reduce((n, a) => n + a.weight, 0) / total };
  });
  const best = [...rows].sort((a, b) => b.clickShare - a.clickShare || b.favoriteShare - a.favoriteShare)[0];
  const tie = rows.filter((r) => Math.abs(r.clickShare - best.clickShare) < 0.05).length > 1;
  return { titles: rows, winner: best?.letter ?? null, close: tie };
}

// ---------- two runs, combined ----------

const mean = (xs) => {
  const v = xs.filter((x) => x != null && Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

/**
 * Averages several runs' aggregate() results. `spread` is the largest
 * difference between runs for the headline numbers, to show how steady
 * they are.
 */
export function combineResults(results) {
  if (results.length === 1) return results[0];
  const keys = ['clickShare', 'hookHold', 'watchedShare', 'finishShare', 'score', 'like', 'subscribe', 'share', 'watchNext'];
  const out = Object.fromEntries(keys.map((k) => [k, mean(results.map((r) => r[k]))]));
  const range = (k) => {
    const v = results.map((r) => r[k]).filter((x) => x != null);
    return v.length > 1 ? Math.max(...v) - Math.min(...v) : null;
  };
  out.spread = Object.fromEntries(['clickShare', 'hookHold', 'watchedShare', 'finishShare'].map((k) => [k, range(k)]));
  const beats = Math.max(...results.map((r) => r.curve.length));
  out.curve = Array.from({ length: beats }, (_, i) => {
    const at = results.map((r) => r.curve[i]).filter(Boolean);
    const emotions = at.map((c) => c.emotion).filter(Boolean);
    return { i, watching: mean(at.map((c) => c.watching)) ?? 0, attention: mean(at.map((c) => c.attention)), emotion: emotions[0] ?? '' };
  });
  const leaves = {};
  for (const r of results) {
    for (const l of r.leaves) {
      leaves[l.i] ??= { i: l.i, share: 0, who: [] };
      leaves[l.i].share += l.share / results.length;
      leaves[l.i].who = [...new Set([...leaves[l.i].who, ...l.who])];
    }
  }
  out.leaves = Object.values(leaves).sort((a, b) => b.share - a.share);
  const sum = (k) => results.reduce((n, r) => n + (r.counts?.[k] ?? 0), 0);
  out.counts = { avatars: results[0].counts.avatars * results.length, clicked: sum('clicked'), stayed: sum('stayed'), finished: sum('finished') };
  out.passes = results.length;
  return out;
}
