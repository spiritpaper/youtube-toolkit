// Everything the notebook holds, as one list of items for showing, filtering
// and recalling: notes on videos, lessons (yours and from checked
// screenings) and experiments.

import { send } from '../lib/ui.js';
import { formatTime } from '../lib/stats.js';
import { noteTags, screeningLessons } from '../lib/notebook.js';

/**
 * [{ id, kind: 'note'|'lesson'|'auto-lesson'|'experiment', text, tags, title,
 *    href, sub, at, raw }], newest first. hrefs are relative to src/.
 */
export async function loadItems() {
  const [all, nb, sims] = await Promise.all([
    chrome.storage.local.get(null),
    send({ type: 'notebook' }).catch(() => ({ lessons: {}, experiments: {} })),
    send({ type: 'screenings' }).catch(() => []),
  ]);
  const items = [];
  for (const [k, e] of Object.entries(all)) {
    if (!k.startsWith('sn:') || !e?.notes?.length) continue;
    const analyzed = !!all[`tx:${e.videoId}`];
    for (const n of e.notes) {
      items.push({
        id: n.id, kind: 'note', text: n.text, tags: noteTags(n.text), title: e.title || e.videoId,
        sub: `${e.title || e.videoId} · ${formatTime(n.t)}`,
        href: `https://www.youtube.com/watch?v=${e.videoId}&t=${n.t}s`,
        lab: analyzed ? `script/script.html?id=${e.videoId}#notes` : null,
        videoId: e.videoId, t: n.t, at: n.updatedAt ?? n.createdAt ?? 0, raw: n,
      });
    }
  }
  for (const l of Object.values(nb.lessons)) {
    items.push({ id: l.id, kind: 'lesson', text: l.text, tags: l.tags ?? [], title: 'Lesson', sub: l.source?.title ? `From "${l.source.title}"` : 'Your lesson', href: l.source?.projectId ? `project/project.html?id=${l.source.projectId}#accuracy` : null, at: l.updatedAt ?? l.createdAt, raw: l });
  }
  const kept = new Set(Object.values(nb.lessons).map((l) => l.source?.autoId).filter(Boolean));
  for (const sim of sims.filter((s) => s.accuracyNotes?.text)) {
    for (const l of screeningLessons(sim)) {
      if (kept.has(l.id)) continue;
      items.push({ id: l.id, kind: 'auto-lesson', text: l.text, tags: [], title: 'Lesson', sub: `Forecast vs reality · "${l.source.title}"`, href: `project/project.html?id=${l.source.projectId}#accuracy`, at: l.createdAt, raw: l });
    }
  }
  for (const x of Object.values(nb.experiments)) {
    items.push({ id: x.id, kind: 'experiment', text: [x.hypothesis, x.change, x.conclusion].filter(Boolean).join('\n'), tags: x.tags ?? [], title: x.hypothesis, sub: `Experiment · ${STATUS_LABEL[x.status] ?? x.status}`, href: `notebook/notebook.html#x=${x.id}`, at: x.updatedAt ?? x.createdAt, raw: x });
  }
  return items.sort((a, b) => b.at - a.at);
}

export const STATUS_LABEL = { running: 'running', confirmed: 'confirmed', 'not-confirmed': 'not confirmed', unclear: 'unclear' };
export const KIND_LABEL = { note: 'Note', lesson: 'Lesson', 'auto-lesson': 'Lesson', experiment: 'Experiment' };
