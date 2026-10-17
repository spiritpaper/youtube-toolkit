import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitMaterial, avatarBrief, extractJsonArray, cleanFeed, cleanStory, aggregate, reportText } from '../src/lib/screening.js';
import { feedHookPrompt, storyPrompt, screeningSummaryPrompt } from '../src/lib/ai.js';
import { normalizeAvatar } from '../src/lib/avatars.js';

const sentence = (i) => `This is sentence number ${i} of the script and it keeps going a little.`;
const script = Array.from({ length: 120 }, (_, i) => sentence(i)).join(' ');

test('a script splits into a ~30 s hook and timed beats of similar length', () => {
  const m = splitMaterial({ script });
  assert.equal(m.hook.text.split(' ').length, 75);
  assert.equal(m.hook.end, 30);
  assert.ok(m.beats.length >= 5 && m.beats.length <= 8, `${m.beats.length} beats`);
  assert.equal(m.beats[0].start, 30);
  assert.ok(m.beats.every((b, i) => i === 0 || b.start > m.beats[i - 1].start));
  assert.ok(m.beats.every((b) => /\.$/.test(b.text)), 'beats end on a sentence');
  assert.ok(m.duration > 400);
});

test('without a script, outline lines become a hook and beats', () => {
  const m = splitMaterial({ outline: '## Plan\n- Cold open on the broken build\n- Day 1: the plan\n- Day 3: the crash\n- Day 7: ship it' });
  assert.equal(m.hook.text, 'Plan');
  assert.equal(m.beats.length, 4);
  assert.equal(m.beats[0].start, null);
  assert.equal(m.outline, true);
  assert.deepEqual(splitMaterial({}).beats, []);
});

const avatars = [
  normalizeAvatar({ id: 'a', name: 'Maya', age: 27, weight: 0.5, occupation: 'dev' }),
  normalizeAvatar({ id: 'b', name: 'Raj', age: 21, weight: 0.3 }),
  normalizeAvatar({ id: 'c', name: 'Lena', age: 35, weight: 0.2 }),
];

test('answers are cleaned: unknown viewers dropped, beats after leaving cut', () => {
  const feed = cleanFeed([
    { id: 'a', click: 'YES', firstThought: 'ooh', stay: true },
    { id: 'b', click: 'maybe', stay: false, leaveAt: 12 },
    { id: 'c', click: 'no', stay: true },
    { id: 'zzz', click: 'yes' },
  ], avatars);
  assert.deepEqual(Object.keys(feed), ['a', 'b', 'c']);
  assert.equal(feed.a.click, 'yes');
  assert.equal(feed.b.leaveAt, 12);
  assert.equal(feed.c.stay, null, 'non-clickers never see the hook');
  const story = cleanStory([
    { id: 'a', beats: [{ i: 0, attention: 8, emotion: 'curious' }, { i: 1, attention: 3, emotion: 'bored', leave: true }, { i: 2, attention: 9 }] },
    { id: 'b', beats: [{ i: 0, attention: 11 }, { i: 1, attention: 7 }, { i: 2, attention: 8 }], end: { score: 8, like: 'yes', comment: 'nice', subscribe: true } },
  ], avatars, 3);
  assert.equal(story.a.beats.length, 2);
  assert.equal(story.a.leftAt, 1);
  assert.equal(story.a.end, null);
  assert.equal(story.b.beats[0].attention, 10, 'clamped');
  assert.equal(story.b.end.like, true);
});

