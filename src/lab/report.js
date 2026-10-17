// Renders a saved test screening: the headline numbers, the attention curve,
// where viewers left, every viewer's reactions, and what to change.

import { h } from '../lib/ui.js';
import { lineChart } from '../lib/linechart.js';
import { markdownToHtml } from '../lib/markdown.js';
import { PROVIDERS } from '../lib/ai.js';
import { face } from './face.js';

const pct = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`);
const clock = (sec) => (sec == null ? '' : `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`);
const CLICK = { yes: 'Would click', maybe: 'Might click', no: 'Scrolls past' };

function tile(label, value, note, title) {
  return h('div', { class: 'tile', title }, h('div', { class: 'k' }, label), h('div', { class: 'v' }, value), note && h('div', { class: 'n' }, note));
}

export function headline(sim) {
  const r = sim.result;
  const b = sim.baseline;
  return h('div', { class: 'tiles' },
    tile('Would click', pct(r.clickShare), b?.ctr != null ? `your real click rate: ${b.ctr.toFixed(1)}% of impressions` : 'share of this audience', 'Weighted by each viewer\'s share of the audience; "maybe" counts half. People shown a video in a real feed click far less often, so compare titles and versions, not this number with YouTube\'s.'),
    tile('Stay past the hook', pct(r.hookHold), sim.material?.hook ? 'of those who click' : 'no script yet'),
    tile('Watch on average', pct(r.watchedShare), b?.avgViewed != null ? `your real average: ${Math.round(b.avgViewed)}%` : 'estimated, of those who click', b?.bySub?.subscribed != null || b?.bySub?.unsubscribed != null ? 'Each viewer was anchored to your channel\'s real watch time for subscribers and non-subscribers.' : 'Each viewer was anchored to typical YouTube watch times (sign in on My channel to use your own).'),
    tile('Reach the end', pct(r.finishShare), r.score != null ? `score ${r.score.toFixed(1)}/10` : ''),
    r.score != null && tile('Would subscribe', pct(r.subscribe), `like ${pct(r.like)} · share ${pct(r.share)}`, 'Among those who reach the end'));
}

function curveChart(sim) {
  const beats = sim.material.beats;
  const pts = sim.result.curve.filter((c) => c.attention != null);
  if (pts.length < 2) return null;
  const timed = beats.every((b) => b.start != null);
  const x = (i) => (timed ? beats[i].start : i);
  return lineChart({
    label: 'Attention through the video',
    height: 180,
    series: [
      { name: 'Attention (0–10)', color: 'var(--series-1)', points: pts.map((c) => ({ x: x(c.i), y: c.attention })) },
      { name: 'Still watching (0–10 = 0–100%)', color: 'var(--series-2)', points: sim.result.curve.map((c) => ({ x: x(c.i), y: c.watching * 10 })) },
    ],
    xFormat: (v) => (timed ? clock(Math.round(v)) : `beat ${Math.round(v) + 1}`),
    yFormat: (v) => v.toFixed(0),
    yMax: 10,
  });
}

function beatTable(sim) {
  const name = Object.fromEntries(sim.avatars.map((a) => [a.id, a.name]));
  return h('table', { class: 'beats' },
    h('thead', {}, h('tr', {}, h('th', {}, 'Beat'), h('th', {}, 'Starts with'), h('th', {}, 'Attention'), h('th', {}, 'Feeling'), h('th', {}, 'Watching'), h('th', {}, 'Left here'))),
    h('tbody', {}, sim.result.curve.map((c) => {
      const b = sim.material.beats[c.i];
      const left = sim.result.leaves.find((l) => l.i === c.i);
      return h('tr', { class: left ? 'drop' : '' },
        h('td', {}, b.start != null ? clock(b.start) : `${c.i + 1}`),
        h('td', { class: 'first' }, b.first),
        h('td', {}, c.attention == null ? '—' : `${c.attention.toFixed(1)}`),
        h('td', {}, c.emotion || '—'),
        h('td', {}, pct(c.watching)),
        h('td', {}, left ? `${left.who.map((id) => name[id]).join(', ')} (${pct(left.share)})` : ''));
    })));
}

function viewer(sim, a) {
  const f = sim.feed[a.id] ?? {};
  const st = sim.story[a.id];
  const outcome = f.click === 'no'
    ? 'Didn\'t click'
    : f.stay === false
      ? `Left in the opening${f.leaveAt != null ? ` at ${f.leaveAt}s` : ''}`
      : !st
        ? 'Stayed past the opening'
        : st.leftAt != null
          ? `Left at ${sim.material.beats[st.leftAt]?.start != null ? clock(sim.material.beats[st.leftAt].start) : `beat ${st.leftAt + 1}`}`
          : `Watched to the end · ${st.end?.score ?? '?'}/10`;
  const leaveBeat = st?.leftAt != null ? st.beats.find((b) => b.i === st.leftAt) : null;
  return h('article', { class: `viewer click-${f.click ?? 'no'}` },
    h('div', { class: 'v-top' }, face(a),
      h('div', {},
        h('b', {}, a.name), h('span', { class: 'muted small' }, ` · ${[a.age, a.occupation].filter(Boolean).join(', ')} · ${pct(a.weight)} of viewers`),
        h('div', { class: 'v-out' }, h('span', { class: `chip c-${f.click ?? 'no'}` }, CLICK[f.click] ?? '—'), ' ', outcome))),
    f.firstThought && h('p', { class: 'v-q' }, `“${f.firstThought}”`, f.clickWhy && h('span', { class: 'muted' }, ` ${f.clickWhy}`)),
    f.hookWhy && h('p', { class: 'v-line' }, h('span', { class: 'k' }, 'Opening: '), f.hookFeeling ? `${f.hookFeeling}. ` : '', f.hookWhy),
    leaveBeat?.thought && h('p', { class: 'v-line' }, h('span', { class: 'k' }, 'Why they left: '), `“${leaveBeat.thought}”`),
    st?.end?.comment && h('p', { class: 'v-line' }, h('span', { class: 'k' }, 'Their comment: '), `“${st.end.comment}”`),
    st?.end?.tellFriend && h('p', { class: 'v-line' }, h('span', { class: 'k' }, 'To a friend: '), `“${st.end.tellFriend}”`),
    st?.end && h('div', { class: 'chips' }, [st.end.like && 'likes it', st.end.subscribe && 'subscribes', st.end.share && 'shares', st.end.watchNext && 'watches another'].filter(Boolean).map((t) => h('span', { class: 'chip' }, t))),
    st?.beats?.length > 0 && h('details', { class: 'v-beats' }, h('summary', {}, 'Beat by beat'),
      h('ol', {}, st.beats.map((b) => h('li', { value: b.i + 1 }, h('b', {}, `${b.attention}/10 ${b.emotion}`), b.thought ? ` · “${b.thought}”` : '', b.leave ? ' · left' : '')))));
}

/**
 * The full report, or (compact) the headline, the biggest drop-offs and a
 * link to the full report in the Audience lab.
 */
export function renderReport(sim, { compact = false } = {}) {
  const md = h('div', { class: 'md' });
  md.innerHTML = markdownToHtml(sim.summary?.text ?? ''); // escapes everything first
  const meta = `${new Date(sim.at).toLocaleString()} · "${sim.title}" · ${sim.groupName} (${sim.avatars.length} viewers)${sim.summary ? ` · ${PROVIDERS[sim.summary.provider]?.label ?? sim.summary.provider}` : ''}`;
  if (compact) {
    const drops = sim.result.leaves.slice(0, 3);
    return h('div', { class: 'sim-report compact' },
      h('div', { class: 'muted small' }, meta),
      headline(sim),
      drops.length > 0 && h('p', { class: 'small' }, h('b', {}, 'Biggest drop-offs: '), drops.map((l) => {
        const b = sim.material.beats[l.i];
        return `${b.start != null ? clock(b.start) : `beat ${l.i + 1}`} “${b.first.slice(0, 60)}” (${pct(l.share)})`;
      }).join(' · ')),
      h('a', { class: 'button-link', href: `../lab/lab.html#sim=${sim.id}` }, 'Full report, every viewer and what to change →'));
  }
  return h('div', { class: 'sim-report' },
    h('div', { class: 'muted small' }, meta),
    headline(sim),
    sim.material.beats.length > 0 && h('section', { class: 'card' }, h('h3', {}, 'Through the video'), curveChart(sim), beatTable(sim),
      sim.material.outline && h('p', { class: 'muted small' }, 'Based on the outline: write the script for a sharper screening.')),
    h('section', { class: 'card' }, h('h3', {}, "The editor's notes"), md),
    h('section', { class: 'card' }, h('h3', {}, 'Every viewer'), h('div', { class: 'viewers' }, [...sim.avatars].sort((a, b) => b.weight - a.weight).map((a) => viewer(sim, a)))),
    h('details', { class: 'card' }, h('summary', {}, 'The raw results (as sent to the AI for the fixes)'), h('pre', { class: 'raw' }, sim.report)));
}

