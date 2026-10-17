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
  const c = r.counts ?? {};
  const of = (n, d) => `${n} of ${d} viewer${d === 1 ? '' : 's'}`;
  // With very few viewers behind a number, say so instead of a confident %.
  const few = (n) => n < 3;
  // With two runs, how far apart they were: a measure of how steady a number is.
  const spread = (k) => (r.spread?.[k] != null ? `±${Math.round((r.spread[k] * 100) / 2)} pts between runs` : '');
  return h('div', { class: 'tiles' },
    tile('Would click', pct(r.clickShare), [b?.ctr != null ? `your real click rate: ${b.ctr.toFixed(1)}% of impressions` : of(c.clicked ?? 0, c.avatars ?? 0), spread('clickShare')].filter(Boolean).join(' · '), 'Weighted by each viewer\'s share of the audience; "maybe" counts half. People shown a video in a real feed click far less often, so compare titles and versions, not this number with YouTube\'s.'),
    tile('Stay past the hook', pct(r.hookHold), sim.material?.hook ? [of(c.stayed ?? 0, c.clicked ?? 0), spread('hookHold')].filter(Boolean).join(' · ') : 'no script yet'),
    tile('Watch on average', pct(r.watchedShare), [b?.avgViewed != null ? `your real average: ${Math.round(b.avgViewed)}%` : 'estimated, of those who click', spread('watchedShare')].filter(Boolean).join(' · '), b?.bySub?.subscribed != null || b?.bySub?.unsubscribed != null ? 'Each viewer was anchored to your channel\'s real watch time for subscribers and non-subscribers.' : 'Each viewer was anchored to typical YouTube watch times (sign in on My channel to use your own).'),
    tile('Reach the end', pct(r.finishShare), `${of(c.finished ?? 0, c.clicked ?? 0)}${r.score != null ? ` · ${r.score.toFixed(1)}/10` : ''}`),
    r.score != null && tile('Would subscribe', few(c.finished) ? `${Math.round(r.subscribe * c.finished)} of ${c.finished}` : pct(r.subscribe), few(c.finished) ? 'too few finished to give a %' : `of those who finish · like ${pct(r.like)}`, 'Among those who reach the end'));
}

// ---------- forecast vs reality ----------

const VERDICT = { close: 'Close', fair: 'Roughly right', off: 'Off' };
const signed = (x) => (x == null ? '' : `${Math.round(x) > 0 ? '+' : ''}${Math.round(x)} pts`);

/** The calibrated estimates under the headline, when past videos have been checked. */
function calibratedLine(sim) {
  const c = sim.calibrated;
  if (!c) return null;
  const parts = [
    c.ctr != null && `≈ ${c.ctr.toFixed(1)}% click-through on your channel`,
    c.hookHold != null && `${pct(c.hookHold)} past the opening`,
    c.watched != null && `${pct(c.watched)} watched on average`,
  ].filter(Boolean);
  return parts.length
    ? h('p', { class: 'calibrated small' }, h('b', {}, 'Corrected with past results: '), parts.join(' · '), h('span', { class: 'muted' }, ` (learned from ${c.n} published video${c.n === 1 ? '' : 's'} with this audience)`))
    : null;
}

