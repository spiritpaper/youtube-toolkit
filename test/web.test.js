import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addSuggestions, relationship, webInsights, clusters, layout } from '../src/lib/web.js';

function sampleWeb() {
  const web = { nodes: { seed: { id: 'seed', depth: 0 } }, edges: [] };
  addSuggestions(web, 'seed', ['a', 'b', 'c', 'd'], 3);
  addSuggestions(web, 'a', ['seed', 'b', 'e'], 3);
  addSuggestions(web, 'b', ['a', 'e', 'f'], 3);
  const meta = {
    seed: ['How to Spend 14 Days in Japan Itinerary', 'C1', 1.2],
    a: ['Japan Rail Pass Itinerary Explained', 'C2', 4],
    b: ['Japan Itinerary for First Timers', 'C1', 2.5],
    c: ['Cooking Ramen at Home', 'C3', 0.6],
    e: ['Japan Itinerary 7 Days Budget', 'C2', 3],
    f: ['Tokyo Night Walk', 'C4', 1],
  };
  for (const [id, [title, ch, m]] of Object.entries(meta)) Object.assign(web.nodes[id], { title, channelId: ch, channelTitle: ch, multiplier: m, views: 1000 });
  return web;
}

test('addSuggestions builds ranked, de-duplicated edges with depth', () => {
  const web = sampleWeb();
  assert.equal(web.edges.filter((e) => e.from === 'seed').length, 3, 'perNode limit');
  assert.equal(web.nodes.e.depth, 2);
  assert.ok(!web.nodes.d, 'beyond perNode');
  const before = web.edges.length;
  addSuggestions(web, 'seed', ['a', 'b'], 3);
  assert.equal(web.edges.length, before);
});

test('relationship explains why two videos are connected', () => {
  const web = sampleWeb();
  const r = relationship(web, 'seed', 'a');
  assert.ok(r[0].includes('each from the other'), r.join(' | '));
  assert.ok(r.some((x) => x.startsWith('Shared topic') && x.includes('japan')));
  assert.ok(relationship(web, 'seed', 'b').some((x) => x.startsWith('Same channel')));
});

test('webInsights finds hubs, mutual links, outlier words and clusters', () => {
  const web = sampleWeb();
  const ins = webInsights(web);
  assert.deepEqual(ins.hubs.map((n) => n.id).sort(), ['a', 'b', 'e'], 'each is suggested by two videos');
  assert.equal(ins.hubs[0].inDegree, 2);
  assert.ok(ins.mutual.some(([x, y]) => [x, y].sort().join() === 'a,seed'));
  assert.equal(ins.outliers[0].id, 'a');
  assert.ok(ins.outlierWords.some((w) => w.word === 'itinerary'), JSON.stringify(ins.outlierWords));
  const cl = clusters(web);
  assert.ok(cl[0].label.includes('japan') || cl[0].label.includes('itinerary'));
  assert.ok(!cl.some((c) => c.ids.includes('c')), 'unrelated ramen video stays out of the cluster');
});

test('layout is deterministic and fits the box', () => {
  const web = sampleWeb();
  const p1 = layout(web, { width: 800, height: 600, center: 'seed' });
  const p2 = layout(web, { width: 800, height: 600, center: 'seed' });
  assert.deepEqual([...p1], [...p2]);
  for (const { x, y } of p1.values()) assert.ok(x >= 0 && x <= 800 && y >= 0 && y <= 600, `${x},${y}`);
  const d = (a, b) => Math.hypot(p1.get(a).x - p1.get(b).x, p1.get(a).y - p1.get(b).y);
  assert.ok(d('seed', 'a') > 20, 'nodes do not overlap');
});
