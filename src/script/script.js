import { mountShell } from '../lib/nav.js';
import { send, h, fmtNum, fmtMult, tier, videoUrl, download } from '../lib/ui.js';
import { analyzeScript, hookSummary, DEVICES } from '../lib/script.js';
import { formatTime } from '../lib/stats.js';
import { activeAi, generate, scriptPrompt, outlinePrompt, PROVIDERS } from '../lib/ai.js';
import { markdownToHtml } from '../lib/markdown.js';
import { parseTime, notesMarkdown } from '../lib/notes.js';

mountShell('script');

const main = document.getElementById('main');
const LANES = ['openLoop', 'turn', 'question', 'stakes', 'story', 'cta'];
const params = new URLSearchParams(location.search);

const at = (id, sec) => `https://www.youtube.com/watch?v=${id}&t=${Math.floor(sec)}s`;
const ts = (id, sec) => h('a', { class: 'ts', href: at(id, sec), target: '_blank', title: 'Open the video at this moment' }, formatTime(sec));
const errorBox = (msg) => h('div', { class: 'error' }, msg);
function mdBlock(text) {
  const div = h('div', { class: 'md' });
  div.innerHTML = markdownToHtml(text); // escapes everything first
  return div;
}

async function load(id) {
  const [{ ideas = {} }, txData, hmData, google, notes] = await Promise.all([
    chrome.storage.local.get('ideas'),
    chrome.storage.local.get(`tx:${id}`),
    chrome.storage.local.get(`hm:${id}`),
    send({ type: 'authStatus' }).catch(() => ({})),
    send({ type: 'notesGet', id }).catch(() => null),
  ]);
  return { idea: ideas[id], tx: txData[`tx:${id}`], heatmap: hmData[`hm:${id}`]?.points ?? null, me: google.signedIn ? google.me : null, notes };
}

// ---------- your notes ----------

// Built once per page and reused across re-renders, so a half-written note survives.
let notesUi = null;
function notesCard(idea, entry) {
  if (notesUi) return notesUi;
  const id = idea.id;
  let notes = entry?.notes ?? [];
  const list = h('ol', { class: 'notes' });
  const count = h('span', { class: 'muted small' });
  const msg = h('p', { class: 'error small', role: 'status', hidden: true });
  const time = h('input', { class: 'note-time', placeholder: '0:00', 'aria-label': 'Time in the video', inputmode: 'numeric' });
  const text = h('textarea', { class: 'note-text', rows: 2, placeholder: 'What you noticed here: a hook trick, a cut, a line to steal… (Ctrl+Enter to add)', 'aria-label': 'Note' });
  const addBtn = h('button', { class: 'primary' }, 'Add note');
  const dl = h('button', { onclick: () => download(`notes-${idea.title.slice(0, 50)}.md`, notesMarkdown({ videoId: id, title: idea.title, notes }), 'text/markdown;charset=utf-8') }, 'Download');

  const fail = (err) => {
    msg.textContent = err.message;
    msg.hidden = false;
  };
  const apply = (e) => {
    notes = e.notes;
    msg.hidden = true;
    paint();
  };
  async function add() {
    try {
      apply(await send({ type: 'notesAdd', id, note: { t: time.value.trim() || '0', text: text.value, title: idea.title } }));
      text.value = '';
      text.focus();
    } catch (err) {
      fail(err);
    }
  }
  addBtn.addEventListener('click', add);
  text.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) add();
  });

  function row(n) {
    const li = h('li', {});
    const view = () =>
      li.replaceChildren(
        ts(id, n.t),
        Object.assign(mdBlock(n.text), { className: 'md note-body', title: 'Click to edit', tabIndex: 0, onclick: (e) => e.target.tagName !== 'A' && edit(), onkeydown: (e) => e.key === 'Enter' && edit() }),
        h('button', { class: 'icon', title: 'Delete note', 'aria-label': 'Delete note', onclick: async () => { if (confirm('Delete this note?')) send({ type: 'notesDelete', id, noteId: n.id }).then(apply, fail); } }, '✕'),
      );
    function edit() {
      const t2 = h('input', { class: 'note-time', value: formatTime(n.t), 'aria-label': 'Time in the video' });
      const x2 = h('textarea', { class: 'note-text', rows: 3, value: n.text, 'aria-label': 'Note' });
      const save = () => send({ type: 'notesUpdate', id, noteId: n.id, patch: { t: t2.value, text: x2.value } }).then(apply, fail);
      x2.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) save();
        if (e.key === 'Escape') view();
      });
      li.replaceChildren(h('div', { class: 'note-edit' }, t2, x2, h('div', { class: 'row' }, h('button', { class: 'primary', onclick: save }, 'Save'), h('button', { onclick: view }, 'Cancel'))));
      x2.focus();
    }
    view();
    return li;
  }
  function paint() {
    count.textContent = notes.length ? `${notes.length} note${notes.length === 1 ? '' : 's'}` : '';
    dl.hidden = !notes.length;
    list.replaceChildren(...(notes.length ? notes.map(row) : [h('li', { class: 'muted small empty' }, 'No notes yet. Add one above, click "+ note" next to a transcript line, or use "Add note" in the YT Toolkit panel while watching on YouTube.')]));
  }
  paint();

  // Notes added from the YouTube tab show up here right away.
  chrome.storage.onChanged.addListener((changes, area) => {
    const c = changes[`sn:${id}`];
    if (area === 'local' && c) {
      notes = c.newValue?.notes ?? [];
      paint();
    }
  });

  const el = h('section', { class: 'card', id: 'notes' },
    h('div', { class: 'row' }, h('h3', { class: 'grow', style: 'margin:0' }, 'My notes'), count, dl),
    h('p', { class: 'muted small' }, 'Your own notes on this video, pinned to the moment they are about. Click a time to open the video there.'),
    h('div', { class: 'note-add' }, time, text, addBtn),
    msg,
    list);
  notesUi = {
    el,
    at(sec) {
      time.value = formatTime(sec);
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      text.focus({ preventScroll: true });
    },
  };
  return notesUi;
}

