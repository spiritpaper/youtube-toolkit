import { test } from 'node:test';
import assert from 'node:assert/strict';

const store = {};
globalThis.chrome = { storage: { local: {
  async get(k) {
    const l = typeof k === 'string' ? [k] : k;
    return Object.fromEntries(l.filter((x) => x in store).map((x) => [x, structuredClone(store[x])]));
  },
  async set(o) { Object.assign(store, structuredClone(o)); },
} } };
const { noteTags, words, contextAt, recall, screeningLessons, experimentResults, resultsVerdict } = await import('../src/lib/notebook.js');
const nbs = await import('../src/lib/notebook-store.js');

test('tags come from #words, not from urls or headings', () => {
  assert.deepEqual(noteTags('Great #Hook here, see #b-roll and (#hook) https://x.com/#frag ## Heading #1'), ['hook', 'b-roll']);
  assert.deepEqual(words('The hooks were hooking viewers'), ['hook', 'hook', 'viewer']);
});

test('the context is the paragraph at the caret and the heading above it', () => {
  const text = '## Intro\nSay hi.\n\n## The crash on day 4\nEverything breaks.\nThe save system fails.\n\nDay 5 recovery.';
  const caret = text.indexOf('save');
  assert.deepEqual(contextAt(text, caret), { paragraph: '## The crash on day 4\nEverything breaks.\nThe save system fails.', heading: 'The crash on day 4' });
  assert.equal(contextAt('**Hook:**\nOpen on the result.', 15).heading, 'Hook:');
});

test('recall finds notes that share rare words or a tag, best first', () => {
  const items = [
    { id: 'a', text: 'Showing the finished game in the first 5 seconds kept people watching #hook', tags: ['hook'] },
    { id: 'b', text: 'Background music too loud during the tutorial part', tags: [] },
    { id: 'c', text: 'The crash scene: a failure moment with real stakes makes the middle exciting', tags: ['stakes'] },
    { id: 'd', text: 'Game jam ideas list', tags: [] },
  ];
  const r = recall({ paragraph: 'Open on the finished game, then the crash and what was at stake', heading: 'Hook' }, items);
  assert.deepEqual(r.map((x) => x.item.id), ['a', 'c']);
  assert.ok(r[0].matched.includes('hook'));
  assert.deepEqual(recall({ paragraph: 'the and with' }, items), []);
});

test('lessons come from the "For the next screening" section', () => {
  const sim = { id: 's1', projectId: 'p1', projectTitle: 'Seven days', at: 5, accuracyNotes: { at: 9, text: '## What it missed\n- not this\n## For the next screening\n- **Viewers** leave fast without the result up front.\n- Beginners need the engine named.\n## Other\n- no' } };
  const l = screeningLessons(sim);
  assert.deepEqual(l.map((x) => x.text), ['Viewers leave fast without the result up front.', 'Beginners need the engine named.']);
  assert.equal(l[0].source.projectId, 'p1');
  assert.deepEqual(screeningLessons({ id: 'x' }), []);
});

test('experiment results compare its videos with the other published ones', () => {
  const pub = (id, d7) => ({ id, publishedVideoId: id, performance: { history: [{ views: 1, multiplier: d7 }], milestones: { d7: { multiplier: d7 } } } });
  const projects = { a: pub('a', 2), b: pub('b', 3), c: pub('c', 1), d: pub('d', 1.5), e: { id: 'e' } };
  const res = experimentResults({ measure: 'd7', projectIds: ['a', 'b', 'e'] }, projects);
  assert.equal(res.value, 2.5);
  assert.equal(res.baseline, 1.25);
  assert.equal(res.lift, 2);
  assert.equal(res.n, 2);
  assert.match(resultsVerdict(res), /100% better than your other 2 published videos\. Only 2 videos/);
  const ctr = experimentResults({ measure: 'ctr', projectIds: ['a'] }, projects, [{ projectId: 'a', actual: { ctr: 6 } }, { projectId: 'c', actual: { ctr: 4 } }]);
  assert.equal(ctr.lift, 1.5);
  assert.match(resultsVerdict({ n: 0 }), /No results yet/);
});

test('the store keeps lessons and experiments with their tags', async () => {
  const l = await nbs.saveLesson({ text: 'Name the engine early #beginners' });
  assert.deepEqual(l.tags, ['beginners']);
  await assert.rejects(nbs.saveLesson({ text: ' ' }));
  const x = await nbs.saveExperiment({ hypothesis: 'Showing the result first #hook lifts 7-day views', measure: 'nope', projectIds: ['a', 'a', 'b'] });
  assert.equal(x.measure, 'd7');
  assert.deepEqual(x.projectIds, ['a', 'b']);
  const y = await nbs.saveExperiment({ id: x.id, hypothesis: x.hypothesis, status: 'confirmed', conclusion: 'Yes.' });
  assert.equal(y.createdAt, x.createdAt);
  assert.deepEqual(y.projectIds, ['a', 'b'], 'unchanged fields are kept');
  const nb = await nbs.getNotebook();
  assert.equal(Object.keys(nb.lessons).length, 1);
  assert.equal(nb.experiments[x.id].status, 'confirmed');
  await nbs.deleteLesson(l.id);
  assert.equal(Object.keys((await nbs.getNotebook()).lessons).length, 0);
});