export const REPORT_CSS = `
.sim-report { display: grid; gap: 12px; }
.sim-report .chips { display: flex; gap: 5px; flex-wrap: wrap; }
.sim-report .chip { font-size: 11px; padding: 1px 8px; border-radius: 999px; background: var(--bg-2); color: var(--fg-2); }
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px; }
.tile { border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px; background: var(--bg); }
.tile .k { font-size: 12px; color: var(--fg-2); }
.tile .v { font-size: 26px; font-weight: 700; font-variant-numeric: tabular-nums; }
.tile .n { font-size: 11.5px; color: var(--fg-2); }
.sim-report .card h3 { margin: 0 0 8px; font-size: 15px; }
table.beats { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 8px; }
table.beats th, table.beats td { text-align: left; padding: 5px 8px; border-bottom: 1px solid var(--border); vertical-align: top; }
table.beats th { font-size: 12px; color: var(--fg-2); font-weight: 600; }
table.beats tr.drop td { background: color-mix(in srgb, var(--danger) 8%, transparent); }
table.beats td.first { max-width: 380px; }
.viewers { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 340px), 1fr)); gap: 10px; }
.viewer { border: 1px solid var(--border); border-radius: 12px; padding: 10px 12px; display: grid; gap: 6px; font-size: 13.5px; }
.viewer.click-no { opacity: 0.85; }
.v-top { display: flex; gap: 10px; align-items: center; }
.v-top svg { width: 40px; height: 40px; border-radius: 50%; flex: none; }
.v-out { font-size: 12.5px; margin-top: 2px; }
.v-q { margin: 0; font-style: italic; }
.v-line { margin: 0; }
.v-line .k { color: var(--fg-2); }
.chip.c-yes { color: var(--ok); }
.chip.c-maybe { color: var(--warn); }
.chip.c-no { color: var(--fg-2); }
.v-beats summary { cursor: pointer; font-size: 12.5px; color: var(--fg-2); }
.v-beats ol { margin: 6px 0 0; padding-left: 22px; display: grid; gap: 3px; font-size: 12.5px; }
pre.raw { white-space: pre-wrap; font-size: 12px; background: var(--bg-2); border-radius: 8px; padding: 10px; max-height: 420px; overflow: auto; }
`;
