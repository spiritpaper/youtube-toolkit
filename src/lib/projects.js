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
const DAY = 86_400_000;
// Published projects leave the board this many days after publishing.
export const ARCHIVE_DAYS_DEFAULT = 30;
// Fields a page may change. Everything else is managed here.
const EDITABLE = ['title', 'status', 'angle', 'notes', 'titles', 'outline', 'script', 'shotList', 'hook', 'inspiration', 'publishedVideoId', 'thumbnail', 'checks', 'ai'];

let chain = Promise.resolve();
function mutate(fn) {
  const run = chain.then(async () => {
    const { projects = {} } = await chrome.storage.local.get('projects');
    const result = fn(projects);
    await chrome.storage.local.set({ projects });
    return result;
  });
  chain = run.catch(() => {}); // one failed write must not block the ones after it
  return run;
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
    if (patch.status && p.status !== 'published') {
      // Moved back into production: it belongs on the board again.
      delete p.archivedAt;
      delete p.keepOnBoard;
    }
    if (patch.archived === true) {
      p.archivedAt = Date.now();
      delete p.keepOnBoard;
    } else if (patch.archived === false) {
      delete p.archivedAt;
      p.keepOnBoard = true; // restored by hand: don't archive it again automatically
    }
    if ('order' in patch) p.order = patch.order;
    if (patch.addInspiration) p.inspiration = [...new Set([...(p.inspiration ?? []), ...[].concat(patch.addInspiration)])];
    p.updatedAt = Date.now();
    return p;
  });
}

/** When the video went live: YouTube's publish time if linked, else when it was marked Published. */
export function publishedTime(p) {
  return Date.parse(p.performance?.video?.publishedAt ?? '') || p.publishedAt || null;
}

/** Whether a published project is due for the archive. `days` <= 0 turns archiving off. */
export function archiveDue(p, days, now = Date.now()) {
  if (!(days > 0) || p.status !== 'published' || p.archivedAt || p.keepOnBoard) return false;
  const t = publishedTime(p);
  return t != null && now - t >= days * DAY;
}

/** Archives every published project older than `days`. Returns how many moved. */
export function archiveOld(days, now = Date.now()) {
  return mutate((projects) => {
    let n = 0;
    for (const p of Object.values(projects)) {
      if (archiveDue(p, days, now)) {
        p.archivedAt = now;
        n++;
      }
    }
    return n;
  });
}

/** The numbers a finished video ended on, for the archive. */
export function finalNumbers(p) {
  const perf = p.performance;
  const last = perf?.history?.at(-1);
  return {
    views: last?.views ?? null,
    multiplier: last?.multiplier ?? null,
    likes: last?.likes ?? null,
    h48: perf?.milestones?.h48 ?? null,
    d7: perf?.milestones?.d7 ?? null,
    publishedAt: publishedTime(p),
    thumb: perf?.video?.thumb ?? null,
    videoId: perf?.video?.id ?? p.publishedVideoId ?? null,
  };
}

export async function deleteProject(id) {
  await mutate((projects) => {
    delete projects[id];
  });
  await chrome.storage.local.remove(`th:${id}`); // its uploaded thumbnail
  return true;
}

// Internal: lets the background record performance snapshots and restore backups.
export function mutateProjects(fn) {
  return mutate(fn);
}
