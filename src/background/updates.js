// Updates without reinstalling.
//
// 1. Self-reload: an unpacked extension runs from its folder, so when new
//    files are copied in (by scripts/update.sh, or by unzipping a release
//    over it), the running copy and the files on disk differ. Every few
//    minutes this compares them and reloads the extension, but only while
//    no YT Toolkit page is open, so nothing you're working in is closed.
// 2. Update notice (public build): once a day, the latest GitHub release is
//    compared with this version; Home and Settings show a notice if newer.

import { compareVersions, stampOf } from '../lib/versions.js';
import { RELEASES_API, RELEASES_PAGE } from '../lib/update-config.js';

const DAY = 86_400_000;

async function diskStamp() {
  const get = async (path) => {
    try {
      const res = await fetch(chrome.runtime.getURL(path), { cache: 'no-store' });
      return res.ok ? await res.json() : null;
    } catch {
      return null; // build.json is optional
    }
  };
  const [build, manifest] = await Promise.all([get('build.json'), get('manifest.json')]);
  return stampOf(build, manifest);
}

/** Records which files this running copy was loaded from (on install, reload and browser start). */
export async function rememberLoadedBuild() {
  await chrome.storage.session.set({ loadedBuild: await diskStamp() });
}

/** Reloads the extension if its files changed on disk and no extension page is open. */
export async function reloadIfUpdated() {
  const { loadedBuild } = await chrome.storage.session.get('loadedBuild');
  const now = await diskStamp();
  if (!loadedBuild) {
    await chrome.storage.session.set({ loadedBuild: now });
    return false;
  }
  if (now === loadedBuild) return false;
  const open = await chrome.runtime.getContexts({ contextTypes: ['TAB', 'POPUP', 'SIDE_PANEL'] }).catch(() => []);
  if (open.length) return false; // try again later, when nothing would be closed
  chrome.runtime.reload();
  return true;
}

/** Checks GitHub for a newer release (at most daily unless forced). Stores `updateAvailable`. */
export async function checkForRelease({ force = false } = {}) {
  if (!RELEASES_API) return null;
  const { updateCheckedAt = 0 } = await chrome.storage.local.get('updateCheckedAt');
  if (!force && Date.now() - updateCheckedAt < DAY) return (await chrome.storage.local.get('updateAvailable')).updateAvailable ?? null;
  const res = await fetch(RELEASES_API, { headers: { accept: 'application/vnd.github+json' } });
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
  const rel = await res.json();
  const current = chrome.runtime.getManifest().version;
  const newer = rel.tag_name && compareVersions(rel.tag_name, current) > 0;
  const zip = (rel.assets ?? []).find((a) => a.name?.endsWith('.zip'));
  const info = newer ? { version: rel.tag_name.replace(/^v/, ''), url: rel.html_url ?? RELEASES_PAGE, zip: zip?.browser_download_url ?? null, notes: (rel.body ?? '').slice(0, 1500) } : null;
  await chrome.storage.local.set({ updateCheckedAt: Date.now(), updateAvailable: info });
  return info;
}
