// Bring-your-own-key AI providers. Called from extension pages (not the
// service worker, which may be suspended during a long generation).

export const PROVIDERS = {
  gemini: {
    label: 'Google Gemini',
    keyUrl: 'https://aistudio.google.com/apikey',
    keyHint: 'AIza…',
    origins: ['https://generativelanguage.googleapis.com/*'],
    // "-latest" aliases always point at Google's current model.
    suggested: ['gemini-flash-latest', 'gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-2.5-flash'],
  },
  openai: {
    label: 'OpenAI',
    keyUrl: 'https://platform.openai.com/api-keys',
    keyHint: 'sk-…',
    origins: ['https://api.openai.com/*'],
    suggested: ['gpt-5.4-mini', 'gpt-5.4'],
  },
  anthropic: {
    label: 'Anthropic Claude',
    keyUrl: 'https://platform.claude.com/settings/keys',
    keyHint: 'sk-ant-…',
    origins: ['https://api.anthropic.com/*'],
    suggested: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'],
  },
  openrouter: {
    label: 'OpenRouter (hundreds of models)',
    keyUrl: 'https://openrouter.ai/keys',
    keyHint: 'sk-or-…',
    origins: ['https://openrouter.ai/*'],
    suggested: ['google/gemini-flash-latest', 'google/gemini-3.6-flash', 'openai/gpt-5.4-mini', 'anthropic/claude-sonnet-5.5'],
  },
};

export class AiError extends Error {}

export async function getAiSettings() {
  const { ai = {} } = await chrome.storage.local.get('ai');
  return { provider: 'gemini', keys: {}, models: {}, niche: '', ...ai };
}

// Settings for the active provider, or null if AI isn't set up.
export async function activeAi() {
  const s = await getAiSettings();
  const key = s.keys[s.provider];
  const model = s.models[s.provider];
  if (!key || !model) return null;
  const granted = await chrome.permissions.contains({ origins: PROVIDERS[s.provider].origins });
  return granted ? { provider: s.provider, key, model, niche: s.niche } : null;
}

async function request(url, init, provider, { retry = true } = {}) {
  let res;
  try {
    res = await fetch(url, init);
  } catch {
    // One automatic retry for network blips.
    if (retry) return new Promise((r) => setTimeout(r, 1500)).then(() => request(url, init, provider, { retry: false }));
    throw new AiError(`Couldn't reach ${PROVIDERS[provider].label}. Check your connection.`);
  }
  // Overloaded or temporarily unavailable (common on busy models): retry once.
  if (retry && (res.status >= 500 || res.status === 429 && /overload|unavailable/i.test(res.statusText))) {
    await new Promise((r) => setTimeout(r, 2500));
    return request(url, init, provider, { retry: false });
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body.error?.message ?? body.message ?? `HTTP ${res.status}`;
    if (res.status === 401 || res.status === 403) throw new AiError(`${PROVIDERS[provider].label} rejected the key: ${msg}`);
    if (res.status === 429) throw new AiError(`${PROVIDERS[provider].label} rate limit or credit limit reached: ${msg}`);
    throw new AiError(`${PROVIDERS[provider].label}: ${msg}`);
  }
  return body;
}

const ANTHROPIC_HEADERS = (key) => ({
  'x-api-key': key,
  'anthropic-version': '2023-06-01',
  'anthropic-dangerous-direct-browser-access': 'true',
  'content-type': 'application/json',
});

// Models whose refusals can be retried server-side on another model.
const ANTHROPIC_FALLBACK = /^claude-(opus-5|sonnet-5-5|fable-5-1)/;

/** Returns [{ id, label }] for the provider, newest-looking first where possible. */
export async function listModels(provider, key) {
  if (provider === 'gemini') {
    const body = await request(
      'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000',
      { headers: { 'x-goog-api-key': key } },
      provider,
    );
    return (body.models ?? [])
      .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
      .map((m) => ({ id: m.name.replace(/^models\//, ''), label: m.displayName }))
      .filter(
        (m) =>
          /^gemini|^gemma/i.test(m.id) &&
          !/embed|tts|image|audio|live|transcribe|robotics|computer-use|omni|nano-banana|deep-research|customtools/i.test(m.id),
      );
  }
  if (provider === 'openai') {
    const body = await request('https://api.openai.com/v1/models', { headers: { authorization: `Bearer ${key}` } }, provider);
    return (body.data ?? [])
      .filter((m) => /^(gpt|o\d|chatgpt)/.test(m.id) && !/audio|realtime|tts|transcribe|image|search|embedding/.test(m.id))
      .sort((a, b) => (b.created ?? 0) - (a.created ?? 0))
      .map((m) => ({ id: m.id, label: m.id }));
  }
  if (provider === 'anthropic') {
    const body = await request('https://api.anthropic.com/v1/models?limit=100', { headers: ANTHROPIC_HEADERS(key) }, provider);
    return (body.data ?? []).map((m) => ({ id: m.id, label: m.display_name ?? m.id }));
  }
  if (provider === 'openrouter') {
    // The model list is public, so also validate the key against a keyed endpoint.
    await request('https://openrouter.ai/api/v1/key', { headers: { authorization: `Bearer ${key}` } }, provider);
    const body = await request('https://openrouter.ai/api/v1/models', {}, provider);
    return (body.data ?? []).map((m) => ({ id: m.id, label: m.name ?? m.id }));
  }
  throw new AiError(`Unknown provider: ${provider}`);
}

export function pickDefaultModel(provider, models) {
  const ids = new Set(models.map((m) => m.id));
  return PROVIDERS[provider].suggested.find((id) => ids.has(id)) ?? models[0]?.id ?? '';
}

/**
 * One-shot text generation. Images are optional: `image` ({ mime, data }
 * base64) or `images` (several, in order). Returns the model's text (Markdown).
 */
export async function generate({ provider, key, model, system, prompt, image, images = [] }) {
  const pics = [...(image ? [image] : []), ...images].filter(Boolean);
  if (provider === 'gemini') {
    const parts = pics.map((img) => ({ inline_data: { mime_type: img.mime, data: img.data } }));
    parts.push({ text: prompt });
    const body = await request(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: 'POST',
        headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
        body: JSON.stringify({ system_instruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts }] }),
      },
      provider,
    );
    const cand = body.candidates?.[0];
    const text = cand?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    if (!text) {
      throw new AiError(`Gemini returned no text (${body.promptFeedback?.blockReason ?? cand?.finishReason ?? 'unknown reason'}).`);
    }
    return text;
  }

  if (provider === 'openai' || provider === 'openrouter') {
    const content = [{ type: 'text', text: prompt }, ...pics.map((img) => ({ type: 'image_url', image_url: { url: `data:${img.mime};base64,${img.data}` } }))];
    const url =
      provider === 'openai' ? 'https://api.openai.com/v1/chat/completions' : 'https://openrouter.ai/api/v1/chat/completions';
    const headers = { authorization: `Bearer ${key}`, 'content-type': 'application/json' };
    if (provider === 'openrouter') headers['X-Title'] = 'YT Toolkit';
    const body = await request(
      url,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content },
          ],
        }),
      },
      provider,
    );
    const text = body.choices?.[0]?.message?.content;
    if (!text) throw new AiError('The model returned no text.');
    return text;
  }

  if (provider === 'anthropic') {
    const content = pics.map((img) => ({ type: 'image', source: { type: 'base64', media_type: img.mime, data: img.data } }));
    content.push({ type: 'text', text: prompt });
    const headers = ANTHROPIC_HEADERS(key);
    const payload = { model, max_tokens: 16000, system, messages: [{ role: 'user', content }] };
    if (ANTHROPIC_FALLBACK.test(model)) {
      headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
      payload.fallbacks = 'default';
    }
    const body = await request(
      'https://api.anthropic.com/v1/messages',
      { method: 'POST', headers, body: JSON.stringify(payload) },
      provider,
    );
    if (body.stop_reason === 'refusal') {
      throw new AiError(`Claude declined this request${body.stop_details?.explanation ? `: ${body.stop_details.explanation}` : '.'}`);
    }
    const text = (body.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    if (!text) throw new AiError('Claude returned no text.');
    return text;
  }

  throw new AiError(`Unknown provider: ${provider}`);
}