// ---------- single video ----------

function timeline(id, a) {
  const pct = (t) => `${Math.min(100, (t / a.duration) * 100)}%`;
  const laneH = 16;
  const track = h('div', { class: 'timeline', style: `height:${LANES.length * laneH}px` });
  for (const d of a.devices) {
    const lane = LANES.indexOf(d.type);
    if (lane < 0) continue;
    track.append(
      h('a', {
        class: 'mark',
        href: at(id, d.start),
        target: '_blank',
        title: `${formatTime(d.start)} · ${DEVICES[d.type].label}\n"${d.text}"`,
        style: `left:${pct(d.start)};top:${lane * laneH + 3}px;height:${laneH - 6}px;background:var(--d-${d.type})`,
      }),
    );
  }
  return h(
    'section',
    { class: 'card' },
    h('h3', {}, 'Attention devices across the video'),
    h('p', { class: 'muted small' }, 'One lane per device. Hover a mark for the quote, click to jump to that moment.'),
    h('div', { class: 'row', style: 'align-items:stretch;gap:8px' },
      h('div', { class: 'legend', style: `flex-direction:column;gap:0;flex-wrap:nowrap;width:190px;height:${LANES.length * laneH}px;margin-top:8px` },
        LANES.map((t) => h('span', { style: `height:${laneH}px;font-size:11px;white-space:nowrap` }, h('span', { class: 'key', style: `background:var(--d-${t});width:8px;height:8px` }), `${DEVICES[t].label} (${a.counts[t]})`))),
      h('div', { class: 'grow' }, track, h('div', { class: 'axis' }, ['0:00', formatTime(a.duration / 2), formatTime(a.duration)].map((x) => h('span', {}, x))))),
  );
}

