// Shows pitch tests and chats, and the chat box.

import { h } from '../lib/ui.js';
import { markdownToHtml } from '../lib/markdown.js';
import { face } from './face.js';

const pct = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`);
const INTEREST = { yes: 'Would watch', maybe: 'Maybe', no: 'Not for me' };

export function renderPitch(sim, { compact = false } = {}) {
  const name = Object.fromEntries(sim.avatars.map((a) => [a.id, a.name]));
  const sc = sim.scored;
  const ranked = [...sc.pitches].sort((a, b) => b.interest - a.interest);
  const table = h('table', { class: 'beats pitches' },
    h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', {}, 'Idea'), h('th', {}, 'Would watch'), h('th', {}, 'Who\'s in'), h('th', {}, 'Wins over'))),
    h('tbody', {}, ranked.map((p) => h('tr', { class: p.i === sc.best && !sc.close ? 'win' : '' },
      h('td', {}, p.i === sc.best ? '★' : ''),
      h('td', { class: 'first' }, p.pitch),
      h('td', {}, pct(p.interest), h('span', { class: 'muted small' }, ` · ${p.yes.length + p.maybe.length} of ${sim.avatars.length}`)),
      h('td', {}, [...p.yes.map((id) => name[id]), ...p.maybe.map((id) => `${name[id]} (maybe)`)].join(', ') || '—'),
      h('td', {}, p.winsOver.map((id) => name[id]).join(', ') || '—')))));
  const meta = h('div', { class: 'muted small' }, `${new Date(sim.at).toLocaleString()} · ${sim.groupName} (${sim.avatars.length} viewers)`);
  const close = sc.close && h('p', { class: 'small' }, h('b', {}, 'Too close to call: '), 'the top ideas are within 5 points. Look at who each one wins over.');
  const takeaways = sim.takeaways && (() => {
    const d = h('div', { class: 'md' });
    d.innerHTML = markdownToHtml(sim.takeaways); // escapes everything first
    return d;
  })();
  if (compact) {
    return h('div', { class: 'sim-report compact' }, meta, table, close, takeaways,
      h('a', { class: 'button-link', href: `../lab/lab.html#sim=${sim.id}` }, 'Every viewer\'s answer →'));
  }
  const viewers = h('div', { class: 'viewers' }, [...sim.avatars].sort((a, b) => b.weight - a.weight).map((a) =>
    h('article', { class: 'viewer' },
      h('div', { class: 'v-top' }, face(a), h('div', {}, h('b', {}, a.name), h('span', { class: 'muted small' }, ` · ${[a.age, a.occupation].filter(Boolean).join(', ')} · ${pct(a.weight)} of viewers`))),
      sim.pitches.map((p, i) => {
        const ans = sim.viewers[a.id]?.answers[i];
        if (!ans) return null;
        return h('div', { class: 'v-pitch' },
          h('p', { class: 'v-line' }, h('span', { class: `chip c-${ans.interest === 'yes' ? 'yes' : ans.interest === 'maybe' ? 'maybe' : 'no'}` }, `${i + 1} · ${INTEREST[ans.interest]}`), ans.why ? ` “${ans.why}”` : ''),
          ans.expect && h('p', { class: 'v-line small' }, h('span', { class: 'k' }, 'Expects: '), ans.expect),
          ans.instead && h('p', { class: 'v-line small' }, h('span', { class: 'k' }, 'Would rather: '), ans.instead));
      }))));
  return h('div', { class: 'sim-report' }, meta,
    h('section', { class: 'card' }, h('h3', {}, 'Which idea pulls'), table, close, h('p', { class: 'muted small' }, 'Weighted by each viewer\'s share of the audience; "maybe" counts half. "Wins over": viewers who\'d watch this idea but not every other one.')),
    takeaways && h('section', { class: 'card' }, h('h3', {}, 'Takeaways'), takeaways),
    h('section', { class: 'card' }, h('h3', {}, 'Every viewer'), viewers));
}

/** The conversation, newest at the bottom. */
export function renderChat(sim) {
  const byId = Object.fromEntries(sim.avatars.map((a) => [a.id, a]));
  return h('div', { class: 'chat' }, (sim.messages ?? []).map((m) => {
    if (m.from === 'you') {
      return h('div', { class: 'msg me' }, h('div', { class: 'bubble' }, m.to && m.to !== 'all' ? h('span', { class: 'muted small' }, `To ${byId[m.to]?.name ?? 'a viewer'}: `) : '', m.text));
    }
    const a = byId[m.from];
    return h('div', { class: 'msg them' }, a ? face(a) : '', h('div', { class: 'bubble' }, h('b', { class: 'who' }, a?.name ?? 'Viewer'), h('div', {}, m.text)));
  }));
}

export const ASK_CSS = `
table.pitches tr.win td { background: color-mix(in srgb, var(--ok) 10%, transparent); font-weight: 600; }
.v-pitch { border-top: 1px dashed var(--border); padding-top: 6px; display: grid; gap: 3px; }
.chat { display: grid; gap: 10px; max-height: 520px; overflow: auto; padding: 4px 2px; }
.msg { display: flex; gap: 8px; align-items: flex-end; }
.msg.me { justify-content: flex-end; }
.msg svg { width: 30px; height: 30px; border-radius: 50%; flex: none; }
.bubble { max-width: 75%; padding: 8px 12px; border-radius: 14px; font-size: 14px; line-height: 1.45; background: var(--bg-2); }
.msg.me .bubble { background: var(--accent); color: #fff; border-bottom-right-radius: 4px; }
.msg.me .bubble .muted { color: rgba(255, 255, 255, 0.8); }
.msg.them .bubble { border-bottom-left-radius: 4px; }
.bubble .who { display: block; font-size: 12px; margin-bottom: 2px; }
.ask-form { display: grid; gap: 8px; }
.ask-chat h3, .ask-panel .screen-latest h3 { margin: 18px 0 8px; font-size: 14px; }
.ask-form textarea { width: 100%; min-height: 70px; resize: vertical; font: inherit; }
.ask-row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.ask-row input[type='text'] { flex: 1; min-width: 220px; }
`;
