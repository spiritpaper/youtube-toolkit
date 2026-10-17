// Ask your audience: pitch ideas to an avatar group before writing anything,
// and follow up in a chat. Saved with the screenings (`sim:<id>`), as kind
// "pitch" or "chat".

const s = (v, max = 300) => (v == null ? '' : String(v).trim().slice(0, max));
const INTEREST = ['yes', 'maybe', 'no'];

/** The JSON object in a model's answer (fenced or not), or throws. */
export function extractJsonObject(text) {
  const t = String(text ?? '');
  for (const c of [/```(?:json)?\s*([\s\S]*?)```/i.exec(t)?.[1], t].filter(Boolean)) {
    const start = c.indexOf('{');
    const end = c.lastIndexOf('}');
    if (start < 0 || end <= start) continue;
    try {
      const obj = JSON.parse(c.slice(start, end + 1));
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) return obj;
    } catch {
      // next candidate
    }
  }
  throw new Error('The AI answered in an unexpected format. Try again.');
}

/** One-line pitches from a text box: one per line, up to 4. */
export const parsePitches = (text) => String(text ?? '').split('\n').map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim()).filter((l) => l.length > 3).slice(0, 4);

/** Cleans the pitch answers: { viewers: { id: { answers: { i: {...} } } }, takeaways }. */
export function cleanPitch(obj, avatars, pitchCount) {
  const ids = new Set(avatars.map((a) => a.id));
  const viewers = {};
  for (const v of Array.isArray(obj?.viewers) ? obj.viewers : []) {
    const id = s(v.id, 40);
    if (!ids.has(id)) continue;
    const answers = {};
    for (const a of Array.isArray(v.pitches) ? v.pitches : []) {
      const i = Math.round(Number(a.pitch)) - 1;
      if (!(i >= 0 && i < pitchCount) || answers[i]) continue;
      const interest = INTEREST.includes(String(a.interest).toLowerCase()) ? String(a.interest).toLowerCase() : 'no';
      answers[i] = { interest, why: s(a.why), expect: s(a.expect), instead: s(a.instead) };
    }
    viewers[id] = { answers };
  }
  return { viewers, takeaways: s(obj?.takeaways, 4000) };
}

/** Per pitch: weighted interest ("maybe" counts half), who's in, who it wins over. */
export function scorePitches(avatars, viewers, pitches) {
  const total = avatars.reduce((n, a) => n + a.weight, 0) || 1;
  const at = (a, i) => viewers[a.id]?.answers[i]?.interest ?? 'no';
  const rows = pitches.map((pitch, i) => {
    const yes = avatars.filter((a) => at(a, i) === 'yes');
    const maybe = avatars.filter((a) => at(a, i) === 'maybe');
    return {
      pitch,
      i,
      interest: (yes.reduce((n, a) => n + a.weight, 0) + 0.5 * maybe.reduce((n, a) => n + a.weight, 0)) / total,
      yes: yes.map((a) => a.id),
      maybe: maybe.map((a) => a.id),
      winsOver: avatars.filter((a) => at(a, i) !== 'no' && pitches.some((_, j) => j !== i && at(a, j) === 'no')).map((a) => a.id),
      expectations: avatars.map((a) => viewers[a.id]?.answers[i]?.expect).filter(Boolean),
      wishes: avatars.map((a) => viewers[a.id]?.answers[i]?.instead).filter(Boolean),
    };
  });
  const best = [...rows].sort((a, b) => b.interest - a.interest)[0];
  return { pitches: rows, best: best?.i ?? null, close: rows.filter((r) => best && Math.abs(r.interest - best.interest) < 0.05).length > 1 };
}

/** Cleans chat replies: [{ id, reply }] for known avatars, with something to say. */
export function cleanReplies(arr, avatars) {
  const ids = new Set(avatars.map((a) => a.id));
  return (Array.isArray(arr) ? arr : [])
    .map((r) => ({ id: s(r.id, 40), reply: s(r.reply, 1200) }))
    .filter((r) => ids.has(r.id) && r.reply && !/^(null|none|-)$/i.test(r.reply));
}

/** The conversation so far, for the prompt (last `max` messages). */
export function historyText(messages, names, max = 14) {
  return messages.slice(-max).map((m) => (m.from === 'you' ? `CREATOR: ${m.text}` : `${names[m.from] ?? 'Viewer'}: ${m.text}`)).join('\n');
}
