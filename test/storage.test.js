// Rabbit-hole tree storage and storage cleanup / backup.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const store = {};
globalThis.chrome = {
  storage: {
    local: {
      async get(keys) {
        if (keys == null) return structuredClone(store);
        const list = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
        return Object.fromEntries(list.filter((k) => k in store).map((k) => [k, structuredClone(store[k])]));
      },
      async set(obj) { Object.assign(store, structuredClone(obj)); },
      async remove(keys) { for (const k of [].concat(keys)) delete store[k]; },
    },
  },
};

const ex = await import('../src/lib/explore-store.js');
const admin = await import('../src/lib/storage-admin.js');
const ideasLib = await import('../src/lib/ideas.js');

const exploration = (keyword) => ({ keyword, source: 'search page', metrics: { opportunity: 50 }, results: [{ id: 'v1' }], related: { autocomplete: [], phrases: [] } });

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
});

test('rabbit holes form a tree; re-exploring a keyword reuses its node', async () => {
  const root = await ex.addNode({ exploration: exploration('budget travel') });
  const child = await ex.addNode({ parentId: root.id, exploration: exploration('budget travel japan') });
  const grandchild = await ex.addNode({ parentId: child.id, exploration: exploration('japan rail pass') });
  assert.equal(grandchild.depth, 2);
  assert.equal(grandchild.rootId, root.id);
  const again = await ex.addNode({ parentId: root.id, exploration: exploration('Budget Travel Japan') });
  assert.equal(again.id, child.id);
  assert.equal(Object.keys(await ex.listNodes()).length, 3);
  const full = await ex.getNode(child.id);
  assert.deepEqual(full.results, [{ id: 'v1' }]);

  // Deleting a node removes everything below it, including stored results.
  assert.equal(await ex.deleteNodes([child.id]), 2);
  assert.deepEqual(Object.keys(await ex.listNodes()), [root.id]);
  assert.ok(!(`xn:${grandchild.id}` in store));
});

test('old rabbit holes are deleted by last activity of the whole tree', async () => {
  const oldRoot = await ex.addNode({ exploration: exploration('old topic') });
  const freshRoot = await ex.addNode({ exploration: exploration('fresh topic') });
  store['explore:index'][oldRoot.id].updatedAt = Date.now() - 200 * 86_400_000;
  store['explore:index'][freshRoot.id].updatedAt = Date.now() - 200 * 86_400_000;
  await ex.addNode({ parentId: freshRoot.id, exploration: exploration('fresh sub topic') }); // touches the fresh tree
  assert.equal(await ex.deleteHolesOlderThan(90), 1);
  const left = Object.values(await ex.listNodes()).map((n) => n.keyword).sort();
  assert.deepEqual(left, ['fresh sub topic', 'fresh topic']);
});

test('cleanup actions and usage report', async () => {
  const day = 86_400_000;
  store.ideas = {
    a: { id: 'a', savedAt: Date.now() - 400 * day, history: [{ t: Date.now() - 300 * day }, { t: Date.now() - 10 * day }, { t: Date.now() }], ai: { text: 'x' } },
    b: { id: 'b', savedAt: Date.now(), unavailable: true, history: [{ t: Date.now() }] },
  };
  store['tx:a'] = { segments: [] };
  store['tx:gone'] = { segments: [] };
  store['hm:gone'] = { points: [] };
  store['cache:v:1'] = { value: 1, exp: Date.now() + 1000 };
  store.aiRuns = [{ at: 1 }];
  store.apiKey = 'secret';

  const u = await admin.usage();
  assert.equal(u.ideas.items, 2);
  assert.equal(u.transcripts.orphans, 1);
  assert.ok(u.total > 0);

  assert.equal(await admin.cleanup({ action: 'history-older', days: 30 }), 1);
  assert.equal(store.ideas.a.history.length, 2);
  assert.equal(await admin.cleanup({ action: 'orphans' }), 2);
  assert.ok('tx:a' in store && !('tx:gone' in store));
  assert.equal(await admin.cleanup({ action: 'ideas-unavailable' }), 1);
  assert.equal(await admin.cleanup({ action: 'ai-breakdowns' }), 1);
  assert.equal(await admin.cleanup({ action: 'cache' }), 1);
  assert.equal(await admin.cleanup({ action: 'ideas-older', days: 365 }), 1);
  assert.ok(!('tx:a' in store), 'transcripts of deleted ideas go too');
  assert.equal(store.apiKey, 'secret');
});

test('removing an idea also removes its transcript and heatmap', async () => {
  store.ideas = { a: { id: 'a' } };
  store['tx:a'] = {};
  store['hm:a'] = {};
  await ideasLib.removeIdea('a');
  assert.deepEqual(Object.keys(store).sort(), ['ideas']);
});

test('backup excludes keys and cache; restore merges by recency', async () => {
  store.ideas = { a: { id: 'a', title: 'old', updatedAt: 1 } };
  store.apiKey = 'secret';
  store.ai = { keys: { gemini: 'secret' } };
  store['cache:x'] = { value: 1, exp: Date.now() + 1000 };
  store['tx:a'] = { segments: [{ start: 0, text: 'hi' }] };
  const backup = await admin.exportAll();
  assert.ok(!('apiKey' in backup.data) && !('ai' in backup.data) && !('cache:x' in backup.data));
  assert.ok('tx:a' in backup.data);

  backup.data.ideas.a = { id: 'a', title: 'new', updatedAt: 5 };
  backup.data.ideas.b = { id: 'b', title: 'b', updatedAt: 1 };
  backup.data.apiKey = 'evil';
  store.ideas.a.updatedAt = 3;
  const res = await admin.importAll(backup);
  assert.equal(res.ideasAdded, 1);
  assert.equal(store.ideas.a.title, 'new');
  assert.equal(store.apiKey, 'secret', 'API keys are never imported');
  await assert.rejects(admin.importAll({ foo: 1 }), /Not a YT Toolkit backup/);
});