/** Forecast vs reality for a checked screening. */
export function renderAccuracy(sim, { title = 'Forecast vs reality' } = {}) {
  const a = sim.accuracy;
  const act = sim.actual;
  if (!a || !act) return null;
  const r = sim.result;
  const row = (label, forecast, real, diff) => h('tr', {}, h('td', {}, label), h('td', {}, forecast), h('td', {}, real), h('td', { class: diff && Math.abs(parseFloat(diff)) > 10 ? 'off' : '' }, diff || '—'));
  const table = h('table', { class: 'beats acc' },
    h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', {}, 'Forecast'), h('th', {}, 'Real'), h('th', {}, 'Difference'))),
    h('tbody', {},
      row('Watch on average', pct(r.watchedShare), act.avgViewed == null ? '—' : `${Math.round(act.avgViewed)}%`, signed(a.watchErr)),
      row('Still watching at 0:30', pct(r.hookHold), act.hold30 == null ? '—' : pct(act.hold30), signed(a.hookErr)),
      row('Would click → click-through', `${pct(r.clickShare)} of this audience`, act.ctr == null ? '—' : `${act.ctr.toFixed(1)}% of impressions`, a.ctrRatio != null ? 'used to calibrate' : ''),
      a.curveErr != null && row('Retention curve', '', '', `${Math.round(a.curveErr)} pts off on average`),
      a.dropMatch != null && row('Biggest drop-off', '', '', a.dropMatch ? 'found the real one' : 'in a different place')));
  const chart = a.curve.length >= 2 ? lineChart({
    label: 'Forecast vs real retention',
    height: 160,
    series: [
      { name: 'Forecast: still watching', color: 'var(--series-1)', points: a.curve.map((p) => ({ x: p.at * 100, y: p.predicted * 100 })) },
      { name: 'Real: still watching', color: 'var(--series-3)', points: a.curve.map((p) => ({ x: p.at * 100, y: p.real * 100 })) },
    ],
    xFormat: (x) => `${Math.round(x)}%`,
    yFormat: (y) => `${Math.round(y)}%`,
    yMax: 100,
  }) : null;
  const notes = sim.accuracyNotes?.text ? (() => {
    const d = h('div', { class: 'md' });
    d.innerHTML = markdownToHtml(sim.accuracyNotes.text); // escapes everything first
    return d;
  })() : null;
  return h('section', { class: 'card accuracy' },
    h('h3', {}, title, a.verdict && h('span', { class: `verdict v-${a.verdict}` }, VERDICT[a.verdict])),
    h('p', { class: 'muted small' }, `Checked ${new Date(act.at).toLocaleString()}${act.views != null ? ` · ${Math.round(act.views).toLocaleString()} views` : ''}${act.signedIn === false ? ' · not signed in: only comments and views can be compared' : ''}`),
    table,
    chart,
    notes && h('details', { open: true }, h('summary', {}, 'What the screening got right and wrong'), notes));
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
  const meta = `${new Date(sim.at).toLocaleString()} · "${sim.title}" · ${sim.groupName} (${sim.avatars.length} viewers)${sim.thumbnail ? ' · with thumbnail' : ''}${sim.result?.passes > 1 ? ` · ${sim.result.passes} runs combined` : ''}${sim.summary ? ` · ${PROVIDERS[sim.summary.provider]?.label ?? sim.summary.provider}` : ''}`;
  if (sim.kind === 'titles') return renderTitleTest(sim, { compact, meta });
  if (compact) {
    const drops = sim.result.leaves.slice(0, 3);
    return h('div', { class: 'sim-report compact' },
      h('div', { class: 'muted small' }, meta),
      headline(sim),
      calibratedLine(sim),
      drops.length > 0 && h('p', { class: 'small' }, h('b', {}, 'Biggest drop-offs: '), drops.map((l) => {
        const b = sim.material.beats[l.i];
        return `${b.start != null ? clock(b.start) : `beat ${l.i + 1}`} “${b.first.slice(0, 60)}” (${pct(l.share)})`;
      }).join(' · ')),
      h('a', { class: 'button-link', href: `../lab/lab.html#sim=${sim.id}` }, 'Full report, every viewer and what to change →'));
  }
  return h('div', { class: 'sim-report' },
    h('div', { class: 'muted small' }, meta),
    headline(sim),
    calibratedLine(sim),
    renderAccuracy(sim),
    sim.material.beats.length > 0 && h('section', { class: 'card' }, h('h3', {}, 'Through the video'), curveChart(sim), beatTable(sim),
      sim.material.outline && h('p', { class: 'muted small' }, 'Based on the outline: write the script for a sharper screening.')),
    h('section', { class: 'card' }, h('h3', {}, "The editor's notes"), md),
    h('section', { class: 'card' }, h('h3', {}, 'Every viewer'), h('div', { class: 'viewers' }, [...sim.avatars].sort((a, b) => b.weight - a.weight).map((a) => viewer(sim, a)))),
    h('details', { class: 'card' }, h('summary', {}, 'The raw results (as sent to the AI for the fixes)'), h('pre', { class: 'raw' }, sim.report)));
}

// ---------- title A/B ----------

