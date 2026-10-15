// Project sections for making and shipping the video: shot list, thumbnail
// (mock-up + AI critique) and after-publishing performance.

import { send, h, fmtNum, fmtMult, fmtPct, tier, videoUrl, download } from '../lib/ui.js';
import { formatTime } from '../lib/stats.js';
import { lineChart } from '../lib/linechart.js';
import { activeAi, generate, shotListPrompt, thumbnailPrompt, thumbnailImage, PROVIDERS } from '../lib/ai.js';
import { markdownToHtml } from '../lib/markdown.js';
import { mdEditor } from '../lib/md-view.js';

const mdBlock = (text) => {
  const div = h('div', { class: 'md' });
  div.innerHTML = markdownToHtml(text); // escapes everything first
  return div;
};
const aiMissing = () => h('p', { class: 'muted small' }, 'AI is optional. Connect a provider in ', h('a', { href: '../options/options.html' }, 'Settings'), '.');
const mult = (i) => i?.stats?.multiplier ?? i?.multiplier;

// ---------- Shot list ----------

/** A non-AI starter: one A-roll line per paragraph, with a B-roll slot. */
export function starterShotList(script) {
  let paras = script.split(/\n\s*\n|\n/).map((p) => p.trim()).filter((p) => p.split(/\s+/).length >= 4);
  // One long block of text: use groups of three sentences instead.
  if (paras.length < 3) {
    const sentences = script.split(/(?<=[.!?…])\s+/).map((s) => s.trim()).filter(Boolean);
    paras = [];
    for (let i = 0; i < sentences.length; i += 3) paras.push(sentences.slice(i, i + 3).join(' '));
  }
  return paras
    .map((p, i) => `${i + 1}. A-roll: "${p.slice(0, 90)}${p.length > 90 ? '…' : ''}"\n   B-roll: \n   On-screen text: `)
    .join('\n');
}

export function shotListSection(project, { save }) {
  let timer;
  const status = h('span', { class: 'saving' });
  const ta = h('textarea', {
    class: 'big',
    placeholder: 'Shots to film, in order: A-roll, B-roll, screen recordings, on-screen text…',
    value: project.shotList ?? '',
    oninput: () => {
      clearTimeout(timer);
      status.textContent = 'Saving…';
      timer = setTimeout(async () => {
        await save({ shotList: ta.value });
        status.textContent = `Saved ${new Date().toLocaleTimeString()}`;
      }, 600);
    },
  });
  const editor = mdEditor(ta, 'shotList');
  const out = h('div', {});
  const set = (text) => {
    ta.value = ta.value ? `${ta.value}\n\n${text}` : text;
    ta.dispatchEvent(new Event('input'));
    editor.preview();
  };
  const aiBtn = h('button', { class: 'primary' }, 'Generate with AI');
  aiBtn.addEventListener('click', async () => {
    const ai = await activeAi();
    if (!ai) return out.replaceChildren(aiMissing());
    if (!project.outline && !project.script) return out.replaceChildren(h('p', { class: 'muted small' }, 'Write an outline or script first.'));
    aiBtn.disabled = true;
    aiBtn.textContent = 'Thinking…';
    out.replaceChildren(h('div', { class: 'loading inline' }, `Writing the shot list with ${PROVIDERS[ai.provider].label} (${ai.model})…`));
    try {
      const { system, prompt } = shotListPrompt(project);
      set(await generate({ ...ai, system, prompt }));
      out.replaceChildren(h('p', { class: 'muted small' }, `Added by ${PROVIDERS[ai.provider].label} (${ai.model}).`));
    } catch (err) {
      out.replaceChildren(h('p', { class: 'error' }, err.message));
    } finally {
      aiBtn.disabled = false;
      aiBtn.textContent = 'Generate with AI';
    }
  });
  const printIt = () => {
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.title = `Shot list · ${project.title}`;
    const style = w.document.createElement('style');
    style.textContent = 'body { font: 13px/1.5 system-ui, sans-serif; padding: 24px; } table { border-collapse: collapse; width: 100%; } th, td { border: 1px solid #bbb; padding: 4px 6px; text-align: left; vertical-align: top; } pre { white-space: pre-wrap; }';
    const body = w.document.createElement('div');
    body.innerHTML = markdownToHtml(`# ${project.title}\n\n${ta.value}`); // escapes everything first
    w.document.head.append(style);
    w.document.body.append(body);
    w.print();
  };
  return h('section', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', {}, 'Shot list'), status, editor.tabs,
      h('button', { onclick: () => (project.script ? set(starterShotList(project.script)) : out.replaceChildren(h('p', { class: 'muted small' }, 'Write a script first.'))) }, 'Starter from script'),
      aiBtn,
      h('button', { onclick: () => download(`shot-list-${project.title.slice(0, 40)}.md`, `# ${project.title}\n\n${ta.value}`, 'text/markdown;charset=utf-8') }, 'Download'),
      h('button', { onclick: printIt }, 'Print')),
    out, editor.view);
}

// ---------- Thumbnail ----------

