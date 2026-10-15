import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shortCandidates } from '../src/lib/shorts.js';

// 10 minutes of 5-second lines; every 3rd line ends a sentence.
const segments = Array.from({ length: 120 }, (_, i) => ({ start: i * 5, dur: 5, text: `line ${i}${i % 3 === 2 ? '.' : ''}` }));
const heatmap = Array.from({ length: 100 }, (_, i) => ({ start: i * 6, duration: 6, intensity: i === 50 ? 1 : i === 80 ? 0.7 : 0.2 }));

test('candidates sit on replay peaks, start and end on sentences, and stay 25-58 s', () => {
  const c = shortCandidates(segments, { heatmap, devices: [{ type: 'turn', start: 150 }] });
  assert.ok(c.length >= 2);
  const peak = c.find((x) => x.start <= 300 && x.end > 300);
  assert.ok(peak, 'the biggest replay peak (5:00) is inside a candidate');
  assert.match(peak.reasons[0], /replayed \(100%\)/);
  for (const x of c) {
    assert.ok(x.end - x.start >= 25 && x.end - x.start <= 58, `${x.start}-${x.end}`);
    const first = segments.findIndex((s) => s.start === x.start);
    assert.ok(first === 0 || segments[first - 1].text.endsWith('.'), `starts at a sentence: ${x.start}`);
    assert.ok(x.text.trim().endsWith('.'), 'ends a sentence');
  }
  for (let i = 0; i < c.length; i++) for (let j = i + 1; j < c.length; j++) assert.ok(c[i].end <= c[j].start || c[j].end <= c[i].start, 'no overlaps');
  assert.equal(c[0].reasons[0], 'replayed (100%)', 'best first');
});

test('without a heatmap it uses attention devices, and short videos give nothing', () => {
  const c = shortCandidates(segments, { devices: [{ type: 'question', start: 200 }, { type: 'cta', start: 400 }] });
  assert.equal(c.length, 1);
  assert.equal(c[0].heat, null);
  assert.deepEqual(shortCandidates(segments.slice(0, 8), { heatmap }), []);
  assert.ok(shortCandidates(segments, {}).length > 0, 'falls back to evenly spaced stretches');
});

test('the Shorts prompt cuts your own video, and remakes someone else\'s', async () => {
  const { shortsPrompt } = await import('../src/lib/ai.js');
  const c = shortCandidates(segments, { heatmap });
  const mine = shortsPrompt({ title: 'Mine' }, segments, c, 'gamedev', { mine: true }).prompt;
  const theirs = shortsPrompt({ title: 'Theirs', channelTitle: 'Other' }, segments, c, 'gamedev').prompt;
  assert.match(mine, /This is MY video/);
  assert.match(mine, /Points back to the long video/);
  assert.match(theirs, /Don't suggest reuploading/);
  assert.ok(!theirs.includes('Points back to the long video'));
  assert.match(mine, /replayed \(100%\)/);
});