function renderTitleTest(sim, { compact, meta }) {
  const sc = sim.scored;
  const name = Object.fromEntries(sim.avatars.map((a) => [a.id, a]));
  const ranked = [...sc.titles].sort((a, b) => b.clickShare - a.clickShare);
  const table = h('table', { class: 'beats titles-ab' },
    h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', {}, 'Title'), h('th', {}, 'Would click'), h('th', {}, 'Favorite of'), h('th', {}, 'Wins over'))),
    h('tbody', {}, ranked.map((t) => h('tr', { class: t.letter === sc.winner ? 'win' : '' },
      h('td', {}, t.letter === sc.winner ? '★' : ''),
      h('td', { class: 'first' }, t.title),
      h('td', {}, pct(t.clickShare), h('span', { class: 'muted small' }, ` · ${t.yes.length + t.maybe.length} of ${sim.avatars.length}`)),
      h('td', {}, t.favorites.length ? `${t.favorites.map((id) => name[id]?.name).join(', ')} (${pct(t.favoriteShare)})` : '—'),
      h('td', {}, t.winsOver.map((id) => name[id]?.name).join(', ') || '—')))));
  const note = sc.close ? h('p', { class: 'small' }, h('b', {}, 'Too close to call: '), 'the top titles are within 5 points. Run it again, or pick by who each one wins over.') : null;
  if (compact) {
    return h('div', { class: 'sim-report compact' }, h('div', { class: 'muted small' }, meta), table, note,
      h('a', { class: 'button-link', href: `../lab/lab.html#sim=${sim.id}` }, 'Every viewer\'s reaction to each title →'));
  }
  const viewers = h('div', { class: 'viewers' }, [...sim.avatars].sort((a, b) => b.weight - a.weight).map((a) => {
    const v = sim.votes[a.id];
    return h('article', { class: 'viewer' },
      h('div', { class: 'v-top' }, face(a), h('div', {}, h('b', {}, a.name), h('span', { class: 'muted small' }, ` · ${[a.age, a.occupation].filter(Boolean).join(', ')} · ${pct(a.weight)} of viewers`))),
      sim.titles.map((t, i) => {
        const vote = v?.votes?.[i];
        return h('p', { class: 'v-line' }, h('span', { class: `chip c-${vote?.click ?? 'no'}` }, `${'ABCD'[i]} · ${CLICK[vote?.click ?? 'no']}`), v?.favorite === i ? ' ★' : '', vote?.thought ? ` “${vote.thought}”` : '');
      }));
  }));
  return h('div', { class: 'sim-report' }, h('div', { class: 'muted small' }, meta),
    h('section', { class: 'card' }, h('h3', {}, 'Which title they\'d click'), table, note,
      h('p', { class: 'muted small' }, 'Each viewer judged every title on its own, in a random order; "maybe" counts half. "Wins over": viewers who\'d click this title but not every other one.')),
    h('section', { class: 'card' }, h('h3', {}, 'Every viewer'), viewers));
}

// ---------- what to expect ----------

/** A short, honest guide to reading screenings, shown wherever they're run. */
export function expectations() {
  return h('details', { class: 'expect' },
    h('summary', {}, 'What to expect from test screenings'),
    h('ul', {},
      h('li', {}, h('b', {}, 'Best for comparing. '), 'Two titles, or a script before and after a rewrite, tested on the same audience. Also for finding where viewers drift and why: their own words point at the line.'),
      h('li', {}, h('b', {}, 'Estimates, not view counts. '), 'Simulated viewers can\'t know how far YouTube will push a video. The numbers say how this audience reacts, not how many people will see it.'),
      h('li', {}, h('b', {}, 'Small groups vary. '), 'With 6–8 viewers, one person can move a number a lot, so every number shows how many viewers it rests on. Run twice and combine for steadier numbers, or test the same thing again before deciding on a close call.'),
      h('li', {}, h('b', {}, 'Kept realistic on purpose. '), 'Each viewer is anchored to how long people like them really watch (your channel\'s own numbers when you\'re signed in), and reacts honestly: boredom and doubt are data, not failure.'),
      h('li', {}, h('b', {}, 'It gets better the more you use it. '), 'Every screening is saved. Once a video is published, the lab compares its forecast with what really happened and uses those misses to correct the next screenings. Locking the avatars that ring true, and building the group from your own analytics, sharpens it too.')));
}

export const REPORT_CSS = `
.expect { font-size: 13px; }
.calibrated { margin: 0; }
.accuracy h3 { display: flex; gap: 10px; align-items: center; }
.verdict { font-size: 12px; font-weight: 600; padding: 1px 9px; border-radius: 999px; background: var(--bg-2); }
.verdict.v-close { color: var(--ok); }
.verdict.v-fair { color: var(--warn); }
.verdict.v-off { color: var(--danger); }
table.acc td.off { color: var(--danger); }
.screen-form { display: flex; gap: 8px 12px; flex-wrap: wrap; align-items: center; margin: 6px 0; }
.screen-form label { display: inline-flex; gap: 5px; align-items: center; }
.screen-latest h3 { font-size: 14px; margin: 12px 0 6px; }
.sim-report > a.button-link { justify-self: start; }
.expect summary { cursor: pointer; color: var(--fg-2); }
.expect ul { margin: 8px 0 0; padding-left: 20px; display: grid; gap: 6px; }
table.titles-ab tr.win td { background: color-mix(in srgb, var(--ok) 10%, transparent); font-weight: 600; }
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
