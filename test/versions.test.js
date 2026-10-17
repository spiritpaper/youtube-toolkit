import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareVersions, stampOf } from '../src/lib/versions.js';

test('versions compare numerically, with or without a leading v', () => {
  assert.equal(compareVersions('0.7.1', '0.7.0'), 1);
  assert.equal(compareVersions('v0.7.0', '0.7.0'), 0);
  assert.equal(compareVersions('0.10.0', '0.9.9'), 1);
  assert.equal(compareVersions('0.7.0', '0.7.0.1'), -1);
  assert.equal(compareVersions('1.0', '0.99.99'), 1);
});

test('the disk stamp prefers build.json commits over the version', () => {
  assert.equal(stampOf({ commit: 'abc', version: '0.7.0.1' }, { version: '0.7.0.1' }), '0.7.0.1@abc');
  assert.equal(stampOf(null, { version: '0.7.1' }), '0.7.1');
});
