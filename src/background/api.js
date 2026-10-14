// Thin YouTube Data API v3 client. videos, channels and playlistItems cost 1
// quota unit per call; search costs 100. Daily limit: 10,000.

const BASE = 'https://www.googleapis.com/youtube/v3/';
export const DAILY_QUOTA = 10_000;

export class ApiError extends Error {
  constructor(message, { status = 0, reason = '' } = {}) {
    super(message);
    this.status = status;
    this.reason = reason;
  }
}

// Quota resets at midnight Pacific time.
function quotaDay() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
}

// Serialize read-modify-write of the counter so parallel calls don't clobber it.
let quotaChain = Promise.resolve();
function addQuota(units) {
  quotaChain = quotaChain.then(async () => {
    const day = quotaDay();
    const { quota } = await chrome.storage.local.get('quota');
    const used = quota?.day === day ? quota.used : 0;
    await chrome.storage.local.set({ quota: { day, used: used + units } });
  });
  return quotaChain;
}

export async function getQuota() {
  const { quota } = await chrome.storage.local.get('quota');
  return { used: quota?.day === quotaDay() ? quota.used : 0, limit: DAILY_QUOTA };
}

async function apiKey() {
  const { apiKey } = await chrome.storage.local.get('apiKey');
  if (!apiKey) {
    throw new ApiError('Add your YouTube Data API key in the extension popup.', { reason: 'noKey' });
  }
  return apiKey;
}

export async function call(endpoint, params, key, cost = 1) {
  const url = new URL(BASE + endpoint);
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, v);
  url.searchParams.set('key', key ?? (await apiKey()));

  const res = await fetch(url);
  addQuota(cost);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = body.error ?? {};
    let reason = err.errors?.[0]?.reason ?? '';
    if (/API key not valid/i.test(err.message ?? '')) reason = 'keyInvalid';
    const message =
      reason === 'quotaExceeded'
        ? 'Daily YouTube API quota used up. It resets at midnight Pacific time.'
        : reason === 'keyInvalid'
          ? 'Your YouTube API key is invalid. Check it in the extension popup.'
          : reason === 'accessNotConfigured'
            ? 'YouTube Data API v3 is not enabled for this key\'s Google Cloud project.'
            : err.message || `YouTube API error (HTTP ${res.status})`;
    throw new ApiError(message, { status: res.status, reason });
  }
  return body;
}
