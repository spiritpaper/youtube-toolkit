import { test } from 'node:test';
import assert from 'node:assert/strict';
import { titleChecks, similarTitles, features } from '../src/lib/titles.js';
import { contentGaps } from '../src/lib/gaps.js';

test('titleChecks flags long, keyword-less, shouty titles', () => {
  const good = titleChecks('I Tried Living on $10 a Day in Tokyo (Big Mistake)', { keyword: 'tokyo', thumbnailText: 'NEVER AGAIN' });
  const bad = titleChecks('THIS IS THE MOST AMAZING VLOG EVER OF OUR WHOLE FAMILY TRIP TO THE BEACH AND MOUNTAINS IN SUMMER', { keyword: 'tokyo' });
  assert.ok(good.score > 80, `good ${good.score}`);
  assert.ok(bad.score < 40, `bad ${bad.score}`);
  const byId = (r, id) => r.checks.find((c) => c.id === id);
  assert.equal(byId(bad, 'length').pass, false);
  assert.equal(byId(bad, 'caps').pass, false);
  assert.equal(byId(bad, 'keyword').pass, false);
  assert.equal(byId(good, 'thumbnail').pass, true);
  assert.equal(byId(titleChecks('x'), 'keyword').pass, null, 'not applicable without a keyword');
  assert.equal(byId(titleChecks('Never again in Tokyo', { thumbnailText: 'never again' }), 'thumbnail').pass, false);
});

test('similarTitles finds proven outliers with the same shape', () => {
  const corpus = [
    { title: 'I Spent 7 Days Living on $5 in Seoul', multiplier: 8 },
    { title: 'Coffee brewing basics', multiplier: 1 },
    { title: 'Why Japan Rail Pass Is a Scam', multiplier: 3 },
  ];
  const out = similarTitles('I Lived on $10 a Day in Tokyo for 30 Days', corpus);
  assert.equal(out[0].title, 'I Spent 7 Days Living on $5 in Seoul');
  assert.ok(out[0].sharedFeatures.includes('money'));
  assert.ok(!out.some((o) => o.title === 'Coffee brewing basics'));
  assert.deepEqual(features('Is the Japan Rail Pass worth it?').includes('question'), true);
});

test('contentGaps surfaces competitor outlier topics you have not covered', () => {
  const o = (id, title, multiplier, ch) => ({ id, title, multiplier, channelTitle: ch });
  const outliers = [
    o('a', 'Japan Rail Pass: Worth It in 2026?', 4, 'Rail Nerd'),
    o('b', 'I Rode Every Japan Rail Line', 3, 'Budget Bob'),
    o('c', 'Hostel Hacks Nobody Tells You', 2.5, 'Hostel Tales'),
    o('d', 'Hostel Hacks for Solo Women', 2.2, 'Solo Sam'),
    o('e', 'Living in a Van for a Year', 7, 'Van Life'),
    o('f', 'Coffee in Rome', 2.1, 'Budget Bob'),
  ];
  const gaps = contentGaps(outliers, ['My Hostel Hacks after 40 countries', 'Tokyo on a budget']);
  const topics = gaps.map((g) => g.topic);
  assert.ok(topics.includes('japan rail'), topics.join(', '));
  assert.ok(topics.some((t) => t.includes('van')), 'a single 5x+ breakout counts');
  assert.ok(!topics.some((t) => t.includes('hostel')), 'already covered by my titles');
  assert.ok(!topics.includes('rome'), 'one weak outlier is not a gap');
  const rail = gaps.find((g) => g.topic === 'japan rail');
  assert.deepEqual(rail.channels.sort(), ['Budget Bob', 'Rail Nerd']);
  assert.ok(!topics.includes('rail') || topics.indexOf('japan rail') < topics.indexOf('rail'));
});

