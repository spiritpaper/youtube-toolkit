import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actualFromAnalytics, compareScreening, calibration, calibrated, calibrationLine, watchShift } from '../src/lib/accuracy.js';

// A 600 s video whose real curve falls linearly from 100% to 30%, with a cliff at 40%.
const retention = Array.from({ length: 101 }, (_, i) => ({ ratio: i / 100, watch: i < 40 ? 1 - i * 0.004 : 0.7 - (i - 40) * 0.0067, relative: 0.5 }));
const actual = actualFromAnalytics({ totals: { averageViewPercentage: 42, videoThumbnailImpressionsClickRate: 5.1, views: 2000, likes: 80 }, retention, durationSec: 600 });

test('the real numbers come from analytics totals and the retention curve', () => {
  assert.equal(actual.avgViewed, 42);
  assert.equal(actual.ctr, 5.1);
  assert.equal(actual.likeRate, 0.04);
  assert.equal(Math.round(actual.hold30 * 100), 98); // 30 s of 600 = 5%
  assert.equal(Math.round(actual.drop.ratio * 100), 40);
  assert.equal(actualFromAnalytics({}).hold30, null);
});

const sim = {
  result: { clickShare: 0.6, hookHold: 0.85, watchedShare: 0.55, curve: [{ i: 0, watching: 0.85 }, { i: 1, watching: 0.6 }, { i: 2, watching: 0.4 }], leaves: [{ i: 1, share: 0.25 }] },
  material: { duration: 600, beats: [{ start: 30 }, { start: 240 }, { start: 450 }] },
};

test('a screening is compared point by point; positive means too optimistic', () => {
  const a = compareScreening(sim, actual);
  assert.equal(a.watchErr, 13); // 55 − 42
  assert.equal(a.hookErr, -13); // 85 − 98
  assert.equal(Math.round(a.ctrRatio * 1000) / 1000, 0.085); // 5.1% ÷ 60%
  assert.equal(a.curve.length, 3);
  assert.equal(a.curve[1].at, 0.4);
  assert.ok(a.curveErr > 0 && a.curveErr < 15);
  assert.equal(a.dropMatch, true, 'predicted drop at 4:00 of 10:00, real cliff at 40%');
  assert.equal(a.verdict, 'fair');
  const noRetention = compareScreening(sim, { ...actual, retention: [], hold30: null });
  assert.equal(noRetention.curveErr, null);
  assert.equal(noRetention.meanErr, 13);
});

test('calibration learns from past misses and corrects the next forecast', () => {
  const sims = [
    { at: 3, projectTitle: 'C', actual: { at: 3 }, accuracy: { watchErr: 10, hookErr: -4, ctrRatio: 0.1, meanErr: 7 } },
    { at: 2, projectTitle: 'B', actual: { at: 2 }, accuracy: { watchErr: 14, hookErr: null, ctrRatio: 0.08, meanErr: 14 } },
    { at: 1, projectTitle: 'A', actual: { at: 1 }, accuracy: { watchErr: 18, hookErr: -8, ctrRatio: null, meanErr: 20 } },
    { at: 0, projectTitle: 'unchecked' },
  ];
  const cal = calibration(sims);
  assert.equal(cal.n, 3);
  assert.deepEqual(cal.watch, { value: 14, n: 3 });
  assert.deepEqual(cal.hook, { value: -6, n: 2 });
  assert.deepEqual(cal.ctrRatio, { value: 0.09, n: 2 });
  assert.deepEqual(cal.history.map((h) => h.meanErr), [20, 14, 7], 'oldest first: getting closer');
  const c = calibrated({ clickShare: 0.5, watchedShare: 0.6, hookHold: 0.8 }, cal);
  assert.equal(Math.round(c.ctr * 10) / 10, 4.5);
  assert.equal(Math.round(c.watched * 100), 46);
  assert.equal(Math.round(c.hookHold * 100), 86);
  assert.match(calibrationLine(cal, 'story'), /predicted 14 points more watch time.*leave earlier/);
  assert.ok(!/opening/.test(calibrationLine(cal, 'story')), 'each stage gets only its own correction');
  assert.match(calibrationLine(cal, 'feed'), /6 points fewer viewers staying past the opening.*not about who clicks/);
  assert.ok(!/watch time/.test(calibrationLine(cal, 'feed')));
  assert.equal(calibrated({ clickShare: 0, watchedShare: null }, cal).ctr, null, 'no click-through estimate when nobody clicked');
  assert.equal(watchShift(cal), -14);
  assert.equal(calibrated({}, calibration([])), null);
  assert.equal(calibrationLine(calibration([]), 'story'), '');
  assert.equal(watchShift({ watch: { value: -60 } }), 25, 'bounded');
});
