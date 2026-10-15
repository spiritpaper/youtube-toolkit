// Keyword rabbit holes: a tree of explored keywords. A small index
// (`explore:index`) holds every node's metadata; each node's search results
// live in their own key (`xn:<id>`) so old explorations can be deleted
// without rewriting everything. Writes happen only in the background worker.

const INDEX = 'explore:index';
export const NODE_PREFIX = 'xn:';

let chain = Promise.resolve();
function mutate(fn) {
  const run = chain.then(async () => {
    const { [INDEX]: index = {} } = await chrome.storage.local.get(INDEX);
    const result = await fn(index);
    await chrome.storage.local.set({ [INDEX]: index });
    return result;
  });
  chain = run.catch(() => {}); // one failed write must not block the ones after it
  return run;
}

export async function listNodes() {
  const { [INDEX]: index = {} } = await chrome.storage.local.get(INDEX);
  return index;
}

export async function getNode(id) {
  const key = NODE_PREFIX + id;
  const [index, data] = await Promise.all([listNodes(), chrome.storage.local.get(key)]);
  return index[id] ? { ...index[id], ...(data[key] ?? {}) } : null;
}

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/**
 * Stores an exploration as a child of `parentId` (or a new root). Re-exploring
 * the same keyword under the same parent updates that node instead.
 */
export function addNode({ parentId = null, exploration }) {
  return mutate(async (index) => {
    const parent = parentId ? index[parentId] : null;
    const kw = exploration.keyword.toLowerCase();
    const existing = Object.values(index).find(
      (n) => (n.parentId ?? null) === (parent?.id ?? null) && n.keyword.toLowerCase() === kw,
    );
    const id = existing?.id ?? newId();
    const now = Date.now();
    index[id] = {
      id,
      parentId: parent?.id ?? null,
      rootId: parent ? parent.rootId : id,
      depth: parent ? parent.depth + 1 : 0,
      keyword: exploration.keyword,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      source: exploration.source,
      metrics: exploration.metrics,
      starred: existing?.starred ?? false,
      notes: existing?.notes ?? '',
    };
    if (parent) index[parent.rootId].updatedAt = now; // keeps the whole hole "recent"
    const { results, related, aiAngles } = exploration;
    await chrome.storage.local.set({ [NODE_PREFIX + id]: { results, related, aiAngles: aiAngles ?? null } });
    return index[id];
  });
}

export function updateNode(id, patch) {
  return mutate(async (index) => {
    if (!index[id]) return null;
    const { aiAngles, ...meta } = patch;
    index[id] = { ...index[id], ...meta };
    if (aiAngles !== undefined) {
      const key = NODE_PREFIX + id;
      const { [key]: data = {} } = await chrome.storage.local.get(key);
      await chrome.storage.local.set({ [key]: { ...data, aiAngles } });
    }
    return index[id];
  });
}

const subtree = (index, id) => {
  const ids = [id];
  for (let i = 0; i < ids.length; i++) {
    for (const n of Object.values(index)) if (n.parentId === ids[i]) ids.push(n.id);
  }
  return ids;
};

// Deletes the given nodes and everything below them. Returns the count.
export function deleteNodes(ids) {
  return mutate(async (index) => {
    const doomed = new Set(ids.filter((id) => index[id]).flatMap((id) => subtree(index, id)));
    for (const id of doomed) delete index[id];
    await chrome.storage.local.remove([...doomed].map((id) => NODE_PREFIX + id));
    return doomed.size;
  });
}

// Deletes whole rabbit holes whose most recent activity is older than `days`.
export async function deleteHolesOlderThan(days) {
  const cutoff = Date.now() - days * 86_400_000;
  const index = await listNodes();
  const lastActivity = new Map();
  for (const n of Object.values(index)) {
    lastActivity.set(n.rootId, Math.max(lastActivity.get(n.rootId) ?? 0, n.updatedAt ?? n.createdAt));
  }
  const roots = [...lastActivity].filter(([, t]) => t < cutoff).map(([id]) => id);
  return roots.length ? deleteNodes(roots) : 0;
}

export async function deleteAllNodes() {
  const index = await listNodes();
  return deleteNodes(Object.values(index).filter((n) => !n.parentId).map((n) => n.id));
}
