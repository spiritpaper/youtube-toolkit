// Video downloads through the optional companion app (a native messaging
// host, see companion/ and docs/guides/video-downloads.md). The extension
// never downloads anything itself: it asks the companion, which runs the
// downloader with a fixed set of options and reports progress.
// Download history lives in storage under `downloads` (newest first).

const HOST = 'com.spiritpaper.yt_toolkit';
const MAX_HISTORY = 60;

let port = null;
let helloWaiters = [];

export async function companionAllowed() {
  return chrome.permissions.contains({ permissions: ['nativeMessaging'] }).catch(() => false);
}

function connect() {
  if (port) return port;
  if (!chrome.runtime.connectNative) throw new Error('Turn on video downloads in Settings first.');
  port = chrome.runtime.connectNative(HOST);
  port.onMessage.addListener(onMessage);
  port.onDisconnect.addListener(() => {
    const why = chrome.runtime.lastError?.message ?? 'The companion closed.';
    port = null;
    for (const w of helloWaiters) w.reject(new Error(notInstalled(why) ? 'The companion app isn\'t installed (or not for this copy of YT Toolkit).' : why));
    helloWaiters = [];
    // Anything still running can't report back any more.
    mutate((list) => {
      for (const d of list) if (d.status === 'running' || d.status === 'queued') Object.assign(d, { status: 'error', error: `Stopped: ${why}` });
    });
  });
  return port;
}

const notInstalled = (msg) => /not found|forbidden|Specified native messaging host/i.test(msg);

// Serialized writes to the download list.
let chain = Promise.resolve();
function mutate(fn) {
  const run = chain.then(async () => {
    const { downloads = [] } = await chrome.storage.local.get('downloads');
    const result = fn(downloads);
    await chrome.storage.local.set({ downloads: downloads.slice(0, MAX_HISTORY) });
    return result;
  });
  chain = run.catch(() => {});
  return run;
}

// Progress arrives several times a second; write it at most every 700 ms per job.
const lastWrite = new Map();
function onMessage(msg) {
  if (msg.type === 'hello') {
    chrome.storage.local.set({ companion: { ...msg, checkedAt: Date.now() } });
    for (const w of helloWaiters) w.resolve(msg);
    helloWaiters = [];
    return;
  }
  if (!msg.job) return;
  if (msg.type === 'progress') {
    const now = Date.now();
    if (now - (lastWrite.get(msg.job) ?? 0) < 700 && msg.percent < 100) return;
    lastWrite.set(msg.job, now);
  }
  mutate((list) => {
    const d = list.find((x) => x.job === msg.job);
    if (!d) return;
    if (msg.type === 'progress') Object.assign(d, { status: 'running', percent: msg.percent, speed: msg.speed, eta: msg.eta });
    if (msg.type === 'done') Object.assign(d, { status: 'done', percent: 100, file: msg.file, finishedAt: Date.now() });
    if (msg.type === 'error') Object.assign(d, { status: 'error', error: msg.message, finishedAt: Date.now() });
    if (msg.type === 'cancelled') Object.assign(d, { status: 'cancelled', finishedAt: Date.now() });
  });
}

/** Asks the companion for its version, the downloader's, ffmpeg and the folder. */
export async function companionHello() {
  if (!(await companionAllowed())) return { enabled: false };
  const reply = new Promise((resolve, reject) => {
    helloWaiters.push({ resolve, reject });
    setTimeout(() => reject(new Error('The companion didn\'t answer.')), 8000);
  });
  try {
    connect().postMessage({ type: 'hello' });
    return { enabled: true, ...(await reply) };
  } catch (err) {
    return { enabled: true, error: err.message };
  }
}

/**
 * Starts a download. kind: "video" | "audio"; start/end (seconds) for a clip.
 * `title` is only for the list. Returns the job id.
 */
export async function startDownload({ url, kind = 'video', start = null, end = null, title = '' }) {
  if (!(await companionAllowed())) throw new Error('Turn on video downloads in Settings first.');
  const { downloadsAcknowledged } = await chrome.storage.local.get('downloadsAcknowledged');
  if (!downloadsAcknowledged) throw Object.assign(new Error('Confirm the downloads notice first.'), { reason: 'notAcknowledged' });
  const job = `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  await mutate((list) => {
    list.unshift({ job, url, kind, start, end, title: String(title).slice(0, 200), status: 'queued', percent: 0, at: Date.now() });
  });
  connect().postMessage({ type: 'download', job, url, kind, ...(start != null ? { start, end } : {}) });
  return job;
}

export function cancelDownload(job) {
  port?.postMessage({ type: 'cancel', job });
  return true;
}

export function revealDownload(file = '') {
  connect().postMessage({ type: 'reveal', file });
  return true;
}

export function updateDownloader() {
  connect().postMessage({ type: 'update' });
  return true;
}

export function clearDownloads() {
  return mutate((list) => {
    const keep = list.filter((d) => d.status === 'running' || d.status === 'queued');
    list.length = 0;
    list.push(...keep);
  });
}
