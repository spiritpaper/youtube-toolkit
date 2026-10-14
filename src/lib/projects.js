// Your video projects (the Idea board). Stored as one map in `projects`;
// writes are serialized here and happen only in the background worker.

export const STATUSES = [
  { id: 'idea', label: 'Idea' },
  { id: 'planned', label: 'Planned' },
  { id: 'scripting', label: 'Scripting' },
  { id: 'filming', label: 'Filming & editing' },
  { id: 'published', label: 'Published' },
];
const STATUS_IDS = STATUSES.map((s) => s.id);
// Fields a page may change. Everything else is managed here.
const EDITABLE = ['title', 'status', 'angle', 'notes', 'titles', 'outline', 'script', 'shotList', 'hook', 'inspiration', 'publishedVideoId', 'thumbnail', 'checks', 'ai'];

let chain = Promise.resolve();
function mutate(fn) {
  chain = chain.then(async () => {
    const { projects = {} } = await chrome.storage.local.get('projects');
    const result = fn(projects);
    await chrome.storage.local.set({ projects });
    return result;
  });
  return chain;
}

export async function listProjects() {
  const { projects = {} } = await chrome.storage.local.get('projects');
  return projects;
}

const newId = () => `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function createProject(data = {}) {
  return mutate((projects) => {
    const now = Date.now();
    const p = {
      id: newId(),
      title: (data.title ?? '').trim() || 'Untitled video',
      status: STATUS_IDS.includes(data.status) ? data.status : 'idea',
      angle: data.angle ?? '',
      notes: data.notes ?? '',
      titles: data.titles ?? [],
      outline: data.outline ?? '',
      script: data.script ?? '',
      shotList: data.shotList ?? '',
      inspiration: [...new Set(data.inspiration ?? [])],
      source: data.source ?? null,
      createdAt: now,
      updatedAt: now,
      order: now,
    };
    projects[p.id] = p;
    return p;
  });
}

export function updateProject(id, patch) {
  return mutate((projects) => {
    const p = projects[id];
    if (!p) throw new Error('This project was deleted.');
    for (const k of EDITABLE) if (k in patch) p[k] = patch[k];
    if (patch.status && !STATUS_IDS.includes(patch.status)) p.status = 'idea';
    if (patch.status === 'published' && !p.publishedAt) p.publishedAt = Date.now();
    if ('order' in patch) p.order = patch.order;
    if (patch.addInspiration) p.inspiration = [...new Set([...(p.inspiration ?? []), ...[].concat(patch.addInspiration)])];
    p.updatedAt = Date.now();
    return p;
  });
}

export async function deleteProject(id) {
  await mutate((projects) => {
    delete projects[id];
  });
  await chrome.storage.local.remove(`th:${id}`); // its uploaded thumbnail
  return true;
}

// Internal: lets the background record performance snapshots.
export function mutateProjects(fn) {
  return mutate(fn);
}