// ---------- Prompts ----------

const SYSTEM = `You are a sharp YouTube content strategist. You study outlier videos (videos that got far more views than their channel normally gets) and turn them into repeatable, specific video ideas. Be concrete and practical; avoid generic advice like "make good content". Use Markdown with short headings and bullet points.`;

const pct = (x, d = 1) => (x == null ? 'n/a' : `${(x * 100).toFixed(d)}%`);
const n = (x) => (x == null ? 'n/a' : Math.round(x).toLocaleString('en-US'));
const x2 = (x) => (x == null ? 'n/a' : `${x.toFixed(1)}x`);

function nicheLine(niche) {
  return niche?.trim()
    ? `About my channel: ${niche.trim()}`
    : `I haven't described my channel, so suggest ideas that would work for a small creator in a similar niche.`;
}

// Roughly the first `words` words of a transcript, with timestamps every few lines.
function transcriptExcerpt(segments, words = 1500) {
  const out = [];
  let count = 0;
  for (const [i, seg] of segments.entries()) {
    if (count >= words) break;
    const t = Math.round(seg.start);
    out.push(i % 5 === 0 ? `[${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}] ${seg.text}` : seg.text);
    count += seg.text.split(/\s+/).length;
  }
  return out.join(' ');
}

export function breakdownPrompt(idea, niche, { transcript = null, peaks = null } = {}) {
  const s = idea.stats ?? {};
  const mmss = (sec) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;
  const extra = [
    peaks?.length ? `Most replayed moments (YouTube's replay heatmap): ${peaks.map((p) => mmss(p.start)).join(', ')}` : '',
    transcript?.length ? `Transcript (beginning):\n${transcriptExcerpt(transcript)}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
  return {
    system: SYSTEM,
    prompt: `Analyze this outlier video. The image attached (if any) is its thumbnail.

Title: ${idea.title}
Channel: ${idea.channelTitle} (${n(s.subs)} subscribers, channel trend: ${s.trend ?? 'unknown'})
Format: ${idea.format === 'short' ? 'YouTube Short' : 'long-form video'}${idea.durationSec ? `, ${Math.round(idea.durationSec / 60)} min` : ''}
Published: ${idea.publishedAt?.slice(0, 10)}
Views: ${n(idea.views)} — ${x2(s.multiplier ?? idea.multiplier)} the channel's median (${n(s.baselineMedian ?? idea.baselineMedian)}), ${x2(s.vsAverage)} its average
Percentile among the channel's recent videos: ${s.percentile == null ? 'n/a' : Math.round(s.percentile)}
Like rate: ${pct(s.likeRate, 2)} (channel typical: ${pct(s.channelLikeRate, 2)})
${idea.notes ? `My notes: ${idea.notes}` : ''}
${extra ? `\n${extra}\n` : ''}
${nicheLine(niche)}

Give me:
1. **Why it outperformed**: the specific title, thumbnail, topic and timing factors. Reference what you see in the thumbnail.${transcript?.length ? '\n2. **The hook**: how the first 30 seconds of the transcript keep viewers watching, and what happens at the most replayed moments.' : ''}
${transcript?.length ? '3' : '2'}. **The repeatable pattern**: a fill-in-the-blank formula for the title and the concept.
${transcript?.length ? '4' : '3'}. **5 title ideas** adapting this pattern to my channel.
${transcript?.length ? '5' : '4'}. **1 thumbnail concept** for the best of those titles.
Keep it under ${transcript?.length ? 550 : 400} words.`,
  };
}

export function ideasPrompt(ideas, niche) {
  const rows = ideas
    .slice(0, 40)
    .map((i) => {
      const s = i.stats ?? {};
      const extra = [i.tags?.length ? `tags: ${i.tags.join(', ')}` : '', i.notes ? `notes: ${i.notes}` : '']
        .filter(Boolean)
        .join('; ');
      return `- "${i.title}" by ${i.channelTitle} — ${x2(s.multiplier ?? i.multiplier)} median, ${n(i.views)} views, ${i.format === 'short' ? 'Short' : 'long-form'}${extra ? ` (${extra})` : ''}`;
    })
    .join('\n');
  return {
    system: SYSTEM,
    prompt: `Here are outlier videos I saved as inspiration:

${rows}

${nicheLine(niche)}

1. **Patterns**: name the 3–5 strongest patterns across these outliers (topics, title structures, emotional hooks, formats), citing which videos show each one.
2. **10 video ideas** for my channel built on those patterns. For each: a ready-to-use title, a one-line hook for the first 15 seconds, the format (Short or long-form), and which outlier(s) it's based on.
3. **Best bet**: which single idea to make first, and why.`,
  };
}

// Fetches a video's thumbnail as base64 for multimodal models.
export async function thumbnailImage(videoId) {
  try {
    const res = await fetch(`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`);
    if (!res.ok) return null;
    const blob = await res.blob();
    const data = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1]);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
    return { mime: blob.type || 'image/jpeg', data };
  } catch {
    return null;
  }
}

// Suggests where to dig next in a keyword rabbit hole.
export function anglesPrompt(path, outliers, niche) {
  const list = outliers
    .slice(0, 25)
    .map((v) => `- "${v.title}" (${x2(v.multiplier)} its channel's median, ${n(v.views)} views)`)
    .join('\n');
  return {
    system: SYSTEM,
    prompt: `I'm researching YouTube video ideas by drilling down through search keywords.
Keyword path so far: ${path.join(' → ')}

Outlier videos for "${path.at(-1)}":
${list || '(no strong outliers found)'}

${nicheLine(niche)}

Suggest 8 YouTube search keywords to explore next: more specific sub-niches, adjacent topics, or angles these outliers hint at that might be under-served.
Reply with exactly 8 lines, each a search phrase of 2–6 words. No numbering, quotes or commentary.`,
  };
}

export function parseLines(text, max = 8) {
  return text
    .split('\n')
    .map((l) => l.replace(/^[\s\-*\d.)"]+|["\s]+$/g, '').trim())
    .filter((l) => l && l.split(/\s+/).length <= 8)
    .slice(0, max);
}

// Content gaps: competitor outliers vs your own recent titles.
export function gapsPrompt(outliers, myTitles, niche) {
  const theirs = outliers
    .slice(0, 40)
    .map((v) => `- "${v.title}" (${v.channelTitle}, ${x2(v.multiplier)} its channel's median)`)
    .join('\n');
  const mine = myTitles.slice(0, 50).map((t) => `- ${t}`).join('\n');
  return {
    system: SYSTEM,
    prompt: `Recent outlier videos from channels I compete with:
${theirs}

My recent video titles:
${mine || '(not available)'}

${nicheLine(niche)}

Find my content gaps: topics, angles or formats that are clearly working for my competitors but that I haven't covered.
For each of 6 gaps give:
- **Gap**: the topic or angle in a few words
- **Evidence**: which competitor outliers show it works
- **Why it works**: the viewer desire behind it
- **2 titles** I could use, written for my channel
Finish with **Start here**: the single gap I should make first, and why.`,
  };
}

// Title lab: rank drafts and suggest stronger variants modelled on proven outliers.
export function titlesPrompt(drafts, proven, niche, { keyword = '', thumbnailText = '' } = {}) {
  const list = drafts.map((t, i) => `${i + 1}. ${t}`).join('\n');
  const examples = proven
    .slice(0, 30)
    .map((v) => `- "${v.title}" (${x2(v.multiplier)} its channel's median)`)
    .join('\n');
  return {
    system: SYSTEM,
    prompt: `I'm choosing a title for my next video.
${keyword ? `Target search keyword: ${keyword}\n` : ''}${thumbnailText ? `Text on the thumbnail: "${thumbnailText}" (the title should complement it, not repeat it)\n` : ''}
My draft titles:
${list}

Proven outlier titles in my space, for reference:
${examples || '(none saved yet)'}

${nicheLine(niche)}

1. **Ranking**: rank my drafts from strongest to weakest, with one line on why for each (curiosity, clarity, stakes, length on mobile).
2. **Better versions**: write 6 new titles that keep my video's promise but borrow what makes the proven outliers work. Keep each under 60 characters.
3. **Pick**: the one title you'd publish, and the thumbnail text that would pair with it.`,
  };
}

const mmss = (sec) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;

// Timestamped transcript, trimmed to roughly `maxWords` words.
export function timestampedTranscript(segments, maxWords = 9000) {
  const out = [];
  let count = 0;
  for (const s of segments) {
    count += s.text.split(/\s+/).length;
    if (count > maxWords) {
      out.push('[transcript trimmed]');
      break;
    }
    out.push(`[${mmss(s.start)}] ${s.text}`);
  }
  return out.join('\n');
}

/** Deep script analysis: hook, structure, attention tactics, keywords, payoff. */
export function scriptPrompt(idea, segments, analysis, niche) {
  const s = idea.stats ?? {};
  const peaks = analysis?.replayed?.map((r) => mmss(r.start)).join(', ');
  const drops = analysis?.dropOffs?.map((d) => mmss(d.start)).join(', ');
  return {
    system: `${SYSTEM} You are also an expert scriptwriter and story editor who studies how YouTube videos grab and hold attention.`,
    prompt: `Break down the script of this ${idea.format === 'short' ? 'YouTube Short' : 'YouTube video'}.

Title: ${idea.title}
Channel: ${idea.channelTitle}
Performance: ${n(idea.views)} views, ${x2(s.multiplier ?? idea.multiplier)} the channel's median
${peaks ? `Most replayed moments (YouTube heatmap): ${peaks}` : ''}
${drops ? `Biggest audience drop-offs (creator's retention data): ${drops}` : ''}

Transcript:
${timestampedTranscript(segments)}

${nicheLine(niche)}

Use timestamps and short quotes as evidence throughout.
1. **The hook (first 30 seconds)**: exactly how it grabs attention: the promise, the curiosity gap, stakes, pacing. What makes viewers stay past 30 seconds?
2. **Story structure**: the beats/acts with timestamps (setup, escalation, turns, climax, payoff). Name the structure if it follows a known one.
3. **Attention tactics**: open loops, re-hooks, pattern interrupts, questions, cliffhangers before slow parts. List each with timestamp and quote.
4. **Language & keywords**: recurring words and phrases, how they reinforce the title, help search, and set expectations; the tone and sentence rhythm.
5. **Promise and payoff**: what the title/thumbnail promise and where (and whether) the script delivers it.
${peaks || drops ? '6. **Why viewers replayed / left**: explain what is said at the most replayed moments and at any drop-offs.\n7' : '6'}. **Steal this structure**: a reusable beat sheet with rough timings as a % of runtime.`,
  };
}

/** Beat-sheet outline for my own video, modelled on an analyzed outlier script. */
export function outlinePrompt(idea, analysisText, segments, topic, niche) {
  return {
    system: `${SYSTEM} You are also an expert scriptwriter.`,
    prompt: `Write a script outline for my next video, modelled on the structure and attention tactics of this outlier.

Outlier: "${idea.title}" (${x2(idea.stats?.multiplier ?? idea.multiplier)} its channel's median)
${analysisText ? `Analysis of the outlier's script:\n${analysisText.slice(0, 6000)}` : `Its transcript:\n${timestampedTranscript(segments, 3000)}`}

My video's topic: ${topic}
${nicheLine(niche)}

Give me:
1. **3 title options** and the thumbnail text for the best one.
2. **The hook**: a word-for-word first 30 seconds.
3. **Beat sheet**: each beat with its purpose, rough timing (% of runtime) and the open loop or re-hook that carries viewers into the next beat.
4. **Lines to re-hook** at the points where viewers usually drift (around 25%, 50% and 75%).
5. **The payoff and ending** that keeps people watching the next video.`,
  };
}

/** Ideas from a video web: what YouTube connects, and where the openings are. */
export function webPrompt(web, insights, niche) {
  const t = (n) => `"${n.title}" (${n.channelTitle}, ${x2(n.multiplier)} its channel's median)`;
  const seed = web.nodes[web.seed];
  return {
    system: SYSTEM,
    prompt: `I mapped YouTube's "suggested next" links around this video: ${t(seed)}.
${insights.size} videos, ${insights.edges} suggestion links.

Hubs (videos YouTube suggests from many others in this web):
${insights.hubs.map((h) => `- ${t(h)}, suggested from ${h.inDegree} videos`).join('\n') || '- none'}

Strongest outliers in the web:
${insights.outliers.map((o) => `- ${t(o)}`).join('\n') || '- none'}

Topic clusters: ${insights.clusters.map((c) => `[${c.label.join(', ')}] ${c.ids.length} videos, ${c.outliers} outliers`).join('; ') || 'none'}
Words over-represented in outliers: ${insights.outlierWords.map((w) => w.word).join(', ') || 'none'}

${nicheLine(niche)}

1. **What YouTube thinks this audience wants**: read the hubs and clusters. What is the viewer journey?
2. **Where the openings are**: topics or angles the web suggests that small channels can win.
3. **6 video ideas** that would slot into this web (so YouTube suggests them next to these videos), each with a title and why it fits.
4. **Packaging notes**: what titles and thumbnails in this web have in common.`,
  };
}

/** Outline for one of my projects, using its linked outliers as models. */
export function projectOutlinePrompt(project, inspiration, niche) {
  const models = inspiration
    .slice(0, 5)
    .map((i) => `- "${i.title}" (${i.channelTitle}, ${x2(i.stats?.multiplier ?? i.multiplier)} its channel's median)${i.scriptAi ? `\n  Script notes: ${i.scriptAi.slice(0, 1200)}` : ''}`)
    .join('\n');
  return {
    system: `${SYSTEM} You are also an expert scriptwriter.`,
    prompt: `I'm planning a video.
Working title: ${project.title}
${project.angle ? `My angle: ${project.angle}\n` : ''}${project.notes ? `My notes: ${project.notes}\n` : ''}${(project.titles ?? []).length ? `Title ideas so far: ${project.titles.join(' | ')}\n` : ''}
Outlier videos I'm modelling it on:
${models || '(none linked)'}

${nicheLine(niche)}

Write the plan:
1. **3 title options** (under 60 characters) and thumbnail text for the best one.
2. **The hook**: a word-for-word first 30 seconds.
3. **Beat sheet**: each beat with its purpose, rough timing (% of runtime) and the open loop or re-hook that carries viewers into the next beat.
4. **The payoff and ending**.`,
  };
}

/** Outlier remix: combine the formats of 2–4 outliers into new concepts. */
export function remixPrompt(ideas, niche) {
  const list = ideas
    .map((i, k) => `${String.fromCharCode(65 + k)}. "${i.title}" (${i.channelTitle}, ${x2(i.stats?.multiplier ?? i.multiplier)} its channel's median)${i.notes ? `. My notes: ${i.notes}` : ''}`)
    .join('\n');
  return {
    system: SYSTEM,
    prompt: `Remix these outlier videos into new video concepts. They may come from different niches; that's the point.

${list}

${nicheLine(niche)}

For each outlier, first name in one line what makes it work (format, hook, emotional driver, topic).
Then write **5 remix concepts** that combine elements from at least two of them, adapted to my channel. For each:
- **Title** (under 60 characters) and thumbnail text
- **Borrowed from**: which element comes from which video (by letter)
- **Hook**: the first 15 seconds
- **Why it should work**
Finish with **Best bet**: the concept to make first.`,
  };
}

/** Audience research: what commenters ask for, struggle with and love. */
export function audiencePrompt(video, analysis, comments, niche) {
  const line = (c) => `- (${c.likes} likes) ${c.text.replace(/\s+/g, ' ').slice(0, 280)}`;
  const top = [...comments].sort((a, b) => b.likes - a.likes).slice(0, 60).map(line).join('\n');
  return {
    system: SYSTEM,
    prompt: `These are the most relevant comments on "${video.title}" (${video.channelTitle}, ${n(video.views)} views).

${top}

Detected so far: ${analysis.questions.length} questions, ${analysis.requests.length} video requests, ${analysis.pains.length} pain points, ${analysis.moments.length} moments mentioned by timestamp.

${nicheLine(niche)}

1. **What viewers want next**: the requests and unanswered questions, grouped, with how strongly they're voiced (likes).
2. **Pain points**: what frustrated or confused viewers, and what that says about an underserved need.
3. **What they loved**: moments and elements praised (use timestamps if mentioned).
4. **6 video ideas** that answer this audience directly, each with a title and the comments it answers.`,
  };
}

/** Hook rewriter: 5 new openings, modelled on proven hooks from the library. */
export function hookPrompt(project, currentHook, libraryHooks, niche) {
  const examples = libraryHooks
    .slice(0, 6)
    .map((x) => `- From "${x.title}" (${x2(x.multiplier)} its channel's median): "${x.text.slice(0, 500)}"`)
    .join('\n');
  return {
    system: `${SYSTEM} You are also an expert scriptwriter who specialises in video openings.`,
    prompt: `Rewrite the opening (first ~30 seconds) of my video.
Working title: ${project.title}
${project.angle ? `Angle: ${project.angle}\n` : ''}
My current opening:
"${currentHook || '(not written yet)'}"

Openings of outlier videos I've saved, as models:
${examples || '(none saved yet)'}

${nicheLine(niche)}

Write **5 new openings**, each 50–90 words, ready to read aloud. Use a different technique for each and label it (for example: curiosity gap, stakes up front, contrarian claim, cold-open story moment, result first). For each, add one line on which model it borrows from and why it should hold viewers past 30 seconds.`,
  };
}

/** Re-hook planner: lines that pull viewers back in at the weak checkpoints. */
export function rehookPrompt(project, script, checkpoints, niche) {
  const cps = checkpoints
    .map((c) => `- ${Math.round(c.at * 100)}% (~${Math.floor(c.start / 60)}:${String(Math.round(c.start % 60)).padStart(2, '0')}): "${c.line.slice(0, 200)}" ${c.covered ? '(already has a hook nearby)' : '(no hook nearby)'}`)
    .join('\n');
  return {
    system: `${SYSTEM} You are also an expert scriptwriter.`,
    prompt: `My video "${project.title}" loses viewers at the usual points. Here is the script:

${script.slice(0, 24000)}

Checkpoints (the line spoken at each point):
${cps}

${nicheLine(niche)}

For each checkpoint, write **2 re-hook lines** (an open loop, a twist, a question or raised stakes) that fit naturally right before that line, in my script's voice. Quote the sentence they go before. Then list any other spot in the script where the energy drops and suggest one fix.`,
  };
}

/** Shot list for filming, from the outline and script. */
export function shotListPrompt(project) {
  return {
    system: `${SYSTEM} You are also an experienced video producer and editor.`,
    prompt: `Turn this video plan into a shot list for a solo creator.
Title: ${project.title}
${project.angle ? `Angle: ${project.angle}\n` : ''}
Outline:
${(project.outline || '(none)').slice(0, 8000)}

Script:
${(project.script || '(none yet)').slice(0, 16000)}

Return a Markdown table with columns: # | Beat | Shot type (A-roll talking, B-roll, screen recording, insert/close-up, drone…) | What to film | On-screen text | Location / props.
Group shots by beat in order. After the table add:
- **Filming checklist** (gear, locations, permissions, batteries…)
- **B-roll to grab anywhere** (generic shots that cover cuts)
- **Retention notes for the edit**: where to add pattern interrupts, captions or music changes.`,
  };
}

/** Thumbnail critique: my thumbnail (first image) vs outlier thumbnails. */
export function thumbnailPrompt(project, title, outliers, niche) {
  const list = outliers.map((o, i) => `Image ${i + 2}: "${o.title}" (${x2(o.multiplier)} its channel's median)`).join('\n');
  return {
    system: `${SYSTEM} You are also an expert YouTube thumbnail designer.`,
    prompt: `Image 1 is MY thumbnail for a video titled "${title}".
${list ? `The other images are thumbnails of outlier videos in my space:\n${list}\n` : ''}
${nicheLine(niche)}

Critique my thumbnail as it would appear in a phone feed (small and fast-scrolling):
1. **First impression in 1 second**: what the eye sees first; is the idea instantly clear?
2. **Readability at small size**: text (ideally 0–4 words), contrast, clutter, faces and emotion.
3. **Curiosity and promise**: does it create a question the title answers, without repeating the title?
4. **Compared with the outliers**: what they do that mine doesn't (composition, color, text, emotion).
5. **3 specific fixes** I can make in my editor, and **3 alternative thumbnail concepts** (describe the composition and text).
Score it 1–10 for click appeal and say what would make it a 9.`,
  };
}

/**
 * An unsparing review of your own channel, built only on your analytics
 * (`data` is the sheet from channel-review.js).
 */
export function channelReviewPrompt(data, niche) {
  const system = `You are a blunt, senior YouTube strategist reviewing a creator's own channel from their real YouTube Analytics. The creator explicitly asked you not to hold back: name every real problem plainly, worst first, the way a paid consultant who wants them to grow would. No flattery, no softening, no filler encouragement, no generic advice ("be consistent", "make great content").

Rules:
- Use ONLY the data provided. Every problem must cite the specific numbers that show it, and say WHERE it is: the video title, the timestamp in the video, or the metric and period.
- Every problem needs a concrete fix: what to change, in which video or upload, and how the creator will see in these same numbers whether it worked.
- When a transcript line is given for a drop, use it: say what in that line likely made viewers leave and rewrite it.
- Compare videos with each other and with the channel's own medians; compare with the followed channels only where it is like-for-like.
- If something can't be judged from this data (for example click-through rate when it isn't provided), say so in one line instead of guessing.
- General YouTube knowledge can explain a fix, but label it as a rule of thumb; never present outside benchmarks or thresholds as facts about this channel.
- Praise only what the numbers prove, briefly.
Write in Markdown with short headings, bullet points and tables where they help.`;
  const prompt = `${nicheLine(niche)}

Here is my channel's data:

${data}

Review my channel. Structure:

## Verdict
Three sentences at most: where the channel really stands and the single biggest thing holding it back.

## Problems, worst first
For each problem (as many as the data shows, usually 4-8):
### <short name of the problem>
- **What:** the problem in one sentence.
- **Where:** the exact video(s), timestamp(s) or metric.
- **Evidence:** the numbers that prove it.
- **Fix:** specific steps (rewrite the line, restructure the intro, change the format, length or upload pattern…).
- **Check:** which number should move, and by roughly how much, if the fix works.

## What is working
Only what the numbers prove, with the numbers. Keep it short.

## Next 3 uploads
Three concrete experiments built from the problems above, each with the metric to watch.

## What this data can't tell
One or two lines on the blind spots.`;
  return { system, prompt };
}

/**
 * Shorts cut from a long video. `candidates` come from shorts.js; `mine`
 * says whether the video is the creator's own (cut it) or someone else's
 * (make your own Short on the same moment, don't reupload).
 */
export function shortsPrompt(video, segments, candidates, niche, { mine = false } = {}) {
  const mmss = (sec) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;
  const list = candidates.length
    ? candidates
        .map((c, i) => `${i + 1}. ${mmss(c.start)}–${mmss(c.end)} (${Math.round(c.end - c.start)} s; why: ${c.reasons.join(', ')}${c.heat != null ? `; average replay intensity ${Math.round(c.heat * 100)}%` : ''}): "${c.text.slice(0, 600)}"`)
        .join('\n')
    : '(none found automatically; pick from the transcript)';
  const system = `${SYSTEM} You specialize in turning long videos into YouTube Shorts that work on their own: a hook in the first second, one idea, a payoff before the end, and an ending that makes the loop feel natural.`;
  const prompt = `${nicheLine(niche)}

${mine ? 'This is MY video. Suggest Shorts I can cut from it.' : "This video is by another creator. Don't suggest reuploading their footage: suggest Shorts I can make myself on the same moments (my own take, recreation or reaction), and say what to borrow (the idea, structure or line) and what to change."}

Video: "${video.title}"${video.channelTitle ? ` by ${video.channelTitle}` : ''}${video.views != null ? ` (${n(video.views)} views${video.multiplier != null ? `, ${x2(video.multiplier)} its channel median` : ''})` : ''}

Moments found from the "Most replayed" heatmap and the script's twists, questions and stakes:
${list}

Transcript with timestamps:
${transcriptExcerpt(segments, 3500)}

Pick the 3–5 strongest Shorts (use the moments above or better ones from the transcript; replayed moments are proof viewers care). For each:

### Short N: <working title, under 50 characters>
- **Clip:** start–end timestamps and length (aim for 20–45 seconds)${mine ? '' : ' of the moment it is based on'}
- **Why it works alone:** the setup and the payoff inside the clip, in one or two sentences
- **First second:** the opening line or on-screen text that hooks before anyone swipes${mine ? ' (a line actually said, or a short text overlay if the clip needs context)' : ''}
- **Cut:** ${mine ? 'which lines to remove or tighten so it moves fast' : 'how to film or structure it'}
- **On-screen text:** 1–2 short captions
- **Ending / loop:** how it ends so the replay feels natural${mine ? '\n- **Points back to the long video:** how it can drive viewers to the full video (related-video link, pinned comment)' : ''}

Finish with one line on which Short to post first and why.`;
  return { system, prompt };
}

/**
 * Builds `count` audience avatars from an audience data sheet
 * (avatars.js audienceSheet). `keep` are avatars that stay (locked); the new
 * ones should complement them. `focus` narrows the group ("newcomers from
 * search", "a competitor's audience"…). Replies with a JSON array.
 */
export function avatarsPrompt(sheet, count, niche, { keep = [], focus = '' } = {}) {
  const system = `You are an audience researcher who builds realistic viewer personas from real channel data, the way a UX researcher writes personas from interviews and analytics. Personas are fictional composites: never a real person, never a real commenter's name or handle, never copied comment text.

Rules:
- Ground every persona in the data provided. When the data shows shares (age, gender, countries, devices, subscribers, how they find videos), the group's weights must roughly match them.
- Make them specific and human: a job or life stage, what's going on in their life, what they want from videos like these, what they already know, what they believe, what frustrates them, what moves them, what makes them click away.
- Make the group realistic, not flattering: include casual viewers, skeptics, people who often leave early, people who only half-watch on their phone, as the data suggests. Real audiences are mixed.
- Describe them with respect and without judgment: frustration, anger, boredom and disagreement are normal reactions, not flaws.
- Avoid stereotypes; vary names, backgrounds and voices.`;
  const fields = `[
  {
    "name": "first name and an initial, e.g. \\"Maya R.\\"",
    "age": 27,
    "gender": "woman / man / non-binary…",
    "location": "city or region, country",
    "occupation": "job or study",
    "lifeStage": "one line on their situation right now",
    "interests": ["3-6 interests"],
    "knowledge": "new | some | expert (about this channel's topic)",
    "wants": "what they want from videos like these",
    "beliefs": ["2-4 beliefs or assumptions they hold about the topic or themselves"],
    "frustrations": ["2-4 frustrations, in life or with videos like these"],
    "moves": "what grabs or moves them",
    "turnoffs": "what makes them click away or roll their eyes",
    "device": "phone | computer | tv | tablet",
    "discovery": "search | browse | suggested | subscriptions | shorts | external",
    "relationship": "subscriber | returning | new",
    "habits": "how and when they watch (skipping, background listening, comments…)",
    "commentStyle": "how they comment, if they do",
    "quote": "one sentence in their own voice about videos like these",
    "basedOn": "which data points this persona reflects",
    "weight": 0.15
  }
]`;
  const prompt = `${nicheLine(niche)}

Audience data:
${sheet || '(No analytics available: base the personas on the channel description and any comments above, and say so in basedOn.)'}
${focus ? `\nThis group should represent: ${focus}\n` : ''}${keep.length ? `\nThese personas are already in the group and stay; create ${count} NEW ones that complement them (different people, filling gaps):\n${keep.map((a) => `- ${a.name}, ${a.age ?? '?'}, ${a.occupation}: ${a.wants}`).join('\n')}\n` : ''}
Create ${count} viewer personas. Weights are each persona's share of the audience (all weights together ≈ 1${keep.length ? ', counting the kept personas' : ''}).

Reply with ONLY a JSON array, no other text, in exactly this shape:
${fields}`;
  return { system, prompt };
}

// ---------- Test screenings (Audience lab) ----------

const SCREENING_SYSTEM = `You play a test audience for a YouTube video: several specific viewers, each described in detail. Each one reacts as themselves, honestly and unfiltered, the way they really would on an ordinary day with a feed full of other options.

Rules:
- Stay in character. Use each viewer's interests, knowledge, beliefs, frustrations, habits and device.
- Be realistic, not polite: most people scroll past most videos, many leave in the first seconds, attention dips in the middle. Nobody is trying to please the creator.
- Boredom, skepticism, confusion, irritation or anger are valid reactions; report them plainly, without judging the viewer.
- Base reactions only on what each viewer would actually see or hear.`;

const anchorLine = (baseline) =>
  [
    baseline?.ctr != null && `On this channel, about ${baseline.ctr.toFixed(1)}% of people shown a video click it.`,
    baseline?.avgViewed != null && `Viewers watch about ${Math.round(baseline.avgViewed)}% of a video on average.`,
  ].filter(Boolean).join(' ');

/**
 * Stage 1 of a screening: each viewer sees the title in their feed, then the
 * clickers watch the hook. `neighbors`: other titles in the same feed.
 */
export function feedHookPrompt({ avatars, title, hook, neighbors = [], baseline = null, niche = '', images = null, calibration = '' }) {
  // images: { tested: true, neighbors: n } when thumbnails are attached, in that order.
  const tag = (i) => (images ? `[image ${i}] ` : '');
  const feed = [...neighbors.slice(0, 5).map((t, i) => `${images && i < images.neighbors ? tag(i + 2) : ''}"${t}"`), `${tag(1)}"${title}"   ← the video being tested`];
  const prompt = `${nicheLine(niche)}

The viewers:
${avatars.map((a) => `- ${a}`).join('\n')}

1. FEED. Each viewer is scrolling and sees these videos${images ? ' (the attached images are their thumbnails: image 1 is the tested video\'s, the others as tagged; videos without an image show only the title)' : ' (titles only, no thumbnails)'}:
${feed.map((t) => `   ${t}`).join('\n')}
Would they click the tested video? "yes", "maybe" or "no", their first thought on seeing the title, and why.
${anchorLine(baseline) ? `Reality check: ${anchorLine(baseline)} Keep the share of "yes" near what's realistic.` : ''}${calibration ? `\n${calibration}` : ''}

2. HOOK. ${hook ? `Only viewers who answered yes or maybe watch the opening (about the first 30 seconds). Realistically, a good share of people who click leave within these seconds when the opening doesn't quickly show them what they came for; decide per viewer:
"""
${hook}
"""
Do they keep watching past it ("stay": true) or leave ("stay": false, and "leaveAt": the second they leave, 0-30)? How does it make them feel, and why?` : 'There is no script yet: skip the hook (stay: null).'}

Reply with ONLY a JSON array, one object per viewer, using their [id]:
[{"id": "…", "click": "yes|maybe|no", "firstThought": "…", "clickWhy": "…", "stay": true, "leaveAt": null, "hookFeeling": "one or two words", "hookWhy": "…"}]
For viewers who don't click, use "stay": null and leave the hook fields empty.`;
  return { system: SCREENING_SYSTEM, prompt };
}

/**
 * Stage 2: the viewers still watching go through the video beat by beat.
 * `beats`: [{ i, start, text }].
 */
export function storyPrompt({ avatars, title, beats, baseline = null, niche = '', outline = false, calibration = '' }) {
  const mmss = (sec) => (sec == null ? '' : `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')} `);
  const prompt = `${nicheLine(niche)}

Video: "${title}"
These viewers clicked and stayed past the opening:
${avatars.map((a) => `- ${a}`).join('\n')}

The rest of the video, in beats${outline ? ' (from the outline: what will happen, not the final words)' : ''}:
${beats.map((b) => `[beat ${b.i}] ${mmss(b.start)}${b.text}`).join('\n\n')}

They are WATCHING, not reading: each beat takes about a minute of their evening, on their device, with other videos one tap away. They can't skim ahead.

Each viewer's line ends with how much of a video like this they typically watch. That is the most likely place for them to leave. Before writing their beats, decide honestly where THIS viewer would stop, given that typical amount and what each beat offers them. Leaving around their typical point is normal, not a failure. Only let someone watch much longer if the video gives them, specifically, a strong reason to. A group where everyone finishes is unrealistic.

For each viewer, go through the beats in order. For each beat: attention 0-10 (let it rise and fall with the content), their main emotion (one or two words), a short thought in their own voice, and whether they leave there ("leave": true; then stop that viewer's beats).
${anchorLine(baseline) ? `Reality check: ${anchorLine(baseline)}` : ''}${calibration ? `\n${calibration}` : ''}
Viewers who reach the end also answer: overall score 1-10, would they like it, the comment they'd write (in their voice, or null if they wouldn't comment), subscribe, share, watch another video from this channel, what they'd tell a friend about it, and what (if anything) changed in what they think or feel.

Reply with ONLY a JSON array, one object per viewer:
[{"id": "…", "beats": [{"i": 0, "attention": 7, "emotion": "curious", "thought": "…", "leave": false}], "end": {"score": 7, "like": true, "comment": "…", "subscribe": false, "share": false, "watchNext": true, "tellFriend": "…", "changed": "…"}}]
Use "end": null for viewers who leave.`;
  return { system: SCREENING_SYSTEM, prompt };
}

/**
 * Stage 3: what to change, from the screening's results. `report` is a text
 * summary of numbers and reactions; `principles` (optional) are story
 * principle names the fixes may refer to.
 */
export function screeningSummaryPrompt({ title, report, niche = '', principles = [] }) {
  const system = `You are a YouTube story editor reading the results of a test screening with simulated viewers. Turn their reactions into concrete changes. Be direct; don't soften problems, and don't judge the viewers: their reactions are data. Write in Markdown.`;
  const prompt = `${nicheLine(niche)}

Video: "${title}"
Test screening results:
${report}

Write:
## What works
2-4 points, each tied to the viewers or beats that show it.

## What to change, ranked
The most impactful changes first (by how many viewers and how much of the audience they affect). For each:
### <short name>
- **Where:** title, hook, or the beat (with its time) and the line it starts with
- **Who:** the viewers it affects, and their share of the audience
- **Why:** what they felt or thought there, quoting them
- **Fix:** exactly what to change (rewrite the line, cut, move, add a tease…)${principles.length ? `\n- **Principle:** the story principle behind the fix, from this list: ${principles.join(', ')}` : ''}

## Title
Keep it or change it, and up to 3 alternatives these viewers would click more, with who each one wins over.

Keep it concrete and short.`;
  return { system, prompt };
}

/**
 * Title A/B: each viewer judges every title (labeled A, B…) on its own, as
 * if it were the one in their feed, then picks a favorite. `titles` should
 * already be in a random order. One call for the whole group.
 */
export function titleTestPrompt({ avatars, titles, neighbors = [], baseline = null, niche = '', thumbnail = false }) {
  const prompt = `${nicheLine(niche)}

The viewers:
${avatars.map((a) => `- ${a}`).join('\n')}

We're choosing a title for one video. Each viewer is scrolling past videos like:
${neighbors.slice(0, 5).map((t) => `- "${t}"`).join('\n') || '- (other videos in their niche)'}
${thumbnail ? '\nThe video\'s thumbnail is attached; it is the same for every title.\n' : ''}
Judge each title SEPARATELY, as if it were the only version in their feed (don't compare while judging):
${titles.map((t, i) => `${'ABCD'[i]}. "${t}"`).join('\n')}

For every title: would this viewer click ("yes", "maybe", "no") and their honest first thought in their own voice. Then their favorite (the letter they'd most likely click, or "none").
${anchorLine(baseline) ? `Reality check: ${anchorLine(baseline)}` : ''}

Reply with ONLY a JSON array, one object per viewer, using their [id]:
[{"id": "…", "votes": [{"title": "A", "click": "yes|maybe|no", "thought": "…"}], "favorite": "A"}]`;
  return { system: SCREENING_SYSTEM, prompt };
}

/**
 * After publishing: what a test screening got right and wrong, from its
 * report, the forecast-vs-real numbers and real comments.
 */
export function accuracyNotesPrompt({ title, report, comparison, comments = [], niche = '' }) {
  const system = `You review how well a simulated test screening predicted a real YouTube video's results, to make the next screenings better. Be specific and plain. The simulated viewers are personas; say which ones behaved unlike the real audience and how to adjust them. Write in Markdown.`;
  const prompt = `${nicheLine(niche)}

Video: "${title}"

Forecast vs reality:
${comparison}

${comments.length ? `Real comments (most relevant first):\n${comments.slice(0, 30).map((c) => `- "${c.text.replace(/\s+/g, ' ').slice(0, 220)}"`).join('\n')}\n` : 'No real comments available.\n'}
The screening's results (before publishing):
${report}

Write:
## What the screening got right
## What it missed
Where the forecast and reality differ most, and the likely reason.
## Comments: predicted vs real
Did the themes the viewers predicted show up in the real comments? What did real viewers talk about that no persona did?
## Adjust these personas
Which personas reacted unlike the real audience, and what to change in them (patience, knowledge, wants, how they found the video…).
## For the next screening
2-3 short lessons about this audience.`;
  return { system, prompt };
}

// ---------- Ask your audience (Audience lab) ----------

/** Pitch test: each viewer reacts to up to 4 one-line ideas. Replies with one JSON object. */
export function pitchPrompt({ avatars, pitches, context = '', niche = '' }) {
  const prompt = `${nicheLine(niche)}

The viewers:
${avatars.map((a) => `- ${a}`).join('\n')}
${context ? `\nWhat the creator has so far: ${context}\n` : ''}
The creator is deciding what video to make next and pitches these ideas (nothing is filmed yet):
${pitches.map((p, i) => `${i + 1}. ${p}`).join('\n')}

For EACH viewer and EACH idea: would they watch a video about it ("yes", "maybe", "no"), why (in their own voice), what they'd expect it to deliver (the promise they hear), and what they'd want instead or in addition (or "" if nothing).
Be realistic: most ideas don't interest most people, and a viewer can like the topic but not this angle.

Then write "takeaways": 3-5 short Markdown bullet points for the creator: which idea has the strongest pull and for whom, the expectations they must meet, and what the group kept asking for.

Reply with ONLY a JSON object:
{"viewers": [{"id": "…", "pitches": [{"pitch": 1, "interest": "yes|maybe|no", "why": "…", "expect": "…", "instead": "…"}]}], "takeaways": "- …"}`;
  return { system: SCREENING_SYSTEM, prompt };
}

/**
 * A follow-up question to the group (or one viewer). Viewers answer in
 * character; those with nothing to say stay quiet. Replies with a JSON array.
 */
export function audienceChatPrompt({ avatars, question, history = '', context = '', single = false, niche = '' }) {
  const prompt = `${nicheLine(niche)}

${single ? 'You are this viewer' : 'The viewers in this conversation'}:
${avatars.map((a) => `- ${a}`).join('\n')}
${context ? `\nContext from the creator: ${context}\n` : ''}${history ? `\nThe conversation so far:\n${history}\n` : ''}
The creator now asks: "${question}"

${single
    ? 'Answer as this viewer: honestly, in their own voice and words, 1-4 sentences. You can disagree, be unsure, or ask something back.'
    : 'Each viewer who would actually have something to say answers in their own voice (1-3 sentences). Viewers who wouldn\'t care stay quiet: leave them out. Disagreement between viewers is fine and useful.'}

Reply with ONLY a JSON array:
[{"id": "…", "reply": "…"}]`;
  return { system: SCREENING_SYSTEM, prompt };
}

/**
 * Updating an audience group from real data: current analytics and comments,
 * and what checked screenings (forecast vs reality) taught. Proposes edits,
 * new avatars, retirements and new shares; the creator reviews them.
 * Replies with one JSON object.
 */
export function evolvePrompt({ avatars, sheet = '', lessons = '', calibration = '', video = '', niche = '' }) {
  const system = `You are an audience researcher keeping a set of viewer personas true to a real YouTube audience. Personas are fictional composites: never a real person, never a real commenter's name or handle, never copied comment text.

Rules:
- Change a persona only where real data shows it is wrong: how patient they are, what they know, what they want, how they find videos, how they watch. Name the evidence in each reason.
- Keep what the data doesn't contradict. Small, specific edits beat rewrites. No change at all is a fine answer.
- Add a persona only for a kind of real viewer the group is missing (from comments, demographics or traffic), and retire one only if nothing in the data looks like them.
- Shares (weights) should follow the real demographics, devices, subscribers and traffic.
- Describe people with respect and without judgment: frustration, boredom and disagreement are normal reactions.`;
  const prompt = `${nicheLine(niche)}

The personas now (id in brackets, share of viewers at the end):
${avatars.map((a) => `- ${a.brief} Share: ${Math.round(a.weight * 100)}%.${a.locked ? ' (The creator locked this one: change it only for strong evidence.)' : ''}`).join('\n')}

${sheet ? `The real audience now:\n${sheet}\n` : 'No current analytics (not signed in).\n'}
${calibration ? `How past test screenings with these personas compared with real results:\n${calibration}\n` : ''}${lessons ? `\nLessons from published videos (forecast vs reality reviews):\n${lessons}\n` : ''}${video ? `\nThis update is about one published video:\n${video}\n` : ''}
Propose how to update the personas so the next test screenings behave more like the real audience.

Fields you may change in "changes": age, gender, location, occupation, lifeStage, interests (array), knowledge (new|some|expert), wants, beliefs (array), frustrations (array), moves, turnoffs, device (phone|computer|tv|tablet), discovery (search|browse|suggested|subscriptions|shorts|external), relationship (subscriber|returning|new), habits, commentStyle, quote, basedOn.

Reply with ONLY a JSON object, no other text:
{
  "summary": "2-3 sentences: what the real data says about this audience that the personas got wrong",
  "edits": [{"id": "…", "changes": {"habits": "…"}, "reason": "the evidence"}],
  "add": [{"avatar": {"name": "…", "age": 30, "occupation": "…", "wants": "…", "…": "same fields as above"}, "reason": "…"}],
  "retire": [{"id": "…", "reason": "…"}],
  "weights": {"<id>": 0.2}
}`;
  return { system, prompt };
}