async function downscale(file, maxW = 1280) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const scale = Math.min(1, maxW / img.width);
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function thumbnailSection(project, { ideas }) {
  const key = `th:${project.id}`;
  const box = h('div', {});
  const aiBox = h('div', {}, project.ai?.thumbnail ? mdBlock(project.ai.thumbnail.text) : null);
  const title = project.titles?.[0] || project.title;
  const outliers = (project.inspiration ?? []).map((id) => ideas[id]).filter(Boolean).slice(0, 5);
  let dark = true;

  const feedCard = (src, t, meta, mine) =>
    h('div', { class: `feed-card${mine ? ' mine' : ''}` }, h('img', { src, alt: '' }), h('div', { class: 'ft' }, t), h('div', { class: 'fm' }, meta));

  async function draw() {
    const { [key]: mine } = await chrome.storage.local.get(key);
    const published = project.performance?.video?.thumb;
    const src = mine ?? published;
    const file = h('input', { type: 'file', accept: 'image/*' });
    file.addEventListener('change', async () => {
      if (!file.files[0]) return;
      try {
        await chrome.storage.local.set({ [key]: await downscale(file.files[0]) });
        draw();
      } catch {
        box.prepend(h('p', { class: 'error small' }, "Couldn't read that image. Try a JPG or PNG."));
      }
    });
    box.replaceChildren(
      h('div', { class: 'row' },
        h('label', { class: 'button-link' }, 'Upload thumbnail', file),
        src && h('label', { class: 'small' }, h('input', { type: 'checkbox', checked: dark, onchange: (e) => { dark = e.target.checked; draw(); } }), ' Dark feed'),
        mine && h('button', { class: 'small', onclick: async () => { await chrome.storage.local.remove(key); draw(); } }, 'Remove'),
        !mine && published && h('span', { class: 'muted small' }, 'Showing your published thumbnail.')),
      src
        ? h('div', {},
            h('h3', {}, 'In the home feed, next to your outliers'),
            h('div', { class: `feed${dark ? ' dark' : ''}` },
              feedCard(src, title, 'Your channel · just now', true),
              outliers.map((o) => feedCard(o.thumb, o.title, `${o.channelTitle} · ${fmtNum(o.views)} views`))),
            h('h3', {}, 'At phone size'),
            h('div', { class: `feed small-feed${dark ? ' dark' : ''}` },
              feedCard(src, title, '', true),
              outliers.slice(0, 3).map((o) => feedCard(o.thumb, o.title, ''))))
        : h('p', { class: 'muted small' }, 'Upload your thumbnail to see it in a mock feed next to the outliers you linked, at full and phone size.'),
    );
    return src;
  }

  const aiBtn = h('button', { class: 'primary' }, 'Critique with AI');
  aiBtn.addEventListener('click', async () => {
    const ai = await activeAi();
    if (!ai) return aiBox.replaceChildren(aiMissing());
    const { [key]: mine } = await chrome.storage.local.get(key);
    let me = mine ? { mime: 'image/jpeg', data: mine.split(',')[1] } : null;
    if (!me && project.performance?.videoId) me = await thumbnailImage(project.performance.videoId);
    if (!me) return aiBox.replaceChildren(h('p', { class: 'muted small' }, 'Upload a thumbnail first.'));
    aiBtn.disabled = true;
    aiBtn.textContent = 'Looking…';
    aiBox.replaceChildren(h('div', { class: 'loading inline' }, `${PROVIDERS[ai.provider].label} is comparing your thumbnail with ${Math.min(outliers.length, 3)} outlier thumbnails. Image critiques usually take 1–2 minutes.`));
    try {
      const others = (await Promise.all(outliers.slice(0, 3).map(async (o) => ({ o, img: await thumbnailImage(o.id) })))).filter((x) => x.img);
      const { system, prompt } = thumbnailPrompt(project, title, others.map(({ o }) => ({ title: o.title, multiplier: mult(o) })), ai.niche);
      const text = await generate({ ...ai, system, prompt, images: [me, ...others.map((x) => x.img)] });
      aiBox.replaceChildren(h('p', { class: 'muted small' }, `${PROVIDERS[ai.provider].label} · ${ai.model}`), mdBlock(text));
      await send({ type: 'projectUpdate', id: project.id, patch: { ai: { ...(project.ai ?? {}), thumbnail: { text, model: ai.model, at: Date.now() } } } });
    } catch (err) {
      aiBox.replaceChildren(h('p', { class: 'error' }, err.message));
    } finally {
      aiBtn.disabled = false;
      aiBtn.textContent = 'Critique with AI';
    }
  });
  draw();
  return h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', {}, 'Thumbnail'), h('span', { class: 'muted small' }, `Title shown: "${title}"`), aiBtn), box, aiBox);
}

// ---------- After publishing ----------

