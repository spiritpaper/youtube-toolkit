import { mountShell } from '../lib/nav.js';
import { send, h, fmtNum, fmtMult, tier, videoUrl, ageText } from '../lib/ui.js';
import { analyzeComments } from '../lib/comments.js';
import { formatTime } from '../lib/stats.js';
import { activeAi, generate, audiencePrompt, PROVIDERS } from '../lib/ai.js';
import { markdownToHtml } from '../lib/markdown.js';

mountShell('script');
const $ = (id) => document.getElementById(id);
const main = $('main');
const idFrom = (s) => (/(?:v=|youtu\.be\/|shorts\/)([\w-]{11})/.exec(s) ?? /^([\w-]{11})$/.exec(s.trim()))?.[1];

function mdBlock(text) {
  const div = h('div', { class: 'md' });
  div.innerHTML = markdownToHtml(text); // escapes everything first
  return div;
}
const cm = (c, videoId) => {
  // Make mentioned timestamps clickable.
  const parts = c.text.split(/(\b\d{1,2}:\d{2}(?::\d{2})?\b)/);
  return h('div', { class: 'cm' },
    h('div', {}, parts.map((p, i) => (i % 2 ? h('a', { class: 'ts', href: `https://www.youtube.com/watch?v=${videoId}&t=${p.split(':').reduce((a, x) => a * 60 + Number(x), 0)}s`, target: '_blank' }, p) : p))),
    h('div', { class: 'l' }, `👍 ${fmtNum(c.likes)}${c.replies ? ` · ${c.replies} replies` : ''}`));
};
const listCard = (title, hint, items, videoId) =>
  h('section', { class: 'card' }, h('h2', {}, `${title} (${items.length})`), h('p', { class: 'muted small' }, hint),
    items.length ? h('div', { class: 'list' }, items.slice(0, 30).map((c) => cm(c, videoId))) : h('p', { class: 'muted small' }, 'None found.'));

async function show(videoId) {
  history.replaceState(null, '', `?v=${videoId}`);
  main.replaceChildren(h('div', { class: 'empty-state' }, 'Reading comments…'));
  let video;
  let data;
  try {
    [video, data] = await Promise.all([send({ type: 'videoInfo', id: videoId }), send({ type: 'comments', id: videoId })]);
  } catch (err) {
    main.replaceChildren(h('div', { class: 'empty-state error' }, err.reason === 'noKey' ? 'Add your YouTube API key in the extension popup first.' : err.message));
    return;
  }
  const a = analyzeComments(data.comments);
  const aiBox = h('div', {}, data.ai ? mdBlock(data.ai.text) : null);
  const aiBtn = h('button', { class: 'primary' }, data.ai ? 'Re-run AI' : 'Turn into video ideas (AI)');
  aiBtn.addEventListener('click', async () => {
    const ai = await activeAi();
    if (!ai) return aiBox.replaceChildren(h('p', { class: 'muted small' }, 'AI is optional. Connect a provider in ', h('a', { href: '../options/options.html' }, 'Settings'), '.'));
    aiBtn.disabled = true;
    aiBtn.textContent = 'Thinking…';
    try {
      const { system, prompt } = audiencePrompt(video, a, data.comments, ai.niche);
      const text = await generate({ ...ai, system, prompt });
      await send({ type: 'saveAiRun', run: { title: `Audience: ${video.title.slice(0, 50)}`, text, provider: ai.provider, model: ai.model } });
      aiBox.replaceChildren(
        h('p', { class: 'muted small' }, `${PROVIDERS[ai.provider].label} · ${ai.model}`),
        mdBlock(text),
        h('button', {
          onclick: async () => {
            const p = await send({ type: 'projectCreate', data: { title: `Answering: ${video.title.slice(0, 60)}`, outline: text, inspiration: [videoId], source: { type: 'audience', id: videoId } } });
            location.href = `../project/project.html?id=${p.id}`;
          },
        }, 'Save as a project'),
      );
    } catch (err) {
      aiBox.replaceChildren(h('p', { class: 'error' }, err.message));
    } finally {
      aiBtn.disabled = false;
      aiBtn.textContent = 'Re-run AI';
    }
  });

  main.replaceChildren(
    h('div', { class: 'vhead' },
      h('img', { src: video.thumb, alt: '' }),
      h('div', { class: 'grow' },
        h('a', { href: videoUrl(video), target: '_blank' }, video.title),
        h('div', { class: 'muted small' }, `${video.channelTitle} · ${fmtNum(video.views)} views · ${fmtNum(video.comments)} comments · ${ageText(video.publishedAt)}`)),
      h('button', { title: 'Fetch the latest comments (1 API unit)', onclick: async () => { await send({ type: 'comments', id: videoId, fresh: true }); show(videoId); } }, 'Refresh')),
    h('div', { class: 'kpis' },
      [['Comments read', a.total], ['Questions', a.questions.length], ['Video requests', a.requests.length], ['Pain points', a.pains.length], ['Moments mentioned', a.moments.length]].map(([k, v]) => h('div', { class: 'kpi' }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v)))),
    h('p', { class: 'muted small' }, `Top ${a.total} comments by relevance, saved ${ageText(data.fetchedAt)}. Saved comments are reused, so opening this again costs nothing.`),
    h('section', { class: 'card' }, h('div', { class: 'row' }, h('h2', { class: 'grow' }, 'AI: what this audience wants'), aiBtn), aiBox),
    h('div', { class: 'cols' },
      listCard('Video requests', '"Make a video about…", "part 2", "can you try…": ready-made ideas.', a.requests, videoId),
      listCard('Questions', 'Unanswered questions are gaps you can fill.', a.questions, videoId)),
    h('div', { class: 'cols' },
      listCard('Pain points', 'Frustrations and confusion: what the video (or the niche) doesn\'t solve.', a.pains, videoId),
      h('section', { class: 'card' }, h('h2', {}, `Moments people mention (${a.moments.length})`), h('p', { class: 'muted small' }, 'Timestamps viewers quote are the moments that landed.'),
        a.moments.length ? h('div', { class: 'list' }, a.moments.slice(0, 12).map((m) => h('div', { class: 'cm' }, h('a', { class: 'ts', href: `https://www.youtube.com/watch?v=${videoId}&t=${m.start}s`, target: '_blank' }, formatTime(m.start)), ` · ${m.mentions} mention${m.mentions > 1 ? 's' : ''} · 👍 ${fmtNum(m.likes)}`, h('div', { class: 'l' }, m.examples[0].text.slice(0, 160))))) : h('p', { class: 'muted small' }, 'No timestamps mentioned.'))),
    h('section', { class: 'card' }, h('h2', {}, 'Words viewers use'), h('div', { class: 'words' }, a.topWords.map((w) => h('span', { class: 'word' }, `${w.word} ×${w.count}`)))),
  );
}

$('go').addEventListener('submit', (e) => {
  e.preventDefault();
  const id = idFrom($('v').value);
  if (id) show(id);
  else alert('Paste a YouTube video link.');
});
const start = new URLSearchParams(location.search).get('v');
if (start) show(start);
else main.replaceChildren(h('div', { class: 'empty-state' }, h('h2', {}, 'Find out what an audience wants'), h('p', {}, 'Paste a video link above, or click "Comments" in the YT Toolkit panel on any YouTube video. Reading the top 100 comments costs 1 API unit and is saved for next time.')));
