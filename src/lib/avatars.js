// Audience lab: avatars are fictional but realistic viewers, built from a
// channel's real audience data where there is some. A group of avatars is
// the "panel" a video is test-screened with (stage 2).
//
// Storage (written by the background worker, see avatars-store.js):
//   avatars = { [groupId]: { id, name, basis, source, avatars: [...], createdAt, updatedAt } }

export const DISCOVERY = ['search', 'browse', 'suggested', 'subscriptions', 'shorts', 'external'];
export const RELATIONSHIP = ['subscriber', 'returning', 'new'];
export const KNOWLEDGE = ['new', 'some', 'expert'];
export const DEVICES = ['phone', 'computer', 'tv', 'tablet'];
export const DEFAULT_COUNT = 8;
export const MAX_COUNT = 20;

const str = (v, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : v == null ? '' : String(v).trim().slice(0, max));
const list = (v, max = 6, len = 160) =>
  (Array.isArray(v) ? v : typeof v === 'string' && v.trim() ? v.split(/\s*[;\n]\s*|,\s+(?=[A-Za-z])/) : [])
    .map((x) => str(x, len))
    .filter(Boolean)
    .slice(0, max);
const oneOf = (v, allowed, fallback) => {
  const s = str(v, 40).toLowerCase();
  // "YouTube search" → search, "Subscribed" → subscriber: match on the word's stem.
  return allowed.find((a) => s.startsWith(a)) ?? allowed.find((a) => s.includes(a.slice(0, 6))) ?? fallback;
};

export const newId = (prefix = 'a') => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Cleans one avatar (from the AI or a form) into the stored shape. */
export function normalizeAvatar(raw = {}, { source = 'ai' } = {}) {
  const age = Math.round(Number(raw.age));
  return {
    id: str(raw.id, 40) || newId(),
    name: str(raw.name, 60) || 'Unnamed viewer',
    age: Number.isFinite(age) && age >= 10 && age <= 99 ? age : null,
    gender: str(raw.gender, 30),
    location: str(raw.location, 80),
    occupation: str(raw.occupation ?? raw.job, 100),
    lifeStage: str(raw.lifeStage ?? raw.life_stage, 120),
    interests: list(raw.interests, 8, 60),
    knowledge: oneOf(raw.knowledge, KNOWLEDGE, 'some'),
    wants: str(raw.wants, 300),
    beliefs: list(raw.beliefs, 5),
    frustrations: list(raw.frustrations, 5),
    moves: str(raw.moves ?? raw.triggers, 300),
    turnoffs: str(raw.turnoffs ?? raw.turnOffs, 300),
    device: oneOf(raw.device, DEVICES, 'phone'),
    discovery: oneOf(raw.discovery, DISCOVERY, 'browse'),
    relationship: oneOf(raw.relationship, RELATIONSHIP, 'new'),
    habits: str(raw.habits ?? raw.watchHabits, 300),
    commentStyle: str(raw.commentStyle, 200),
    quote: str(raw.quote ?? raw.voice, 240),
    basedOn: str(raw.basedOn, 240),
    weight: Number.isFinite(Number(raw.weight)) && Number(raw.weight) > 0 ? Number(raw.weight) : 1,
    locked: !!raw.locked,
    source: raw.source === 'manual' || source === 'manual' ? 'manual' : 'ai',
    notes: str(raw.notes, 1000),
  };
}

/** Weights that add up to 1 (shares of the audience each avatar stands for). */
export function normalizeWeights(avatars) {
  const total = avatars.reduce((n, a) => n + (a.weight > 0 ? a.weight : 0), 0);
  if (!total) return avatars.map((a) => ({ ...a, weight: 1 / (avatars.length || 1) }));
  return avatars.map((a) => ({ ...a, weight: Math.round(((a.weight > 0 ? a.weight : 0) / total) * 1000) / 1000 }));
}

/** Finds the JSON array in a model's answer (fenced or not) and cleans every avatar. */
export function parseAvatars(text) {
  const t = String(text ?? '');
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(t)?.[1];
  const candidates = [fenced, t].filter(Boolean);
  for (const c of candidates) {
    const start = c.indexOf('[');
    const end = c.lastIndexOf(']');
    if (start < 0 || end <= start) continue;
    try {
      const arr = JSON.parse(c.slice(start, end + 1));
      if (Array.isArray(arr) && arr.length) return arr.filter((x) => x && typeof x === 'object').map((x) => normalizeAvatar(x));
    } catch {
      // try the next candidate
    }
  }
  throw new Error('The AI answered in an unexpected format. Try again.');
}

