// TTL cache: an in-memory Map in front of chrome.storage.local, so results
// survive the service worker being suspended.

const PREFIX = 'cache:';
const memory = new Map();

export async function getMany(keys) {
  const out = new Map();
  const missing = [];
  const now = Date.now();
  for (const k of keys) {
    const hit = memory.get(k);
    if (hit && hit.exp > now) out.set(k, hit.value);
    else missing.push(k);
  }
  if (missing.length) {
    const stored = await chrome.storage.local.get(missing.map((k) => PREFIX + k));
    for (const k of missing) {
      const hit = stored[PREFIX + k];
      if (hit && hit.exp > now) {
        memory.set(k, hit);
        out.set(k, hit.value);
      }
    }
  }
  return out;
}

export async function get(key) {
  return (await getMany([key])).get(key);
}

export async function setMany(entries, ttlMs) {
  const exp = Date.now() + ttlMs;
  const toStore = {};
  for (const [k, value] of entries) {
    const rec = { value, exp };
    memory.set(k, rec);
    toStore[PREFIX + k] = rec;
  }
  await chrome.storage.local.set(toStore);
}

export function set(key, value, ttlMs) {
  return setMany([[key, value]], ttlMs);
}

export async function prune({ all = false } = {}) {
  const now = Date.now();
  const everything = await chrome.storage.local.get(null);
  const stale = Object.entries(everything)
    .filter(([k, v]) => k.startsWith(PREFIX) && (all || !(v?.exp > now)))
    .map(([k]) => k);
  if (stale.length) await chrome.storage.local.remove(stale);
  if (all) memory.clear();
  return stale.length;
}

// Removes cached entries whose key starts with `prefix` (e.g. private analytics on sign-out).
export async function removePrefix(prefix) {
  for (const k of memory.keys()) if (k.startsWith(prefix)) memory.delete(k);
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter((k) => k.startsWith(PREFIX + prefix));
  if (keys.length) await chrome.storage.local.remove(keys);
}
