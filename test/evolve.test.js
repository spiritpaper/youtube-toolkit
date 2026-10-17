import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanProposal, diffEdit, applyProposal } from '../src/lib/evolve.js';
import { normalizeAvatar } from '../src/lib/avatars.js';

const avatars = [
  normalizeAvatar({ id: 'a', name: 'Maya', age: 27, wants: 'finished projects', habits: 'watches at 1.25x', weight: 0.5, locked: true }),
  normalizeAvatar({ id: 'b', name: 'Kyle', age: 19, device: 'phone', weight: 0.3 }),
  normalizeAvatar({ id: 'c', name: 'Lena', age: 35, weight: 0.2 }),
];

const raw = {
  summary: 'Real viewers are less patient; a nostalgia segment is missing.',
  edits: [
    { id: 'b', changes: { habits: 'leaves within 10 seconds without a hook', device: 'Phone', name: 'Renamed', weight: 9 }, reason: 'left early in 3 videos' },
    { id: 'a', changes: { wants: 'finished projects' }, reason: 'no real change' },
    { id: 'ghost', changes: { age: 50 } },
  ],
  add: [{ avatar: { name: 'Nora P.', age: 44, occupation: 'nurse', wants: 'nostalgia and calm', weight: 0.2 }, reason: 'comments about old videos' }, { avatar: {} }],
  retire: [{ id: 'c', reason: 'no real viewer like her' }, { id: 'zzz' }],
  weights: { a: 0.4, b: 0.4, zzz: 1, c: -1 },
};

test('a proposal keeps only real, editable changes to known avatars', () => {
  const p = cleanProposal(raw, avatars);
  assert.equal(p.edits.length, 1, 'no-op edits and unknown avatars are dropped');
  assert.deepEqual(p.edits[0].patch, { habits: 'leaves within 10 seconds without a hook' }, 'name, weight and unchanged device are not edits');
  assert.equal(p.add.length, 1);
  assert.equal(p.add[0].avatar.source, 'ai');
  assert.deepEqual(p.retire.map((r) => r.id), ['c']);
  assert.deepEqual(p.weights, { a: 0.4, b: 0.4 });
  assert.match(p.summary, /less patient/);
  assert.deepEqual(diffEdit(avatars[1], p.edits[0].patch), [{ field: 'habits', before: '—', after: 'leaves within 10 seconds without a hook' }]);
});

test('only accepted parts are applied, and shares add up again', () => {
  const p = cleanProposal(raw, avatars);
  const out = applyProposal(avatars, p, { edits: new Set(['b']), add: new Set([0]), retire: new Set(['c']), weights: true });
  assert.deepEqual(out.avatars.map((a) => a.name), ['Maya', 'Kyle', 'Nora P.']);
  assert.equal(out.avatars[1].habits, 'leaves within 10 seconds without a hook');
  assert.equal(Math.round(out.avatars.reduce((n, a) => n + a.weight, 0) * 100) / 100, 1);
  assert.equal(out.avatars[0].locked, true, 'locks survive');
  assert.deepEqual({ ...out.revision, summary: undefined }, { edited: 1, added: 1, retired: 1, weights: true, summary: undefined });
  const none = applyProposal(avatars, p, { edits: new Set(), add: new Set(), retire: new Set(), weights: false });
  assert.deepEqual(none.avatars.map((a) => [a.name, a.weight]), avatars.map((a) => [a.name, a.weight]));
});
