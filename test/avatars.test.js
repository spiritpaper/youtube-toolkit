import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAvatar, normalizeWeights, parseAvatars, mergeRegenerated, audienceSheet } from '../src/lib/avatars.js';
import { avatarsPrompt } from '../src/lib/ai.js';

test('avatars are cleaned into a safe, bounded shape', () => {
  const a = normalizeAvatar({ name: 'Maya R.', age: '27', interests: 'gamedev, pixel art; music', knowledge: 'Expert-level', device: 'Phone (Android)', discovery: 'YouTube search', relationship: 'Subscribed', weight: '0.2', extra: 'dropped', beliefs: ['a', 'b'] });
  assert.equal(a.age, 27);
  assert.deepEqual(a.interests, ['gamedev', 'pixel art', 'music']);
  assert.equal(a.knowledge, 'expert');
  assert.equal(a.device, 'phone');
  assert.equal(a.discovery, 'search');
  assert.equal(a.relationship, 'subscriber');
  assert.equal(a.weight, 0.2);
  assert.ok(!('extra' in a));
  assert.equal(normalizeAvatar({ age: 400 }).age, null);
  assert.equal(normalizeAvatar({ name: 'x'.repeat(500) }).name.length, 60);
  assert.equal(normalizeAvatar({}, { source: 'manual' }).source, 'manual');
});

test('weights add up to 1; zero or missing weights share evenly', () => {
  const w = normalizeWeights([{ weight: 2 }, { weight: 1 }, { weight: 1 }]).map((a) => a.weight);
  assert.deepEqual(w, [0.5, 0.25, 0.25]);
  assert.deepEqual(normalizeWeights([{ weight: 0 }, { weight: 0 }]).map((a) => a.weight), [0.5, 0.5]);
});

test('the AI answer is parsed from plain or fenced JSON, and junk fails clearly', () => {
  const arr = [{ name: 'A', age: 30 }, { name: 'B', age: 41 }];
  assert.equal(parseAvatars(JSON.stringify(arr)).length, 2);
  assert.equal(parseAvatars(`Here you go:\n\`\`\`json\n${JSON.stringify(arr)}\n\`\`\`\nEnjoy`)[1].name, 'B');
  assert.throws(() => parseAvatars('Sorry, I cannot do that.'), /unexpected format/);
});

test('regenerating keeps locked avatars and fills the rest', () => {
  const current = [normalizeAvatar({ name: 'Keep', locked: true, weight: 1 }), normalizeAvatar({ name: 'Drop', weight: 1 })];
  const fresh = [{ name: 'New1', weight: 1 }, { name: 'Keep', weight: 1 }, { name: 'New2', weight: 1 }].map((x) => normalizeAvatar(x));
  const out = mergeRegenerated(current, fresh, 3);
  assert.deepEqual(out.map((a) => a.name), ['Keep', 'New1', 'New2']);
  assert.equal(Math.round(out.reduce((n, a) => n + a.weight, 0) * 100) / 100, 1);
});

test('the data sheet carries real shares and comments, without author names', () => {
  const sheet = audienceSheet({
    channel: { title: 'Dev Diaries', subs: 5200 },
    niche: 'indie gamedev vlogs',
    profile: {
      days: 90,
      demographics: [{ ageGroup: 'age18-24', gender: 'male', viewerPercentage: 30 }, { ageGroup: 'age25-34', gender: 'male', viewerPercentage: 45 }, { ageGroup: 'age25-34', gender: 'female', viewerPercentage: 25 }],
      countries: [{ country: 'US', views: 600 }, { country: 'DE', views: 400 }],
      devices: [{ deviceType: 'MOBILE', views: 700 }, { deviceType: 'DESKTOP', views: 300 }],
      subscribed: [{ subscribedStatus: 'SUBSCRIBED', views: 200, averageViewPercentage: 55 }, { subscribedStatus: 'UNSUBSCRIBED', views: 800, averageViewPercentage: 31 }],
      traffic: [{ insightTrafficSourceType: 'BROWSE', views: 500 }, { insightTrafficSourceType: 'YT_SEARCH', views: 500 }],
    },
    videos: [{ title: 'I built a game in 7 days', views: 40000, multiplier: 2.4 }],
    comments: [{ text: 'this helped me finally ship', likes: 12, author: 'SecretName' }],
  });
  assert.match(sheet, /Viewer age .*18–24: 30%, 25–34: 70%/);
  assert.match(sheet, /male: 75%, female: 25%/);
  assert.match(sheet, /US 60%, DE 40%/);
  assert.match(sheet, /mobile 70%/);
  assert.match(sheet, /not subscribed 80% of views \(avg 31% watched\)/);
  assert.match(sheet, /home feed \/ browse 50%/);
  assert.match(sheet, /"this helped me finally ship" \(12 likes\)/);
  assert.ok(!sheet.includes('SecretName'));
  assert.ok(!/undefined|NaN/.test(sheet));
  assert.equal(audienceSheet({}), '');
});

test('the avatar prompt asks for composites, a realistic mix and JSON only', () => {
  const { system, prompt } = avatarsPrompt('SHEET', 8, 'gamedev', { keep: [normalizeAvatar({ name: 'Keep', age: 30, occupation: 'nurse', wants: 'calm' })], focus: 'newcomers from search' });
  assert.match(system, /fictional composites/);
  assert.match(system, /without judgment/);
  assert.match(prompt, /SHEET/);
  assert.match(prompt, /create 8 NEW ones/);
  assert.match(prompt, /newcomers from search/);
  assert.match(prompt, /ONLY a JSON array/);
});

test('groups and avatars are stored with balanced weights and a size limit', async () => {
  const store = {};
  globalThis.chrome = { storage: { local: {
    async get(k) { const l = typeof k === 'string' ? [k] : k; return Object.fromEntries(l.filter((x) => x in store).map((x) => [x, structuredClone(store[x])])); },
    async set(o) { Object.assign(store, structuredClone(o)); },
  } } };
  const s = await import('../src/lib/avatars-store.js');
  const g = await s.saveGroup({ name: '  My audience ', avatars: [{ name: 'A', weight: 3 }, { name: 'B', weight: 1 }] });
  assert.equal(g.name, 'My audience');
  assert.deepEqual(g.avatars.map((a) => a.weight), [0.75, 0.25]);
  const g2 = await s.saveAvatar(g.id, { name: 'C', weight: 4, source: 'manual' });
  assert.equal(g2.avatars.length, 3);
  assert.equal(g2.avatars[2].source, 'manual');
  const edited = await s.saveAvatar(g.id, { ...g2.avatars[0], name: 'A2' });
  assert.equal(edited.avatars.length, 3);
  assert.equal(edited.avatars[0].name, 'A2');
  await s.deleteAvatar(g.id, edited.avatars[1].id);
  assert.equal((await s.listGroups())[g.id].avatars.length, 2);
  for (let i = 0; i < 18; i++) await s.saveAvatar(g.id, { name: `X${i}` });
  await assert.rejects(s.saveAvatar(g.id, { name: 'too many' }), /up to 20/);
  await s.deleteGroup(g.id);
  await assert.rejects(s.saveAvatar(g.id, { name: 'gone' }), /deleted/);
  const after = await s.saveGroup({ name: 'Next' });
  assert.ok(after.id, 'writes keep working after a failed one');
});
