import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex, search } from '../src/lib/search.js';

const data = {
  projects: { p1: { id: 'p1', title: 'I built a game in 7 days', status: 'scripting', angle: 'honest failures', updatedAt: 5 }, p2: { id: 'p2', title: 'Learning Rust', status: 'published', archivedAt: 9, notes: 'game engine', updatedAt: 9 } },
  ideas: { v1: { id: 'v1', title: 'Gamedev in Godot', channelTitle: 'Brackeys', tags: ['godot'], savedAt: 3 } },
  watchlist: { UC1: { id: 'UC1', title: 'Veritasium', handle: '@veritasium', notes: 'great hooks', role: 'learn' } },
  'explore:index': { n1: { id: 'n1', keyword: 'game design', parentId: null, updatedAt: 1 } },
  'sn:v1': { videoId: 'v1', title: 'Gamedev in Godot', notes: [{ id: 'a', t: 125, text: 'Hook uses a question\nsecond line', createdAt: 2 }] },
  'sn:zz': { videoId: 'zz', title: 'Other', notes: [{ id: 'b', t: 5, text: 'cold open', createdAt: 2 }] },
  'vw:v1': { seed: 'v1', nodes: { v1: { id: 'v1', title: 'Gamedev in Godot' } }, at: 4 },
  analyzed: new Set(['v1']),
  pages: [{ label: 'Idea board', href: 'board/board.html' }],
};

test('the index covers every kind with the right links', () => {
  const items = buildIndex(data);
  const by = (kind) => items.filter((i) => i.kind === kind);
  assert.equal(by('project').length, 2);
  assert.equal(by('project')[1].sub.split(' · ')[0], 'archived');
  assert.equal(by('channel')[0].href, 'channels/channels.html#ch-UC1');
  assert.equal(by('idea')[0].href, 'ideas/ideas.html?q=v1');
  const notes = by('note');
  assert.equal(notes.find((n) => n.title === 'Hook uses a question').href, 'script/script.html?id=v1#notes', 'analyzed video: Script lab');
  assert.equal(notes.find((n) => n.title === 'cold open').href, 'https://www.youtube.com/watch?v=zz&t=5s', 'not analyzed: YouTube at the moment');
  assert.equal(notes[0].sub, 'Gamedev in Godot · 2:05');
  assert.equal(by('web')[0].title, 'Gamedev in Godot');
  assert.equal(by('hole')[0].sub, 'rabbit hole');
});

test('search needs every word, ranks title hits first, and ignores case and accents', () => {
  const items = buildIndex(data);
  const r = search(items, 'GAME');
  assert.equal(r[0].title, 'game design', 'title starting with the word wins');
  assert.ok(r.some((x) => x.title === 'Learning Rust'), 'body match (notes) is found too');
  assert.ok(r.findIndex((x) => x.title === 'Learning Rust') > r.findIndex((x) => x.title === 'I built a game in 7 days'));
  assert.deepEqual(search(items, 'game rust').map((x) => x.title), ['Learning Rust']);
  assert.deepEqual(search(items, 'vérítasium').map((x) => x.kind), ['channel']);
  assert.deepEqual(search(items, 'hooks').map((x) => x.title), ['Veritasium']);
  assert.deepEqual(search(items, '   '), []);
  assert.deepEqual(search(items, 'idea b').map((x) => x.kind), ['page']);
  assert.deepEqual(search(items, '(['), [], 'regex characters are safe');
});