/** A regenerated group: locked avatars stay, new ones fill the rest, weights rebalanced. */
export function mergeRegenerated(current, generated, count) {
  const locked = current.filter((a) => a.locked);
  const fresh = generated.filter((g) => !locked.some((l) => l.name === g.name)).slice(0, Math.max(0, count - locked.length));
  return normalizeWeights([...locked, ...fresh]);
}

// ---------- the data sheet the AI builds avatars from ----------

const pct = (x) => `${Math.round(x)}%`;
const TRAFFIC = {
  YT_SEARCH: 'YouTube search', SUGGESTED: 'suggested videos', BROWSE: 'home feed / browse', SUBSCRIBER: 'subscriptions feed',
  SHORTS: 'Shorts feed', EXT_URL: 'external sites', NO_LINK_OTHER: 'direct', PLAYLIST: 'playlists', YT_CHANNEL: 'channel page',
  NOTIFICATION: 'notifications', END_SCREEN: 'end screens',
};

/**
 * Turns what we know about an audience into a compact, factual sheet.
 * profile: audienceProfile() rows (or null); comments: [{ text, likes }];
 * videos: [{ title, views, multiplier }]; niche: channel description;
 * channel: { title, subs }.
 */
export function audienceSheet({ channel = null, niche = '', profile = null, videos = [], comments = [], retention = null }) {
  const lines = [];
  if (channel?.title) lines.push(`Channel: ${channel.title}${channel.subs != null ? ` (${Math.round(channel.subs).toLocaleString('en-US')} subscribers)` : ''}`);
  if (niche) lines.push(`About the channel: ${niche}`);

  const d = profile?.demographics;
  if (d?.length) {
    const byAge = {};
    const byGender = {};
    for (const r of d) {
      const age = String(r.ageGroup).replace('age', '').replace('-', '–');
      byAge[age] = (byAge[age] ?? 0) + r.viewerPercentage;
      byGender[r.gender] = (byGender[r.gender] ?? 0) + r.viewerPercentage;
    }
    lines.push(`Viewer age (share of views, last ${profile.days} days): ${Object.entries(byAge).filter(([, v]) => v >= 1).map(([k, v]) => `${k}: ${pct(v)}`).join(', ')}`);
    lines.push(`Viewer gender: ${Object.entries(byGender).map(([k, v]) => `${k}: ${pct(v)}`).join(', ')}`);
  }
  const total = (rows) => rows.reduce((n, r) => n + (r.views ?? 0), 0) || 1;
  if (profile?.countries?.length) lines.push(`Top countries: ${profile.countries.slice(0, 8).map((r) => `${r.country} ${pct((r.views / total(profile.countries)) * 100)}`).join(', ')}`);
  if (profile?.devices?.length) lines.push(`Devices: ${profile.devices.map((r) => `${String(r.deviceType).toLowerCase()} ${pct((r.views / total(profile.devices)) * 100)}`).join(', ')}`);
  if (profile?.subscribed?.length) {
    const t = total(profile.subscribed);
    lines.push(`Subscribers vs not: ${profile.subscribed.map((r) => `${r.subscribedStatus === 'SUBSCRIBED' ? 'subscribed' : 'not subscribed'} ${pct((r.views / t) * 100)} of views (avg ${Math.round(r.averageViewPercentage)}% watched)`).join(', ')}`);
  }
  if (profile?.traffic?.length) lines.push(`How they find the videos: ${profile.traffic.slice(0, 6).map((r) => `${TRAFFIC[r.insightTrafficSourceType] ?? r.insightTrafficSourceType} ${pct((r.views / total(profile.traffic)) * 100)}`).join(', ')}`);
  if (retention) lines.push(`Average % of a video watched: ${Math.round(retention)}%`);

  if (videos.length) {
    lines.push('', 'Videos (most viewed first):');
    for (const v of videos.slice(0, 12)) lines.push(`- "${v.title}"${v.views != null ? ` · ${Math.round(v.views).toLocaleString('en-US')} views` : ''}${v.multiplier != null ? ` · ${v.multiplier.toFixed(1)}x the channel median` : ''}`);
  }
  if (comments.length) {
    // The most liked first; no author names are ever included.
    const top = [...comments].sort((a, b) => (b.likes ?? 0) - (a.likes ?? 0)).slice(0, 40);
    lines.push('', `Real viewer comments (${top.length}, most liked first; use them for voice, needs and frustrations, never copy them):`);
    for (const c of top) lines.push(`- "${c.text.replace(/\s+/g, ' ').slice(0, 220)}"${c.likes ? ` (${c.likes} likes)` : ''}`);
  }
  return lines.join('\n');
}
