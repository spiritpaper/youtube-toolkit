import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const store = {};
globalThis.chrome = { storage: { local: {
  async get(k) { const l = typeof k === 'string' ? [k] : k; return Object.fromEntries(l.filter((x) => x in store).map((x) => [x, structuredClone(store[x])])); },
  async set(o) { Object.assign(store, structuredClone(o)); },
  async remove(k) { for (const x of [].concat(k)) delete store[x]; },
} } };
const pr = await import('../src/lib/projects.js');
beforeEach(() => { for (const k of Object.keys(store)) delete store[k]; });

test('projects move through the board and keep their content', async () => {
  const p = await pr.createProject({ title: '  7 days in Seoul on $100 ', inspiration: ['a', 'a', 'b'] });
  assert.equal(p.title, '7 days in Seoul on $100');
  assert.equal(p.status, 'idea');
  assert.deepEqual(p.inspiration, ['a', 'b']);
  await pr.updateProject(p.id, { status: 'scripting', script: 'Hook…', addInspiration: ['c', 'a'], hacked: 1 });
  let saved = (await pr.listProjects())[p.id];
  assert.equal(saved.status, 'scripting');
  assert.equal(saved.script, 'Hook…');
  assert.deepEqual(saved.inspiration, ['a', 'b', 'c']);
  assert.ok(!('hacked' in saved), 'only known fields can be changed');
  await pr.updateProject(p.id, { status: 'published' });
  saved = (await pr.listProjects())[p.id];
  assert.ok(saved.publishedAt > 0);
  await pr.updateProject(p.id, { status: 'nonsense' });
  assert.equal((await pr.listProjects())[p.id].status, 'idea');
  await pr.deleteProject(p.id);
  assert.deepEqual(await pr.listProjects(), {});
  await assert.rejects(pr.updateProject(p.id, { title: 'x' }), /deleted/);
});

test('a failed write does not block later ones', async () => {
  await assert.rejects(pr.updateProject('gone', { title: 'x' }), /deleted/);
  const p = await pr.createProject({ title: 'after the error' });
  assert.equal((await pr.listProjects())[p.id].title, 'after the error');
});

test('published projects go to the archive after the set number of days', async () => {
  const DAY = 86_400_000;
  const now = Date.now();
  const a = await pr.createProject({ title: 'linked video' });
  const b = await pr.createProject({ title: 'no link yet' });
  const c = await pr.createProject({ title: 'still filming' });
  await pr.updateProject(a.id, { status: 'published' });
  await pr.updateProject(b.id, { status: 'published' });
  await pr.mutateProjects((all) => {
    // Linked: YouTube's publish date counts, not when the card was moved.
    all[a.id].performance = { video: { id: 'vid', publishedAt: new Date(now - 31 * DAY).toISOString(), thumb: 't.jpg' }, history: [{ views: 900, multiplier: 2.5 }], milestones: { h48: { views: 300, multiplier: 1.2 } } };
    all[b.id].publishedAt = now - 10 * DAY;
    all[c.id].publishedAt = now - 90 * DAY;
  });
  assert.equal(await pr.archiveOld(30, now), 1);
  let all = await pr.listProjects();
  assert.ok(all[a.id].archivedAt && !all[b.id].archivedAt && !all[c.id].archivedAt);
  assert.equal(await pr.archiveOld(0, now + 100 * DAY), 0, '0 days turns archiving off');

  const f = pr.finalNumbers(all[a.id]);
  assert.equal(f.views, 900);
  assert.equal(f.multiplier, 2.5);
  assert.equal(f.h48.views, 300);
  assert.equal(f.videoId, 'vid');

  // Restored by hand: stays on the board even when due again.
  await pr.updateProject(a.id, { archived: false });
  assert.equal(await pr.archiveOld(30, now), 0);
  all = await pr.listProjects();
  assert.ok(!all[a.id].archivedAt && all[a.id].keepOnBoard);
  // Archived by hand, then moved back into production: back on the board.
  await pr.updateProject(b.id, { archived: true });
  assert.ok((await pr.listProjects())[b.id].archivedAt);
  await pr.updateProject(b.id, { status: 'filming' });
  all = await pr.listProjects();
  assert.ok(!all[b.id].archivedAt && !all[b.id].keepOnBoard);
});
