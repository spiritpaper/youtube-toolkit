import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const store = {};
globalThis.chrome = { storage: { local: {
  async get(k) {
    if (k == null) return structuredClone(store);
    const l = typeof k === 'string' ? [k] : k;
    return Object.fromEntries(l.filter((x) => x in store).map((x) => [x, structuredClone(store[x])]));
  },
  async set(o) { Object.assign(store, structuredClone(o)); },
  async remove(k) { for (const x of [].concat(k)) delete store[x]; },
} } };
const notes = await import('../src/lib/notes.js');
beforeEach(() => { for (const k of Object.keys(store)) delete store[k]; });

test('parseTime reads m:ss, h:mm:ss and seconds', () => {
  assert.equal(notes.parseTime('3:42'), 222);
  assert.equal(notes.parseTime('1:02:03'), 3723);
  assert.equal(notes.parseTime('90'), 90);
  assert.equal(notes.parseTime('90s'), 90);
  assert.equal(notes.parseTime(' 0:05 '), 5);
  for (const bad of ['', '3:72', 'abc', '1:2:3:4', '-5']) assert.equal(notes.parseTime(bad), null, bad);
});

test('notes are added in time order, edited, deleted, and the key goes when empty', async () => {
  const id = 'abcdefghijk';
  await notes.addNote(id, { t: '2:00', text: ' second ', title: 'My video' });
  const e = await notes.addNote(id, { t: 15, text: 'first' });
  assert.deepEqual(e.notes.map((n) => [n.t, n.text]), [[15, 'first'], [120, 'second']]);
  assert.equal(e.title, 'My video');
  await notes.updateNote(id, e.notes[0].id, { t: '3:00', text: 'moved' });
  let got = await notes.getNotes(id);
  assert.deepEqual(got.notes.map((n) => n.text), ['second', 'moved']);
  await assert.rejects(notes.addNote(id, { t: 'soon', text: 'x' }), /time like/);
  await assert.rejects(notes.addNote(id, { t: 1, text: '   ' }), /Write something/);
  const list = await notes.listNoted();
  assert.deepEqual(list.map((x) => [x.videoId, x.count]), [[id, 2]]);
  assert.match(notes.notesMarkdown(got), /- \[2:00\]\(https:\/\/www\.youtube\.com\/watch\?v=abcdefghijk&t=120s\) second/);
  for (const n of got.notes) await notes.deleteNote(id, n.id);
  assert.ok(!(`sn:${id}` in store));
  assert.deepEqual((await notes.getNotes(id)).notes, []);
});
