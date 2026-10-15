// Your own timestamped notes on a video ("sn:<videoId>"), written from the
// Script lab or the panel on YouTube. Kept even if the video isn't saved, and
// writes are serialized here, in the background worker.

import { formatTime } from './stats.js';

export const NOTES_PREFIX = 'sn:';
const MAX_TEXT = 4000;

/** "3:42", "1:02:03", "90" or "90s" → seconds; null if it isn't a time. */
export function parseTime(input) {
  const s = String(input ?? '').trim().replace(/s$/i, '');
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) return Math.floor(Number(s));
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{1,2})$/.exec(s);
  if (!m) return null;
  const [h, min, sec] = [Number(m[1] ?? 0), Number(m[2]), Number(m[3])];
  if (sec > 59 || (m[1] != null && min > 59)) return null;
  return h * 3600 + min * 60 + sec;
}

export const sortNotes = (notes) => [...notes].sort((a, b) => a.t - b.t || a.createdAt - b.createdAt);

/** The notes as Markdown, for downloading. */
export function notesMarkdown(entry) {
  const url = (t) => `https://www.youtube.com/watch?v=${entry.videoId}&t=${t}s`;
  return [
    `# Notes: ${entry.title || entry.videoId}`,
    '',
    `https://www.youtube.com/watch?v=${entry.videoId}`,
    '',
    ...sortNotes(entry.notes).map((n) => `- [${formatTime(n.t)}](${url(n.t)}) ${n.text.replace(/\n+/g, ' ')}`),
    '',
  ].join('\n');
}

let chain = Promise.resolve();
function mutate(videoId, fn) {
  const key = NOTES_PREFIX + videoId;
  const run = chain.then(async () => {
    const { [key]: entry = { videoId, title: '', notes: [] } } = await chrome.storage.local.get(key);
    const result = fn(entry);
    if (entry.notes.length) {
      entry.updatedAt = Date.now();
      await chrome.storage.local.set({ [key]: entry });
    } else {
      await chrome.storage.local.remove(key);
    }
    return result ?? entry;
  });
  chain = run.catch(() => {}); // one failed write must not block the ones after it
  return run;
}

const cleanText = (text) => {
  const t = String(text ?? '').trim().slice(0, MAX_TEXT);
  if (!t) throw new Error('Write something first.');
  return t;
};
const cleanTime = (t) => {
  const n = typeof t === 'number' ? Math.floor(t) : parseTime(t);
  if (n == null || !Number.isFinite(n) || n < 0) throw new Error('Use a time like 3:42.');
  return n;
};

export async function getNotes(videoId) {
  const key = NOTES_PREFIX + videoId;
  const { [key]: entry } = await chrome.storage.local.get(key);
  return entry ?? { videoId, title: '', notes: [] };
}

/** Every video with notes: [{ videoId, title, count, updatedAt }], newest first. */
export async function listNoted() {
  const all = await chrome.storage.local.get(null);
  return Object.entries(all)
    .filter(([k]) => k.startsWith(NOTES_PREFIX))
    .map(([, e]) => ({ videoId: e.videoId, title: e.title, count: e.notes.length, updatedAt: e.updatedAt ?? 0 }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function addNote(videoId, { t, text, title }) {
  const note = { id: `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, t: cleanTime(t), text: cleanText(text), createdAt: Date.now() };
  return mutate(videoId, (entry) => {
    if (title) entry.title = String(title).slice(0, 200);
    entry.notes = sortNotes([...entry.notes, note]);
  });
}

export async function updateNote(videoId, noteId, patch) {
  const changes = {};
  if ('text' in patch) changes.text = cleanText(patch.text);
  if ('t' in patch) changes.t = cleanTime(patch.t);
  return mutate(videoId, (entry) => {
    const n = entry.notes.find((x) => x.id === noteId);
    if (!n) throw new Error('This note was deleted.');
    Object.assign(n, changes, { updatedAt: Date.now() });
    entry.notes = sortNotes(entry.notes);
  });
}

export function deleteNote(videoId, noteId) {
  return mutate(videoId, (entry) => {
    entry.notes = entry.notes.filter((x) => x.id !== noteId);
  });
}
