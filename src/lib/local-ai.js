// Local AI: Ollama, or any OpenAI-compatible server (LM Studio, llama.cpp,
// Jan…) on this computer. No key, nothing leaves the machine.
//
// Two things make small local models work here:
// - Context: Ollama silently drops the start of a prompt that doesn't fit
//   (the instructions!). Each request asks for a context window big enough
//   for its prompt and answer, in steps, up to the limit set in Settings,
//   and fails with a clear message beyond it.
// - Origin: Ollama refuses browser extensions by default. A background rule
//   (declarativeNetRequest) removes the Origin header on this extension's
//   own requests to localhost, so no Ollama setting is needed.

export const LOCAL_DEFAULT_URL = 'http://localhost:11434';
export const LOCAL_ORIGINS = ['http://localhost/*', 'http://127.0.0.1/*'];
export const CTX_STEPS = [8192, 16384, 32768, 65536, 131072];
export const DEFAULT_MAX_CTX = 32768;
const IMAGE_TOKENS = 1200; // a thumbnail, roughly, for current vision models

export class LocalAiError extends Error {}

/** About how many tokens a text is (≈3.2 characters each, erring high). */
export const estimateTokens = (text) => Math.ceil(String(text ?? '').length / 3.2);

/** Only localhost / 127.0.0.1 over http(s); returns the cleaned base URL or throws. */
export function cleanUrl(input) {
  let u;
  try {
    u = new URL(String(input ?? '').trim() || LOCAL_DEFAULT_URL);
  } catch {
    throw new LocalAiError('That isn\'t a web address. Use something like http://localhost:11434.');
  }
  if (!/^https?:$/.test(u.protocol) || !['localhost', '127.0.0.1'].includes(u.hostname)) {
    throw new LocalAiError('Local AI must run on this computer: use http://localhost:<port> or http://127.0.0.1:<port>.');
  }
  return `${u.protocol}//${u.host}${u.pathname.replace(/\/(v1|api)?\/?$/, '')}`;
}

/**
 * The context window for one request: room for the prompt, the images and
 * the answer, rounded up to a step. { ctx, need, input } or throws if it's
 * over `maxCtx`.
 */
export function contextFor({ system = '', prompt = '', images = 0 }, maxCtx = DEFAULT_MAX_CTX) {
  const input = estimateTokens(system) + estimateTokens(prompt) + images * IMAGE_TOKENS;
  // Answers to big prompts are big too (a screening writes per viewer, per beat).
  const answer = Math.min(8192, Math.max(2048, Math.round(input * 0.8)));
  const need = input + answer;
  const ctx = CTX_STEPS.find((s) => s >= need);
  if (!ctx || ctx > maxCtx) {
    throw new LocalAiError(`This request needs about ${Math.round(need / 1000)}k tokens of context, more than the ${Math.round(maxCtx / 1024)}k your local AI is set to. Raise "Context window" in Settings → AI (it uses more memory), use fewer avatars or a shorter script, or switch to a cloud provider for this one.`);
  }
  return { ctx, need, input };
}

/** Prompts that want one JSON object can use Ollama's JSON mode (it can't do arrays). */
export const wantsJsonObject = (prompt) => /reply with only (a|one) json object/i.test(prompt);

async function call(url, init, what) {
  let res;
  try {
    res = await fetch(url, init);
  } catch {
    throw new LocalAiError(`Couldn't reach your local AI at ${new URL(url).host}. Is Ollama (or LM Studio's server) running?`);
  }
  const body = await res.json().catch(() => ({}));
  if (res.status === 403) throw new LocalAiError('Your local AI refused the extension (403). Reload the extension once; if it persists, see the Local AI guide (OLLAMA_ORIGINS).');
  if (!res.ok) {
    const msg = body.error?.message ?? body.error ?? `HTTP ${res.status}`;
    throw new LocalAiError(`${what}: ${msg}`);
  }
  return body;
}

/**
 * What's at `url`: Ollama or an OpenAI-compatible server, and its models
 * [{ id, label, vision }] (vision: true/false, or null if unknown).
 */
export async function detectServer(input) {
  const url = cleanUrl(input);
  const tags = await fetch(`${url}/api/tags`).then((r) => (r.ok ? r.json() : null), () => null);
  if (tags?.models) {
    const models = await Promise.all(tags.models.filter((m) => !/embed/i.test(m.name)).map(async (m) => {
      const info = await call(`${url}/api/show`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: m.name }) }, 'Ollama').catch(() => null);
      const caps = info?.capabilities ?? null;
      const vision = caps ? caps.includes('vision') : null;
      const size = m.size ? ` · ${(m.size / 1e9).toFixed(1)} GB` : '';
      return { id: m.name, label: `${m.name}${size}${vision ? ' · sees images' : ''}`, size: m.size ?? null, vision, thinking: caps ? caps.includes('thinking') : null };
    }));
    return { kind: 'ollama', url, models };
  }
  const list = await call(`${url}/v1/models`, {}, 'Local AI');
  return { kind: 'openai', url, models: (list.data ?? []).filter((m) => !/embed/i.test(m.id)).map((m) => ({ id: m.id, label: m.id, vision: null, thinking: null })) };
}

/**
 * One generation. local: { url, kind, maxCtx, think, vision: { model: bool } }.
 * Returns the text.
 */
export async function localGenerate({ model, system, prompt, images = [], local = {} }) {
  const url = cleanUrl(local.url);
  if (images.length && local.vision?.[model] === false) {
    throw new LocalAiError(`${model} can't see images. Pick a model that can (marked "sees images" in Settings → AI), or run this without the thumbnail.`);
  }
  const { ctx, input } = contextFor({ system, prompt, images: images.length }, local.maxCtx ?? DEFAULT_MAX_CTX);
  if (local.kind === 'openai') {
    const content = [{ type: 'text', text: prompt }, ...images.map((img) => ({ type: 'image_url', image_url: { url: `data:${img.mime};base64,${img.data}` } }))];
    const body = await call(`${url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, { role: 'user', content: images.length ? content : prompt }], stream: false }),
    }, 'Local AI');
    const choice = body.choices?.[0];
    if (choice?.finish_reason === 'length') throw new LocalAiError('The local model ran out of room before finishing. Load it with a bigger context length in your AI app, or use a cloud provider for this one.');
    const text = stripThinking(choice?.message?.content ?? '');
    if (!text) throw new LocalAiError('The local model returned no text.');
    return text;
  }
  const payload = {
    model,
    messages: [{ role: 'system', content: system }, { role: 'user', content: prompt, ...(images.length ? { images: images.map((img) => img.data) } : {}) }],
    stream: false,
    options: { num_ctx: ctx, num_predict: ctx - input },
    ...(wantsJsonObject(prompt) ? { format: 'json' } : {}),
  };
  // Thinking is slow on small models; off unless asked for (and only where supported).
  if (local.thinking?.[model] !== false) payload.think = !!local.think;
  const body = await call(`${url}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }, 'Ollama');
  if (body.done_reason === 'length') throw new LocalAiError('The local model ran out of room before finishing. Raise "Context window" in Settings → AI, or use a cloud provider for this one.');
  const text = stripThinking(body.message?.content ?? '');
  if (!text) throw new LocalAiError('The local model returned no text.');
  return text;
}

/** Some models write their reasoning inline as <think>…</think>; keep only the answer. */
export const stripThinking = (text) => String(text).replace(/<think>[\s\S]*?<\/think>\s*/gi, '').trim();