function render({ idea, tx, heatmap, me, notes: noteEntry }, retention) {
  const id = idea.id;
  const a = analyzeScript(tx.segments, { title: idea.title, durationSec: idea.durationSec, heatmap, retention });
  const kpi = (k, v, title) => h('div', { class: 'kpi', title }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v));
  const aiBox = h('div', { id: 'ai' }, tx.ai ? aiResult('Script breakdown', tx.ai) : null);
  const outlineBox = h('div', {}, tx.outline ? aiResult(`Outline: ${tx.outline.topic}`, tx.outline) : null);
  const topic = h('input', { placeholder: 'Your video topic, e.g. "7 days in Seoul on $100"', class: 'grow', value: tx.outline?.topic ?? '' });
  const runBtn = h('button', { class: 'primary', onclick: () => runScriptAi(idea, tx, a, aiBox, runBtn) }, tx.ai ? 'Re-run AI breakdown' : 'Break down the script with AI');
  const outlineBtn = h('button', { onclick: () => runOutline(idea, tx, topic.value.trim(), outlineBox, outlineBtn) }, 'Outline my version');
  const myNotes = notesCard(idea, noteEntry);

  main.replaceChildren(
    h(
      'div',
      { class: 'head' },
      h('img', { src: idea.thumb, alt: '' }),
      h(
        'div',
        { class: 'grow' },
        h('h2', {}, h('a', { href: videoUrl(idea), target: '_blank' }, idea.title)),
        h('div', { class: 'muted' }, `${idea.channelTitle} · ${fmtNum(idea.views)} views · `, h('span', { class: `pill tier-${tier(idea.stats?.multiplier ?? idea.multiplier)}` }, fmtMult(idea.stats?.multiplier ?? idea.multiplier))),
        retention && h('div', { class: 'muted small' }, 'Your video: drop-offs come from your own retention data.'),
      ),
      h('a', { class: 'button-link', href: `../audience/audience.html?v=${idea.id}`, title: 'What viewers asked and requested in the comments' }, 'Audience questions'),
      h('button', { onclick: () => download(`${idea.title.slice(0, 60)}.txt`, tx.segments.map((s) => `[${formatTime(s.start)}] ${s.text}`).join('\n')) }, 'Download transcript'),
    ),
    h(
      'div',
      { class: 'kpis' },
      kpi('Length', formatTime(a.duration)),
      kpi('Words', fmtNum(a.totalWords)),
      kpi('Pace', `${a.wpm} wpm`, 'Words per minute; ~150 is conversational, 180+ is fast'),
      kpi('Hook', `${a.hook.words} words`, 'Words spoken in the first 30 seconds'),
      kpi('Devices / min', (Object.entries(a.perMinute).filter(([k]) => k !== 'proof').reduce((n, [, v]) => n + v, 0)).toFixed(1), 'Open loops, turns, questions, stakes, story beats and CTAs per minute'),
      kpi('"You" / min', a.youPerMinute.toFixed(1), 'How often the script talks to the viewer directly'),
    ),
    myNotes.el,
    h(
      'section',
      { class: 'card' },
      h('div', { class: 'row' }, h('h3', { class: 'grow', style: 'margin:0' }, 'AI script breakdown'), runBtn),
      h('p', { class: 'muted small' }, 'Hook, story structure, attention tactics with quotes, keywords, promise and payoff, and a reusable beat sheet.'),
      aiBox,
    ),
    h(
      'div',
      { class: 'cols' },
      h(
        'section',
        { class: 'card' },
        h('h3', {}, 'The hook (first 30 seconds)'),
        h('div', { class: 'quote' }, a.hook.text || '—'),
        h('div', { class: 'small muted', style: 'margin-top:8px' }, `Hook signals found: ${a.hook.checks.filter((c) => c.pass).length} of ${a.hook.checks.filter((c) => c.pass !== null).length}. Common tactics, not rules: calm guides can open without them. The AI breakdown explains what this hook actually does.`),
        h('ul', { class: 'checks' }, a.hook.checks.map((c) => h('li', {}, h('span', { class: c.pass ? 'ok' : 'muted' }, c.pass === null ? '–' : c.pass ? '✓' : '○'), ' ', c.label))),
      ),
      h(
        'section',
        { class: 'card' },
        h('h3', {}, a.dropOffs.length ? 'Where viewers left (your retention)' : 'What was said at the most replayed moments'),
        a.dropOffs.length
          ? a.dropOffs.map((d) => h('div', {}, h('div', { class: 'small muted' }, ts(id, d.start), `−${(d.drop * 100).toFixed(1)}% of viewers`), d.lines.map((l) => h('div', { class: 'quote' }, ts(id, l.start), l.text))))
          : a.replayed.length
            ? a.replayed.map((r) =>
                h('div', { style: 'margin-bottom:10px' },
                  h('div', { class: 'small muted' }, ts(id, r.start), `replay intensity ${(r.intensity * 100).toFixed(0)}%`),
                  r.silent
                    ? h('div', { class: 'quote muted' }, 'No speech here, so it is likely a visual moment (a reveal, b-roll or music). Watch it to see what draws the rewatches.')
                    : r.lines.map((l) => h('div', { class: 'quote' }, ts(id, l.start), l.text))))
            : h('p', { class: 'muted' }, 'No "Most replayed" heatmap saved for this video.'),
      ),
    ),
    timeline(id, a),
    h(
      'div',
      { class: 'cols' },
      h(
        'section',
        { class: 'card' },
        h('h3', {}, 'Keywords spoken'),
        h('table', {},
          h('thead', {}, h('tr', {}, h('th', {}, 'Term'), h('th', { class: 'num' }, 'Times'), h('th', { class: 'num' }, 'First said'), h('th', {}, ''))),
          h('tbody', {}, a.keywords.slice(0, 12).map((k) => h('tr', {}, h('td', {}, k.term), h('td', { class: 'num' }, k.count), h('td', { class: 'num' }, ts(id, k.firstAt)), h('td', { class: 'small muted' }, k.inTitle ? 'in title' : ''))))),
        h('p', { class: 'small muted' }, 'Title words in the script: ', a.titleTerms.map((t) => `${t.term} ×${t.count}${t.firstAt != null ? ` (from ${formatTime(t.firstAt)})` : ' (never said)'}`).join(' · ') || '—'),
      ),
      h(
        'section',
        { class: 'card' },
        h('h3', {}, 'Structure'),
        h('table', {},
          h('thead', {}, h('tr', {}, h('th', {}, 'Section'), h('th', { class: 'num' }, 'Pace'), h('th', { class: 'num' }, 'Devices'), h('th', {}, heatmap ? 'Replays' : retention ? 'Watching' : ''), h('th', {}, 'About'))),
          h('tbody', {}, a.structure.map((s) =>
            h('tr', {},
              h('td', {}, ts(id, s.start)),
              h('td', { class: 'num' }, `${s.wpm}`),
              h('td', { class: 'num' }, s.devices),
              h('td', { style: 'width:80px' }, s.retention != null ? `${Math.round(s.retention * 100)}%` : s.heat != null ? h('div', { class: 'bar', style: `width:${Math.round(s.heat * 100)}%`, title: `${Math.round(s.heat * 100)}% replay intensity` }) : ''),
              h('td', { class: 'small' }, s.topWords.join(', '))))),
        ),
      ),
    ),
    h(
      'section',
      { class: 'card' },
      h('h3', {}, 'Outline my version'),
      h('p', { class: 'muted small' }, 'AI writes a hook, beat sheet and re-hooks for your topic, borrowing this video\'s structure.'),
      h('div', { class: 'row' }, topic, outlineBtn),
      outlineBox,
    ),
    h(
      'section',
      { class: 'card' },
      h('h3', {}, 'Transcript'),
      h('div', { class: 'transcript' }, tx.segments.map((s) => {
        const d = a.devices.find((x) => x.start === s.start);
        return h('p', {}, ts(id, s.start), d ? h('mark', { title: DEVICES[d.type].label }, s.text) : s.text,
          h('button', { class: 'add-note', title: `Add a note at ${formatTime(s.start)}`, onclick: () => myNotes.at(s.start) }, '+ note'));
      })),
    ),
  );
}

