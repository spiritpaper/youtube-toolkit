// The lab notebook's own entries ("notebook"): lessons you wrote down and
// experiments. Notes live with their videos ("sn:"), lessons from checked
// screenings with the screenings. Writes are serialized here.

import { noteTags } from './notebook.js';

const KEY = 'notebook';
const newId = (p) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const s = (v, max) => String(v ?? '').trim().slice(0, max);

let chain = Promise.resolve();
function mutate(fn) {
  const run = chain.then(async () => {
    const { [KEY]: nb = { lessons: {}, experiments: {} } } = await chrome.storage.local.get(KEY);
    nb.lessons ??= {};
    nb.experiments ??= {};
    const result = fn(nb);
    await chrome.storage.local.set({ [KEY]: nb });
    return result;
  });
  chain = run.catch(() => {});
  return run;
}

export async function getNotebook() {
  const { [KEY]: nb } = await chrome.storage.local.get(KEY);
  return { lessons: nb?.lessons ?? {}, experiments: nb?.experiments ?? {} };
}

export async function saveLesson({ id, text, source = null }) {
  const t = s(text, 2000);
  if (!t) throw new Error('Write the lesson first.');
  return mutate((nb) => {
    const lid = id && nb.lessons[id] ? id : newId('l');
    const prev = nb.lessons[lid];
    nb.lessons[lid] = { id: lid, text: t, tags: noteTags(t), source: prev?.source ?? source, createdAt: prev?.createdAt ?? Date.now(), updatedAt: Date.now() };
    return nb.lessons[lid];
  });
}

export function deleteLesson(id) {
  return mutate((nb) => {
    delete nb.lessons[id];
    return true;
  });
}

const STATUS = ['running', 'confirmed', 'not-confirmed', 'unclear'];

export async function saveExperiment(exp) {
  const hypothesis = s(exp.hypothesis, 500);
  if (!hypothesis) throw new Error('Write the hypothesis first.');
  return mutate((nb) => {
    const eid = exp.id && nb.experiments[exp.id] ? exp.id : newId('x');
    const prev = nb.experiments[eid] ?? {};
    nb.experiments[eid] = {
      id: eid,
      hypothesis,
      change: s(exp.change ?? prev.change, 1000),
      measure: ['d7', 'multiplier', 'avgViewed', 'ctr'].includes(exp.measure) ? exp.measure : prev.measure ?? 'd7',
      projectIds: [...new Set(exp.projectIds ?? prev.projectIds ?? [])].slice(0, 30),
      status: STATUS.includes(exp.status) ? exp.status : prev.status ?? 'running',
      conclusion: s(exp.conclusion ?? prev.conclusion, 2000),
      tags: noteTags(`${hypothesis} ${exp.change ?? prev.change ?? ''}`),
      createdAt: prev.createdAt ?? Date.now(),
      updatedAt: Date.now(),
    };
    return nb.experiments[eid];
  });
}

export function deleteExperiment(id) {
  return mutate((nb) => {
    delete nb.experiments[id];
    return true;
  });
}
