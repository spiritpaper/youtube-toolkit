// Updating an audience group from real data: the AI proposes edits, new
// avatars, retirements and new audience shares; the creator picks what to
// apply. Pure functions; the page gathers the data and asks.

import { normalizeAvatar, normalizeWeights, MAX_COUNT } from './avatars.js';

// Fields an update may change (identity stays: id, name, source).
export const EDITABLE = ['age', 'gender', 'location', 'occupation', 'lifeStage', 'interests', 'knowledge', 'wants', 'beliefs', 'frustrations', 'moves', 'turnoffs', 'device', 'discovery', 'relationship', 'habits', 'commentStyle', 'quote', 'basedOn'];

const s = (v, max = 400) => (v == null ? '' : String(v).trim().slice(0, max));
const same = (a, b) => JSON.stringify(a ?? '') === JSON.stringify(b ?? '');

/**
 * Cleans the AI's proposal against the current avatars:
 * { edits: [{ id, patch, reason }], add: [{ avatar, reason }], retire: [{ id, reason }], weights: { id: w }, summary }.
 * Patches keep only editable fields that actually change.
 */
export function cleanProposal(obj, avatars) {
  const byId = Object.fromEntries(avatars.map((a) => [a.id, a]));
  const edits = [];
  for (const e of Array.isArray(obj?.edits) ? obj.edits : []) {
    const cur = byId[s(e.id, 40)];
    if (!cur || !e.changes || typeof e.changes !== 'object') continue;
    // Normalize through the avatar cleaner so values are bounded and well-formed.
    const merged = normalizeAvatar({ ...cur, ...Object.fromEntries(Object.entries(e.changes).filter(([k]) => EDITABLE.includes(k))) }, { source: cur.source });
    const patch = Object.fromEntries(EDITABLE.filter((k) => k in e.changes && !same(merged[k], cur[k])).map((k) => [k, merged[k]]));
    if (Object.keys(patch).length) edits.push({ id: cur.id, patch, reason: s(e.reason) });
  }
  const add = (Array.isArray(obj?.add) ? obj.add : []).slice(0, 5).map((x) => ({ avatar: normalizeAvatar(x.avatar ?? x, { source: 'ai' }), reason: s(x.reason) })).filter((x) => x.avatar.name && x.avatar.name !== 'Unnamed viewer');
  const retire = (Array.isArray(obj?.retire) ? obj.retire : []).map((r) => ({ id: s(r.id, 40), reason: s(r.reason) })).filter((r) => byId[r.id]);
  const weights = {};
  for (const [id, w] of Object.entries(obj?.weights ?? {})) if (byId[id] && Number(w) > 0) weights[id] = Number(w);
  return { edits, add, retire, weights, summary: s(obj?.summary, 2000) };
}

/** The changed fields of an edit, for showing before → after. */
export function diffEdit(avatar, patch) {
  const show = (v) => (Array.isArray(v) ? v.join(' · ') : v == null || v === '' ? '—' : String(v));
  return Object.keys(patch).map((field) => ({ field, before: show(avatar[field]), after: show(patch[field]) }));
}

/**
 * Applies the accepted parts. `accept`: { edits: Set(id), add: Set(index),
 * retire: Set(id), weights: boolean }. Returns the new avatar list (weights
 * rebalanced to 1, capped at MAX_COUNT) and a short revision record.
 */
export function applyProposal(avatars, proposal, accept) {
  let list = avatars.map((a) => {
    const e = proposal.edits.find((x) => x.id === a.id && accept.edits.has(x.id));
    return e ? { ...a, ...e.patch } : { ...a };
  });
  list = list.filter((a) => !accept.retire.has(a.id));
  if (accept.weights) list = list.map((a) => (proposal.weights[a.id] ? { ...a, weight: proposal.weights[a.id] } : a));
  const added = proposal.add.filter((_, i) => accept.add.has(i)).map((x) => x.avatar);
  // A new avatar gets the average share, so it neither dominates nor vanishes.
  const avg = list.length ? list.reduce((n, a) => n + a.weight, 0) / list.length : 1;
  list = [...list, ...added.map((a) => ({ ...a, weight: a.weight > 0 && a.weight < 1 ? a.weight : avg }))].slice(0, MAX_COUNT);
  return {
    avatars: normalizeWeights(list),
    revision: {
      edited: [...accept.edits].length,
      added: added.length,
      retired: [...accept.retire].length,
      weights: !!accept.weights && Object.keys(proposal.weights).length > 0,
      summary: proposal.summary.slice(0, 600),
    },
  };
}