function aiResult(title, ai) {
  return h('div', {},
    h('div', { class: 'row' }, h('span', { class: 'muted small grow' }, `${title} · ${PROVIDERS[ai.provider]?.label ?? ai.provider} · ${ai.model} · ${new Date(ai.at).toLocaleString()}`),
      h('button', { onclick: (e) => navigator.clipboard.writeText(ai.text).then(() => (e.target.textContent = 'Copied')) }, 'Copy')),
    mdBlock(ai.text));
}

async function withAi(box, btn, fn) {
  const ai = await activeAi();
  if (!ai) {
    box.replaceChildren(h('p', { class: 'muted' }, 'AI is optional. Connect Gemini, OpenAI, Claude or OpenRouter in ', h('a', { href: '../options/options.html', target: '_blank' }, 'Settings'), '.'));
    return;
  }
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Thinking…';
  box.replaceChildren(h('div', { class: 'loading' }, `Asking ${PROVIDERS[ai.provider].label} (${ai.model}). Long transcripts can take a minute…`));
  try {
    await fn(ai);
  } catch (err) {
    box.replaceChildren(errorBox(err.message));
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

function runScriptAi(idea, tx, analysis, box, btn) {
  return withAi(box, btn, async (ai) => {
    const { system, prompt } = scriptPrompt(idea, tx.segments, analysis, ai.niche);
    const text = await generate({ ...ai, system, prompt });
    const result = { text, provider: ai.provider, model: ai.model, at: Date.now() };
    await send({ type: 'saveScriptAi', id: idea.id, key: 'ai', ai: result });
    tx.ai = result;
    box.replaceChildren(aiResult('Script breakdown', result));
  });
}

function runOutline(idea, tx, topic, box, btn) {
  if (!topic) {
    box.replaceChildren(h('p', { class: 'muted' }, 'Type your video topic first.'));
    return;
  }
  return withAi(box, btn, async (ai) => {
    const { system, prompt } = outlinePrompt(idea, tx.ai?.text, tx.segments, topic, ai.niche);
    const text = await generate({ ...ai, system, prompt });
    const result = { text, topic, provider: ai.provider, model: ai.model, at: Date.now() };
    await send({ type: 'saveScriptAi', id: idea.id, key: 'outline', ai: result });
    await send({ type: 'saveAiRun', run: { title: `Outline: ${topic}`, text, provider: ai.provider, model: ai.model } });
    box.replaceChildren(
      aiResult(`Outline: ${topic}`, result),
      h('button', {
        class: 'primary',
        onclick: async () => {
          const p = await send({ type: 'projectCreate', data: { title: topic, outline: text, inspiration: [idea.id], source: { type: 'outline', id: idea.id } } });
          location.href = `../project/project.html?id=${p.id}`;
        },
      }, 'Save as a project on the Idea board'),
    );
  });
}

// ---------- hook library ----------

function notedSection(noted, all) {
  if (!noted.length) return null;
  return h('section', { class: 'card' },
    h('h2', {}, 'Videos you took notes on'),
    h('ul', { class: 'noted' }, noted.map((n) => {
      const analyzed = all[`tx:${n.videoId}`] && all.ideas?.[n.videoId];
      return h('li', {},
        h('img', { src: `https://i.ytimg.com/vi/${n.videoId}/mqdefault.jpg`, alt: '', loading: 'lazy' }),
        h('div', { class: 'grow' },
          analyzed
            ? h('a', { class: 't', href: `script.html?id=${n.videoId}#notes` }, n.title || n.videoId)
            : h('a', { class: 't', href: `https://www.youtube.com/watch?v=${n.videoId}`, target: '_blank', title: 'Open on YouTube; save its transcript there to analyze it here' }, n.title || n.videoId),
          h('div', { class: 'muted small' }, `${n.count} note${n.count === 1 ? '' : 's'} · ${analyzed ? 'analyzed' : 'not analyzed yet'}`)));
    })));
}

async function renderLibrary() {
  const [all, noted] = await Promise.all([chrome.storage.local.get(null), send({ type: 'notesList' }).catch(() => [])]);
  const ideas = all.ideas ?? {};
  const rows = Object.keys(all)
    .filter((k) => k.startsWith('tx:') && ideas[k.slice(3)])
    .map((k) => ({ idea: ideas[k.slice(3)], tx: all[k] }))
    .map((r) => ({ ...r, hook: hookSummary(r.tx.segments, r.idea.title), mult: r.idea.stats?.multiplier ?? r.idea.multiplier }))
    .filter((r) => r.hook)
    .sort((a, b) => (b.mult ?? 0) - (a.mult ?? 0));
  main.replaceChildren(
    notedSection(noted, all) ?? '',
    h('section', { class: 'card' },
      h('div', { class: 'row' }, h('h2', { class: 'grow' }, 'Hook library'),
        rows.length > 0 && h('button', {
          onclick: () => download('hook-library.txt', rows.map((r) => `${r.idea.title} (${fmtMult(r.mult)})\n${videoUrl(r.idea)}\n${r.hook.text}\n`).join('\n')),
        }, 'Export hooks')),
      h('p', { class: 'muted small' }, 'The first 30 seconds of every saved outlier with a transcript, strongest outliers first. To add one: open a video on YouTube, then Transcript → Save transcript (or Analyze script) in the YT Toolkit panel.')),
    rows.length
      ? h('div', { class: 'hooks' }, rows.map((r) =>
          h('div', { class: 'hookrow' },
            h('a', { href: `script.html?id=${r.idea.id}` }, h('img', { src: r.idea.thumb, alt: '', loading: 'lazy' })),
            h('div', {},
              h('div', { class: 'row' }, h('a', { class: 't grow', href: `script.html?id=${r.idea.id}` }, r.idea.title), h('span', { class: `pill tier-${tier(r.mult)}` }, fmtMult(r.mult))),
              h('div', { class: 'hook' }, r.hook.text),
              h('div', { class: 'chips' }, r.hook.checks.filter((c) => c.pass).map((c) => h('span', { class: 'chip ok' }, `✓ ${c.label}`)))))))
      : h('p', { class: 'muted' }, 'No transcripts saved yet.'),
  );
}

// ---------- start ----------

const id = params.get('id');
if (!id) renderLibrary();
else {
  main.replaceChildren(h('div', { class: 'loading' }, 'Analyzing the script…'));
  const data = await load(id);
  if (!data.idea || !data.tx) {
    main.replaceChildren(errorBox('No saved transcript for this video. On its YouTube page, use Transcript → Save transcript in the YT Toolkit panel.'));
  } else {
    render(data, null);
    // For your own videos, map your real retention drop-offs onto the script.
    if (data.me && data.me.id === data.idea.channelId) {
      send({ type: 'myRetention', id, publishedAt: data.idea.publishedAt })
        .then((retention) => retention?.length && render(data, retention))
        .catch(() => {});
    }
  }
}