test('contentGaps does not repeat topics that describe the same videos', () => {
  const o = (id, title, multiplier, ch) => ({ id, title, multiplier, channelTitle: ch });
  const gaps = contentGaps(
    [o('c', 'Night Trains Across Europe for $60', 5.5, 'Rail Nerd'), o('d', 'The Cheapest Night Trains in Europe', 2.4, 'Hostel Tales'), o('e', 'Living in a Van for a Year (Real Costs)', 7.3, 'Van Life')],
    [],
  );
  assert.equal(gaps.length, 2, gaps.map((g) => g.topic).join(', '));
  assert.equal(gaps[0].topic, 'night trains');
});

test('with all uploads given, niche-wide words drop out (lift)', () => {
  const o = (id, title, multiplier, ch) => ({ id, title, multiplier, channelTitle: ch });
  const outliers = [o('a', 'Japan Rail Pass Worth It', 4, 'A'), o('b', 'Japan Rail Pass Scam', 3, 'B'), o('c', 'Japan Food Tour', 2.5, 'A')];
  const all = [...outliers.map((x) => x.title), 'Japan Vlog Day 1', 'Japan Vlog Day 2', 'Japan Hotel Review', 'Japan Packing List', 'Japan Weather'];
  const topics = contentGaps(outliers, [], { all }).map((g) => g.topic);
  assert.ok(topics.includes('rail pass'), topics.join(', '));
  assert.ok(!topics.includes('japan'), 'japan is in every upload, so it is not an outlier signal');
});

import { analyzeScript, hookSummary } from '../src/lib/script.js';

const SCRIPT = [
  { start: 0, text: 'I spent 7 days in Tokyo with only $70.' },
  { start: 4, text: "By the end of this video you'll know if it's actually possible." },
  { start: 9, text: 'But first, the rule: no credit cards, no help.' },
  { start: 15, text: 'Day one. So I landed at Narita with a backpack.' },
  { start: 40, text: 'The problem was the train from the airport cost $20.' },
  { start: 70, text: 'That was a huge mistake I would regret later.' },
  { start: 95, text: 'Have you ever tried sleeping in a capsule hotel?' },
  { start: 130, text: 'Tokyo food was cheaper than I expected, Tokyo convenience stores saved me.' },
  { start: 160, text: "This video is sponsored by Nord, use my code below." },
  { start: 200, text: 'Turns out the cheapest meal in Tokyo was 300 yen.' },
  { start: 240, text: 'So, could you survive Tokyo on $70? Subscribe and tell me in the comments.' },
];

test('analyzeScript reads the hook, devices, keywords and structure', () => {
  const heatmap = Array.from({ length: 100 }, (_, i) => ({ start: i * 2.6, duration: 2.6, intensity: i === 77 ? 1 : i === 50 ? 0.8 : 0.3 }));
  const a = analyzeScript(SCRIPT, { title: 'I Survived 7 Days in Tokyo on $70', durationSec: 260, heatmap });
  assert.equal(a.duration, 260);
  assert.ok(a.hook.words > 10 && a.hook.words < 60);
  const check = (label) => a.hook.checks.find((c) => c.label.startsWith(label)).pass;
  assert.equal(check('Echoes the title'), true);
  assert.equal(check('Says what the video'), true);
  assert.equal(check('Opens a loop'), true);
  assert.equal(check('Raises stakes'), true);
  assert.ok(a.counts.openLoop >= 1 && a.counts.turn >= 2 && a.counts.question >= 2 && a.counts.cta >= 2);
  assert.ok(a.devices.some((d) => d.type === 'cta' && d.start === 160));
  assert.equal(a.keywords[0].term, 'tokyo');
  assert.equal(a.titleTerms.find((t) => t.term === 'tokyo').firstAt, 0);
  assert.equal(a.structure.length, 8);
  assert.ok(a.replayed.length >= 1);
  assert.ok(a.replayed.some((r) => r.lines.some((l) => l.text.includes('300 yen'))), 'quotes what was said at the replay peak');
});

test('drop-offs map your retention curve back to the script', () => {
  const retention = Array.from({ length: 100 }, (_, i) => ({ ratio: (i + 1) / 100, watch: i < 61 ? 0.9 - i * 0.004 : 0.55 - i * 0.002 }));
  const a = analyzeScript(SCRIPT, { title: 'x', durationSec: 260, retention });
  assert.ok(a.dropOffs.length >= 1);
  assert.ok(a.dropOffs[0].lines.some((l) => /sponsored/.test(l.text)), JSON.stringify(a.dropOffs[0]));
  assert.ok(hookSummary(SCRIPT, 'Tokyo on $70').passed >= 4);
  assert.equal(analyzeScript([], {}), null);
});

