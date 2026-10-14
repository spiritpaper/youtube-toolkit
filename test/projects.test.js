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