test('numbers are weighted by audience share', () => {
  const feed = cleanFeed([{ id: 'a', click: 'yes', stay: true }, { id: 'b', click: 'maybe', stay: true }, { id: 'c', click: 'no' }], avatars);
  const story = cleanStory([
    { id: 'a', beats: [{ i: 0, attention: 8, emotion: 'curious' }, { i: 1, attention: 3, emotion: 'bored', leave: true }] },
    { id: 'b', beats: [{ i: 0, attention: 6, emotion: 'curious' }, { i: 1, attention: 7, emotion: 'tense' }], end: { score: 8, like: true, subscribe: true } },
  ], avatars, 2);
  const r = aggregate(avatars, feed, story, 2);
  const near = (x) => Math.round(x * 1000) / 1000;
  assert.equal(near(r.clickShare), 0.65); // 0.5 yes + 0.5 × 0.3 maybe
  assert.equal(r.hookHold, 1);
  assert.equal(Math.round(r.curve[0].attention * 100) / 100, 7.25); // (8×.5 + 6×.3) / .8
  assert.equal(r.curve[0].emotion, 'curious');
  assert.deepEqual(r.leaves.map((l) => ({ ...l, share: near(l.share) })), [{ i: 1, share: 0.625, who: ['a'] }]);
  assert.equal(near(r.finishShare), 0.375);
  assert.equal(r.score, 8);
  assert.equal(r.subscribe, 1);
  assert.ok(r.watchedShare > 0.6 && r.watchedShare < 1);
  assert.deepEqual(r.counts, { avatars: 3, clicked: 2, stayed: 2, finished: 1 });

  const text = reportText({ avatars, feed, story, result: r, material: { beats: [{ start: 30, first: 'Day one.' }, { start: 75, first: 'The crash.' }] } });
  assert.match(text, /Would click: 65%/);
  assert.match(text, /Beat 1 \(1:15\) "The crash\.": attention 4\.5\/10, bored; left here: Maya/);
  assert.ok(!/undefined|NaN|""|\(\)/.test(text), text);
});

test('JSON is found in fenced or chatty answers', () => {
  assert.deepEqual(extractJsonArray('Sure!\n```json\n[{"id":"a"}]\n```'), [{ id: 'a' }]);
  assert.throws(() => extractJsonArray('no json here'), /unexpected format/);
});

test('prompts anchor to real numbers and ask for honest, unjudged reactions', () => {
  const briefs = avatars.map(avatarBrief);
  assert.match(briefs[0], /^\[a\] Maya, 27/);
  const f = feedHookPrompt({ avatars: briefs, title: 'I built a game in 7 days', hook: 'Day six.', neighbors: ['Other video'], baseline: { ctr: 4.2, avgViewed: 31 } });
  assert.match(f.system, /without judging the viewer/);
  assert.match(f.prompt, /"Other video"/);
  assert.match(f.prompt, /4\.2% of people shown a video click/);
  assert.match(f.prompt, /31% of a video/);
  const s = storyPrompt({ avatars: briefs, title: 'T', beats: [{ i: 0, start: 30, text: 'Day one.' }] });
  assert.match(s.prompt, /\[beat 0\] 0:30 Day one\./);
  const sum = screeningSummaryPrompt({ title: 'T', report: 'R', principles: ['Stakes', 'Value shift'] });
  assert.match(sum.prompt, /Principle:.*Stakes, Value shift/);
  assert.ok(!/Principle/.test(screeningSummaryPrompt({ title: 'T', report: 'R' }).prompt));
});

test('each viewer gets a realistic expected watch time, from real numbers when known', async () => {
  const { expectedWatch } = await import('../src/lib/screening.js');
  const sub = normalizeAvatar({ relationship: 'subscriber', device: 'tv' });
  const fresh = normalizeAvatar({ relationship: 'new', device: 'phone' });
  assert.equal(expectedWatch(sub), 58); // 50 + 8 (TV)
  assert.equal(expectedWatch(fresh), 26); // 30 - 4 (phone)
  const real = { bySub: { subscribed: 61, unsubscribed: 24 } };
  assert.equal(expectedWatch(sub, real), 69);
  assert.equal(expectedWatch(fresh, real), 20);
  assert.equal(expectedWatch(normalizeAvatar({ relationship: 'returning', device: 'computer' }), real), 45); // (61+24)/2 + 2, rounded
  const s = storyPrompt({ avatars: ['x'], title: 'T', beats: [{ i: 0, start: 30, text: 'a' }] });
  assert.match(s.prompt, /WATCHING, not reading/);
  assert.match(s.prompt, /everyone finishes is unrealistic/);
});