test('hook title match is loose and keywords skip spoken filler', () => {
  const segs = [{ start: 0, text: "It's one of the best Japanese food tours, it's one long day" }, { start: 10, text: "It's one day, one city, one itinerary" }, { start: 40, text: 'Japanese food, Japanese trains, Japanese temples' }];
  const a = analyzeScript(segs, { title: 'Japan Food Itinerary', durationSec: 60 });
  assert.equal(a.hook.checks.find((c) => c.label === 'Echoes the title').pass, true);
  assert.ok(!a.keywords.some((k) => k.term === "it's" || k.term === 'one'), a.keywords.map((k) => k.term).join(','));
  assert.equal(a.keywords[0].term, 'japanese');
});

import { analyzeComments } from '../src/lib/comments.js';

test('analyzeComments sorts the audience into questions, requests, pains and moments', () => {
  const c = (text, likes = 0) => ({ text, likes });
  const a = analyzeComments([
    c('How much did the JR pass cost you?', 50),
    c('Can you make a video about Hokkaido in winter?', 120),
    c('Please make part 2!!', 30),
    c('I wish you showed the hostel prices', 12),
    c('The sushi at 6:52 looked amazing', 40),
    c('6:55 that conveyor belt 😂', 8),
    c('Best video on Japan, thank you', 3),
    c('nice', 1),
  ]);
  assert.equal(a.questions[0].text, 'How much did the JR pass cost you?');
  assert.equal(a.requests[0].likes, 120, 'requests sorted by likes');
  assert.equal(a.requests.length, 2);
  assert.equal(a.pains.length, 1);
  assert.equal(a.moments[0].mentions, 2, 'mentions within ~10s are grouped');
  assert.equal(a.moments[0].start, 412);
  assert.equal(a.praise.length, 1);
});

import { draftSegments, driftZones, rehookCheckpoints, compareScripts } from '../src/lib/script.js';

test('draft scripts are timed, checked for drift and re-hook points', () => {
  const draft = [
    'I tried to see Japan on $40 a day. By the end of this video you will know if it works.',
    'Here is the plan.',
    ...Array.from({ length: 40 }, (_, i) => `On day ${i + 1} we walked around the station and looked at the trains and the shops for a while.`),
    'But then everything changed when the money ran out.',
    ...Array.from({ length: 10 }, () => 'We ate rice balls from the convenience store every single day of the week.'),
  ].join(' ');
  const segs = draftSegments(draft, 150);
  assert.equal(segs[0].start, 0);
  assert.ok(segs.at(-1).start > 240, 'about 4+ minutes at 150 wpm');
  const a = analyzeScript(segs, { title: 'Japan on $40 a Day' });
  const zones = driftZones(a, segs);
  assert.ok(zones.length >= 1 && zones[0].end - zones[0].start >= 60, JSON.stringify(zones[0]));
  const cps = rehookCheckpoints(a, segs);
  assert.equal(cps.length, 3);
  assert.ok(cps.some((c) => !c.covered), 'at least one checkpoint needs a re-hook');
  const rows = compareScripts(a, a);
  assert.equal(rows[0].label, 'Length');
  assert.ok(rows.every((r) => r.mine === r.ref));
});

test('starter shot list: one shot per paragraph, or per 3 sentences for one block', async () => {
  const { starterShotList } = await import('../src/project/production.js');
  const shots = (t) => starterShotList(t).split('\n').filter((l) => /^\d+\./.test(l)).length;
  assert.equal(shots('Intro line about Japan budget trip.\n\nDay one in Osaka and the food was cheap.\n\nDay two we took the train to Kyoto early.\n\nok'), 3);
  const block = Array.from({ length: 9 }, (_, i) => `Sentence number ${i + 1} is here.`).join(' ');
  assert.equal(shots(block), 3);
});
