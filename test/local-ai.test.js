import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanUrl, contextFor, wantsJsonObject, detectServer, localGenerate, stripThinking, LocalAiError } from '../src/lib/local-ai.js';

test('only addresses on this computer are allowed', () => {
  assert.equal(cleanUrl(''), 'http://localhost:11434');
  assert.equal(cleanUrl(' http://127.0.0.1:1234/v1 '), 'http://127.0.0.1:1234');
  assert.equal(cleanUrl('http://localhost:11434/api/'), 'http://localhost:11434');
  assert.throws(() => cleanUrl('http://192.168.1.5:11434'), LocalAiError);
  assert.throws(() => cleanUrl('file:///etc'), LocalAiError);
  assert.throws(() => cleanUrl('not a url'), LocalAiError);
});

test('the context window fits the prompt and its answer, in steps, up to the limit', () => {
  assert.equal(contextFor({ system: 'x'.repeat(320), prompt: 'y'.repeat(3200) }).ctx, 8192);
  const big = contextFor({ prompt: 'y'.repeat(14000 * 3.2) }); // ~14k in + 8k answer
  assert.equal(big.ctx, 32768);
  assert.equal(contextFor({ prompt: 'short', images: 2 }).ctx, 8192);
  assert.equal(contextFor({ prompt: 'short', images: 4 }).ctx, 16384);
  assert.throws(() => contextFor({ prompt: 'y'.repeat(40000 * 3.2) }, 32768), /needs about 48k tokens.*32k/);
});

test('JSON mode only for prompts that want one object', () => {
  assert.ok(wantsJsonObject('Reply with ONLY a JSON object:\n{…}'));
  assert.ok(!wantsJsonObject('Reply with ONLY a JSON array'));
  assert.equal(stripThinking('<think>hmm</think>\n\nAnswer'), 'Answer');
});

function mockFetch(routes) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url, body: init.body ? JSON.parse(init.body) : null });
    const path = new URL(url).pathname;
    const r = routes[path];
    if (!r) return { ok: false, status: 404, json: async () => ({}) };
    const out = typeof r === 'function' ? r(init.body ? JSON.parse(init.body) : null) : r;
    return { ok: (out.status ?? 200) < 400, status: out.status ?? 200, json: async () => out.body };
  };
  return calls;
}

test('detects Ollama and which models can see images', async () => {
  mockFetch({
    '/api/tags': { body: { models: [{ name: 'qwen3.5:4b', size: 3.4e9 }, { name: 'llama3.1:8b', size: 4.9e9 }, { name: 'nomic-embed-text' }] } },
    '/api/show': (b) => ({ body: { capabilities: b.model.startsWith('qwen') ? ['completion', 'vision', 'thinking'] : ['completion'] } }),
  });
  const s = await detectServer('http://localhost:11434');
  assert.equal(s.kind, 'ollama');
  assert.deepEqual(s.models.map((m) => [m.id, m.vision, m.thinking]), [['qwen3.5:4b', true, true], ['llama3.1:8b', false, false]]);
  assert.match(s.models[0].label, /3\.4 GB · sees images/);
});

test('falls back to an OpenAI-compatible server (LM Studio)', async () => {
  mockFetch({ '/v1/models': { body: { data: [{ id: 'qwen3.5-9b' }, { id: 'text-embedding-x' }] } } });
  const s = await detectServer('http://localhost:1234');
  assert.equal(s.kind, 'openai');
  assert.deepEqual(s.models.map((m) => m.id), ['qwen3.5-9b']);
});

test('Ollama requests carry the context, thinking choice and JSON mode', async () => {
  const calls = mockFetch({ '/api/chat': { body: { message: { content: '<think>x</think>{"a":1}' }, done_reason: 'stop' } } });
  const local = { url: 'http://localhost:11434', kind: 'ollama', maxCtx: 32768, think: false, thinking: { 'qwen3.5:4b': true, 'llama3.1:8b': false }, vision: { 'llama3.1:8b': false } };
  const text = await localGenerate({ model: 'qwen3.5:4b', system: 'sys', prompt: 'Reply with ONLY a JSON object', images: [{ mime: 'image/jpeg', data: 'AAA' }], local });
  assert.equal(text, '{"a":1}');
  const b = calls[0].body;
  assert.equal(b.options.num_ctx, 8192);
  assert.equal(b.think, false);
  assert.equal(b.format, 'json');
  assert.deepEqual(b.messages[1].images, ['AAA']);
  await localGenerate({ model: 'llama3.1:8b', system: 's', prompt: 'p', local });
  assert.ok(!('think' in calls[1].body), 'no think flag for models without thinking');
  await assert.rejects(localGenerate({ model: 'llama3.1:8b', system: 's', prompt: 'p', images: [{ mime: 'image/png', data: 'B' }], local }), /can't see images/);
});

test('clear errors when the model runs out of room or the server is down', async () => {
  mockFetch({ '/api/chat': { body: { message: { content: 'half an ans' }, done_reason: 'length' } } });
  await assert.rejects(localGenerate({ model: 'm', system: 's', prompt: 'p', local: { kind: 'ollama' } }), /ran out of room/);
  mockFetch({ '/api/chat': { status: 403, body: {} } });
  await assert.rejects(localGenerate({ model: 'm', system: 's', prompt: 'p', local: { kind: 'ollama' } }), /refused the extension/);
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(localGenerate({ model: 'm', system: 's', prompt: 'p', local: { kind: 'ollama' } }), /Is Ollama .* running/);
});