export function publishedSection(project, { ideas, onChange }) {
  const card = h('section', { class: 'card' });
  const perf = project.performance;
  if (!project.publishedVideoId || !perf) {
    const input = h('input', { placeholder: 'Paste your published video link', class: 'grow' });
    const msg = h('span', { class: 'small' });
    card.append(
      h('div', { class: 'card-head' }, h('h2', {}, 'After publishing')),
      h('p', { class: 'muted small' }, 'Link the published video to track it for 30 days: views at 48 hours and 7 days, its outlier score against your channel, and (signed in) its real retention. Link it on publish day to capture the 48-hour mark.'),
      h('form', { class: 'row', onsubmit: async (e) => {
        e.preventDefault();
        msg.textContent = 'Tracking…';
        try {
          onChange(await send({ type: 'projectPublish', id: project.id, input: input.value }));
        } catch (err) {
          msg.textContent = err.message;
        }
      } }, input, h('button', { class: 'primary', type: 'submit' }, 'Start tracking'), msg),
    );
    return card;
  }
  const v = perf.video;
  const last = perf.history[perf.history.length - 1];
  const kpi = (k, val, sub) => h('div', { class: 'kpi' }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, val), sub && h('div', { class: 'k' }, sub));
  const ms = (m) => (m ? `${fmtNum(m.views)} views` : '—');
  const models = (project.inspiration ?? []).map((id) => ideas[id]).filter(Boolean);
  const own = h('div', {});
  card.append(
    ...[
    h('div', { class: 'card-head' }, h('h2', {}, 'After publishing'), h('span', { class: 'muted small' }, `Tracked ${perf.history.length} time${perf.history.length === 1 ? '' : 's'} · ${Math.round(last.hours)} hours after publishing`),
      h('button', { onclick: async () => onChange(await send({ type: 'projectTrack', id: project.id })) }, 'Refresh now')),
    h('div', { class: 'row' }, h('img', { src: v.thumb, alt: '', style: 'width:160px;border-radius:8px' }), h('a', { href: videoUrl(v), target: '_blank', style: 'font-weight:600' }, v.title)),
    h('div', { class: 'kpis' },
      kpi('Views now', fmtNum(last.views)),
      kpi('Outlier score', fmtMult(last.multiplier), `vs your median of ${fmtNum(last.baselineMedian)}`),
      kpi('At 48 hours', ms(perf.milestones.h48), perf.milestones.h48 ? fmtMult(perf.milestones.h48.multiplier) : 'not captured'),
      kpi('At 7 days', ms(perf.milestones.d7), perf.milestones.d7 ? fmtMult(perf.milestones.d7.multiplier) : last.hours < 168 ? 'coming up' : 'not captured'),
      kpi('Like rate', fmtPct(last.views ? last.likes / last.views : null, 1))),
    models.length > 0 && h('p', { class: 'small' }, 'Modelled on: ', models.map((m, i) => [i ? ' · ' : '', h('span', { class: `pill tier-${tier(mult(m))}` }, fmtMult(mult(m))), ` ${m.title.slice(0, 50)}`])),
    perf.history.length > 1 &&
      lineChart({ label: 'Views since publishing', height: 160, area: true, series: [{ name: 'Views', color: 'var(--series-1, #2a78d6)', points: perf.history.map((s) => ({ x: s.hours, y: s.views })) }], xFormat: (x) => (x < 48 ? `${Math.round(x)}h` : `${Math.round(x / 24)}d`), yFormat: fmtNum }),
    own,
    ].filter(Boolean), // conditionals above may be false
  );
  // Your real retention and CTR, if this is your channel and you're signed in.
  send({ type: 'authStatus' }).then(async (auth) => {
    if (!auth.signedIn || auth.me?.id !== v.channelId) {
      own.append(h('p', { class: 'muted small' }, 'Sign in on the My channel page to add your real retention, watch time and click-through rate.'));
      return;
    }
    try {
      const [totals, curve] = await Promise.all([send({ type: 'myVideoTotals', id: v.id, publishedAt: v.publishedAt }), send({ type: 'myRetention', id: v.id, publishedAt: v.publishedAt })]);
      own.append(
        ...[h('div', { class: 'kpis' },
          kpi('Avg % viewed', totals.averageViewPercentage == null ? '—' : `${Number(totals.averageViewPercentage).toFixed(1)}%`),
          kpi('Avg view duration', totals.averageViewDuration == null ? '—' : formatTime(totals.averageViewDuration)),
          kpi('Subscribers gained', fmtNum(totals.subscribersGained)),
          totals.videoThumbnailImpressionsClickRate != null && kpi('Thumbnail CTR', `${Number(totals.videoThumbnailImpressionsClickRate).toFixed(1)}%`, `${fmtNum(totals.videoThumbnailImpressions)} impressions`)),
        curve.length > 0 && h('h3', {}, 'Audience retention'),
        curve.length > 0 && lineChart({ label: 'Audience retention', height: 180, series: [{ name: 'Retention', color: 'var(--series-1, #2a78d6)', points: curve.map((p) => ({ x: p.ratio * 100, y: p.watch * 100 })) }], xFormat: (x) => (v.durationSec ? formatTime((x / 100) * v.durationSec) : `${Math.round(x)}%`), yFormat: (y) => `${Math.round(y)}%` })].filter(Boolean),
      );
    } catch (err) {
      own.append(h('p', { class: 'error small' }, err.message));
    }
  });
  return card;
}
