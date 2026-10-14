// Script tools for a project: checker (vs an outlier), drift zones, re-hook
// checkpoints, and the AI hook rewriter / re-hook writer.

import { h, fmtMult } from '../lib/ui.js';
import { analyzeScript, draftSegments, driftZones, rehookCheckpoints, compareScripts, hookSummary } from '../lib/script.js';
import { formatTime } from '../lib/stats.js';
import { activeAi, generate, hookPrompt, rehookPrompt, PROVIDERS } from '../lib/ai.js';
import { markdownToHtml } from '../lib/markdown.js';

const mdBlock = (text) => {
  const div = h('div', { class: 'md' });
  div.innerHTML = markdownToHtml(text); // escapes everything first
  return div;
};
const fmt = (row, v) => (row.kind === 'time' ? formatTime(v) : row.kind === 'rate' ? v.toFixed(1) : String(v));

async function runAi(box, btn, build, onText) {
  const ai = await activeAi();
  if (!ai) {
    box.replaceChildren(h('p', { class: 'muted small' }, 'AI is optional. Connect a provider in ', h('a', { href: '../options/options.html' }, 'Settings'), '.'));
    return;
  }
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Thinking…';
  box.replaceChildren(h('p', { class: 'muted small' }, `Asking ${PROVIDERS[ai.provider].label} (${ai.model}). Long scripts can take a minute…`));
  try {
    const { system, prompt } = build(ai.niche);
    const text = await generate({ ...ai, system, prompt });
    box.replaceChildren(h('p', { class: 'muted small' }, `${PROVIDERS[ai.provider].label} · ${ai.model}`), mdBlock(text));
    await onText?.(text, ai);
  } catch (err) {
    box.replaceChildren(h('p', { class: 'error' }, err.message));
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

/**
 * project: the project; getScript(): current script text; ideas/transcripts:
 * saved outliers and their transcripts; save(patch): persists to the project.
 */
export function scriptToolsSection(project, { getScript, ideas, transcripts, save }) {
  const refs = (project.inspiration ?? []).filter((id) => transcripts[id]).map((id) => ideas[id]).filter(Boolean);
  const wpm = h('input', { type: 'number', min: 100, max: 220, step: 5, value: project.checks?.wpm ?? 150, style: 'width:70px' });
  const refSel = h('select', { 'aria-label': 'Compare with' }, h('option', { value: '' }, refs.length ? 'Compare with an outlier…' : 'Link an outlier with a saved transcript to compare'), refs.map((i) => h('option', { value: i.id, selected: project.checks?.ref === i.id }, `${fmtMult(i.stats?.multiplier ?? i.multiplier)} · ${i.title.slice(0, 60)}`)));
  const out = h('div', {});
  const hookBox = h('div', {}, project.ai?.hooks ? mdBlock(project.ai.hooks.text) : null);
  const rehookBox = h('div', {}, project.ai?.rehooks ? mdBlock(project.ai.rehooks.text) : null);

  // The hook library: openings of every saved outlier with a transcript.
  const library = Object.entries(transcripts)
    .map(([id, tx]) => (ideas[id] ? { ...hookSummary(tx.segments, ideas[id].title), title: ideas[id].title, multiplier: ideas[id].stats?.multiplier ?? ideas[id].multiplier } : null))
    .filter((x) => x?.text)
    .sort((a, b) => (b.multiplier ?? 0) - (a.multiplier ?? 0));

  function check() {
    const text = getScript();
    if (text.split(/\s+/).filter(Boolean).length < 40) {
      out.replaceChildren(h('p', { class: 'muted small' }, 'Write at least a few paragraphs of script to check it.'));
      return null;
    }
    const segs = draftSegments(text, Number(wpm.value) || 150);
    const mine = analyzeScript(segs, { title: project.title });
    const zones = driftZones(mine, segs);
    const cps = rehookCheckpoints(mine, segs);
    let comparison = null;
    if (refSel.value && transcripts[refSel.value]) {
      const ref = ideas[refSel.value];
      const refA = analyzeScript(transcripts[refSel.value].segments, { title: ref.title, durationSec: ref.durationSec });
      comparison = h('table', { class: 'cmp' },
        h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', {}, 'Your draft'), h('th', {}, `Outlier (${fmtMult(ref.stats?.multiplier ?? ref.multiplier)})`))),
        h('tbody', {}, compareScripts(mine, refA).map((r) => h('tr', {}, h('td', {}, r.label), h('td', { class: r.mine < r.ref * 0.6 && r.kind !== 'time' ? 'low' : '' }, fmt(r, r.mine)), h('td', {}, fmt(r, r.ref))))));
    }
    save({ checks: { wpm: Number(wpm.value) || 150, ref: refSel.value, at: Date.now() } });
    out.replaceChildren(
      h('div', { class: 'tool-grid' },
        h('div', {},
          h('h3', {}, `Hook · ${mine.hook.checks.filter((c) => c.pass).length} of ${mine.hook.checks.filter((c) => c.pass !== null).length} signals`),
          h('div', { class: 'quote' }, mine.hook.text),
          h('ul', { class: 'checks' }, mine.hook.checks.map((c) => h('li', {}, h('span', { class: c.pass ? 'ok' : 'muted' }, c.pass ? '✓ ' : '○ '), c.label)))),
        h('div', {},
          h('h3', {}, 'Re-hook checkpoints'),
          h('ul', { class: 'checks' }, cps.map((c) => h('li', {}, h('span', { class: c.covered ? 'ok' : 'warn' }, c.covered ? '✓ ' : '⚠ '), `${Math.round(c.at * 100)}% (${formatTime(c.start)}): `, h('i', {}, `"${c.line.slice(0, 90)}${c.line.length > 90 ? '…' : ''}"`), c.covered ? '' : ' (no hook nearby)'))),
          h('h3', { style: 'margin-top:12px' }, `Drift zones (${zones.length})`),
          zones.length
            ? h('ul', { class: 'checks' }, zones.map((z) => h('li', {}, h('span', { class: 'warn' }, '⚠ '), `${formatTime(z.start)}–${formatTime(z.end)}: ${Math.round(z.end - z.start)} s without a hook, twist, question or tease. Starts: `, h('i', {}, `"${z.firstLine.slice(0, 80)}…"`))))
            : h('p', { class: 'ok small' }, 'No stretch longer than a minute without an attention device.'))),
      h('p', { class: 'muted small' }, `${mine.totalWords} words ≈ ${formatTime(mine.duration)} at ${wpm.value} wpm · ${(Object.entries(mine.perMinute).filter(([k]) => k !== 'proof' && k !== 'cta').reduce((n, [, v]) => n + v, 0)).toFixed(1)} attention devices / min`),
      comparison,
    );
    return { mine, cps, segs };
  }

  const checkBtn = h('button', { class: 'primary', onclick: check }, 'Check script');
  const hookBtn = h('button', {}, 'Rewrite my hook (AI)');
  hookBtn.addEventListener('click', () => {
    const segs = draftSegments(getScript(), Number(wpm.value) || 150);
    const current = segs.filter((s) => s.start < 30).map((s) => s.text).join(' ');
    runAi(hookBox, hookBtn, (niche) => hookPrompt(project, current, library, niche), (text, ai) => save({ ai: { ...(project.ai ?? {}), hooks: { text, model: ai.model, at: Date.now() } } }));
  });
  const rehookBtn = h('button', {}, 'Write re-hooks (AI)');
  rehookBtn.addEventListener('click', () => {
    const r = check();
    if (!r) return;
    runAi(rehookBox, rehookBtn, (niche) => rehookPrompt(project, getScript(), r.cps, niche), (text, ai) => save({ ai: { ...(project.ai ?? {}), rehooks: { text, model: ai.model, at: Date.now() } } }));
  });

  return h(
    'section',
    { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', {}, 'Script check'), h('label', { class: 'small muted' }, 'Pace ', wpm, ' wpm'), refSel, checkBtn),
    h('p', { class: 'muted small' }, 'Times your draft at a speaking pace and analyzes it like the outliers: hook signals, re-hook checkpoints at 25 / 50 / 75%, and drift zones (a minute or more without an attention device).'),
    out,
    h('div', { class: 'card-head', style: 'margin-top:8px' }, h('h2', {}, 'Hook rewriter'), h('span', { class: 'muted small' }, `${library.length} hooks in your library`), hookBtn),
    hookBox,
    h('div', { class: 'card-head', style: 'margin-top:8px' }, h('h2', {}, 'Re-hook planner'), rehookBtn),
    rehookBox,
  );
}
