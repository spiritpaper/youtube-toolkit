// Checks each provider's request shape and response parsing with a fake fetch.
import { test } from 'node:test';
import assert from 'node:assert/strict';

let last;
let reply;
globalThis.fetch = async (url, init = {}) => {
  last = { url: String(url), init, body: init.body ? JSON.parse(init.body) : null };
  const { status = 200, body } = reply(last);
  return { ok: status < 400, status, json: async () => body };
};
globalThis.chrome = { storage: { local: { get: async () => ({}) } }, permissions: { contains: async () => true } };

const ai = await import('../src/lib/ai.js');
const image = { mime: 'image/jpeg', data: 'QUJD' };
const args = { key: 'k', system: 'SYS', prompt: 'PROMPT', image };

test('gemini', async () => {
  reply = () => ({ body: { candidates: [{ content: { parts: [{ text: 'Hello ' }, { text: 'world' }] } }] } });
  const text = await ai.generate({ ...args, provider: 'gemini', model: 'gemini-3.6-flash' });
  assert.equal(text, 'Hello world');
  assert.match(last.url, /models\/gemini-3\.6-flash:generateContent$/);
  assert.equal(last.init.headers['x-goog-api-key'], 'k');
  assert.equal(last.body.system_instruction.parts[0].text, 'SYS');
  assert.deepEqual(last.body.contents[0].parts[0], { inline_data: { mime_type: 'image/jpeg', data: 'QUJD' } });
  assert.ok(!('generationConfig' in last.body), 'no sampling params (deprecated on Gemini 3.6)');
});

test('gemini blocked response becomes a readable error', async () => {
  reply = () => ({ body: { promptFeedback: { blockReason: 'SAFETY' } } });
  await assert.rejects(ai.generate({ ...args, provider: 'gemini', model: 'm' }), /SAFETY/);
});

test('openai and openrouter use chat completions with a data-URL image', async () => {
  reply = () => ({ body: { choices: [{ message: { content: 'ok' } }] } });
  assert.equal(await ai.generate({ ...args, provider: 'openai', model: 'gpt-5.4-mini' }), 'ok');
  assert.equal(last.url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(last.init.headers.authorization, 'Bearer k');
  assert.equal(last.body.messages[0].role, 'system');
  assert.equal(last.body.messages[1].content[1].image_url.url, 'data:image/jpeg;base64,QUJD');
  await ai.generate({ ...args, provider: 'openrouter', model: 'google/gemini-3.6-flash' });
  assert.equal(last.url, 'https://openrouter.ai/api/v1/chat/completions');
});

test('anthropic sends browser-access header, fallbacks for current models, and skips thinking blocks', async () => {
  reply = () => ({ body: { stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: 'Claude says hi' }] } });
  const text = await ai.generate({ ...args, provider: 'anthropic', model: 'claude-opus-5-5' });
  assert.equal(text, 'Claude says hi');
  const hd = last.init.headers;
  assert.equal(hd['anthropic-dangerous-direct-browser-access'], 'true');
  assert.equal(hd['anthropic-version'], '2023-06-01');
  assert.equal(hd['anthropic-beta'], 'server-side-fallback-2026-07-01');
  assert.equal(last.body.fallbacks, 'default');
  assert.equal(last.body.system, 'SYS');
  assert.equal(last.body.messages[0].content[0].source.type, 'base64');
  assert.ok(!('temperature' in last.body) && !('thinking' in last.body));

  await ai.generate({ ...args, provider: 'anthropic', model: 'claude-haiku-5-5' });
  assert.ok(!('fallbacks' in last.body));
});

test('anthropic refusal is surfaced', async () => {
  reply = () => ({ body: { stop_reason: 'refusal', stop_details: { explanation: 'nope' }, content: [] } });
  await assert.rejects(ai.generate({ ...args, provider: 'anthropic', model: 'claude-opus-5-5' }), /declined.*nope/);
});

test('HTTP errors name the provider', async () => {
  reply = () => ({ status: 401, body: { error: { message: 'bad key' } } });
  await assert.rejects(ai.generate({ ...args, provider: 'openai', model: 'x' }), /OpenAI rejected the key: bad key/);
});

test('listModels filters to text models and picks a suggested default', async () => {
  reply = () => ({
    body: {
      models: [
        { name: 'models/gemini-3.6-flash', displayName: 'Gemini 3.6 Flash', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/text-embedding-005', supportedGenerationMethods: ['embedContent'] },
        { name: 'models/gemini-3.6-flash-tts', supportedGenerationMethods: ['generateContent'] },
      ],
    },
  });
  const models = await ai.listModels('gemini', 'k');
  assert.deepEqual(models.map((m) => m.id), ['gemini-3.6-flash']);
  assert.equal(ai.pickDefaultModel('gemini', models), 'gemini-3.6-flash'); // newest suggested one present
  assert.equal(ai.pickDefaultModel('openai', [{ id: 'gpt-x' }]), 'gpt-x');
});

test('prompts include the stats and the creator niche', () => {
  const idea = { title: 'I tried X', channelTitle: 'Ch', format: 'long', views: 90000, publishedAt: '2026-01-01T00:00:00Z', stats: { multiplier: 4.5, baselineMedian: 20000, percentile: 98, trend: 'growing' } };
  const b = ai.breakdownPrompt(idea, 'cooking for students');
  assert.match(b.prompt, /4\.5x the channel's median/);
  assert.match(b.prompt, /cooking for students/);
  const g = ai.ideasPrompt([idea], '');
  assert.match(g.prompt, /"I tried X" by Ch/);
});

test('a network blip or 503 is retried once', async () => {
  let calls = 0;
  reply = () => (++calls === 1 ? { status: 503, body: { error: { message: 'overloaded' } } } : { body: { choices: [{ message: { content: 'second try' } }] } });
  assert.equal(await ai.generate({ ...args, provider: 'openai', model: 'x' }), 'second try');
  assert.equal(calls, 2);
  calls = 0;
  reply = () => (++calls, { status: 503, body: { error: { message: 'still overloaded' } } });
  await assert.rejects(ai.generate({ ...args, provider: 'openai', model: 'x' }), /still overloaded/);
  assert.equal(calls, 2, 'only one retry');
});

test('several images are sent in order to each provider', async () => {
  const imgs = [{ mime: 'image/jpeg', data: 'AAA' }, { mime: 'image/png', data: 'BBB' }];
  reply = () => ({ body: { candidates: [{ content: { parts: [{ text: 'ok' }] } }] } });
  await ai.generate({ provider: 'gemini', key: 'k', model: 'm', system: 's', prompt: 'p', images: imgs });
  assert.deepEqual(last.body.contents[0].parts.map((p) => p.inline_data?.data ?? p.text), ['AAA', 'BBB', 'p']);
  reply = () => ({ body: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] } });
  await ai.generate({ provider: 'anthropic', key: 'k', model: 'claude-haiku-5-5', system: 's', prompt: 'p', images: imgs });
  assert.deepEqual(last.body.messages[0].content.map((c) => c.source?.data ?? c.text), ['AAA', 'BBB', 'p']);
  reply = () => ({ body: { choices: [{ message: { content: 'ok' } }] } });
  await ai.generate({ provider: 'openai', key: 'k', model: 'm', system: 's', prompt: 'p', images: imgs });
  assert.equal(last.body.messages[1].content.length, 3);
});
