// Avatar groups in storage (`avatars`), written only in the background worker
// with serialized writes. See avatars.js for the avatar shape.

import { normalizeAvatar, normalizeWeights, newId, MAX_COUNT } from './avatars.js';

let chain = Promise.resolve();
function mutate(fn) {
  const run = chain.then(async () => {
    const { avatars = {} } = await chrome.storage.local.get('avatars');
    const result = fn(avatars);
    await chrome.storage.local.set({ avatars });
    return result;
  });
  chain = run.catch(() => {}); // one failed write must not block the ones after it
  return run;
}

export async function listGroups() {
  const { avatars = {} } = await chrome.storage.local.get('avatars');
  return avatars;
}

const group = (all, id) => {
  const g = all[id];
  if (!g) throw new Error('This audience group was deleted.');
  return g;
};

/** Creates a group, or replaces an existing one's details and avatars. */
export function saveGroup({ id, name, focus = '', source = { kind: 'manual' }, basis = '', avatars = [] }) {
  return mutate((all) => {
    const now = Date.now();
    const gid = id && all[id] ? id : newId('g');
    const prev = all[gid];
    all[gid] = {
      id: gid,
      name: String(name ?? prev?.name ?? 'My audience').trim().slice(0, 80) || 'My audience',
      focus: String(focus ?? prev?.focus ?? '').slice(0, 300),
      source,
      basis: String(basis ?? prev?.basis ?? '').slice(0, 20000),
      avatars: normalizeWeights(avatars.slice(0, MAX_COUNT).map((a) => normalizeAvatar(a, { source: a.source }))),
      createdAt: prev?.createdAt ?? now,
      updatedAt: now,
    };
    return all[gid];
  });
}

export function deleteGroup(id) {
  return mutate((all) => {
    delete all[id];
    return true;
  });
}

/** Adds or updates one avatar (by id). */
export function saveAvatar(groupId, avatar) {
  return mutate((all) => {
    const g = group(all, groupId);
    const a = normalizeAvatar(avatar, { source: avatar.source });
    const i = g.avatars.findIndex((x) => x.id === a.id);
    if (i >= 0) g.avatars[i] = a;
    else if (g.avatars.length >= MAX_COUNT) throw new Error(`A group can have up to ${MAX_COUNT} avatars.`);
    else g.avatars.push(a);
    g.avatars = normalizeWeights(g.avatars);
    g.updatedAt = Date.now();
    return g;
  });
}

export function deleteAvatar(groupId, avatarId) {
  return mutate((all) => {
    const g = group(all, groupId);
    g.avatars = normalizeWeights(g.avatars.filter((a) => a.id !== avatarId));
    g.updatedAt = Date.now();
    return g;
  });
}
