// "Update from real data": gathers what real viewers did, asks the AI how the
// avatars should change, and lets the creator pick what to apply.

import { send, h } from '../lib/ui.js';
import { generate, evolvePrompt, PROVIDERS } from '../lib/ai.js';
import { audienceSheet } from '../lib/avatars.js';
import { avatarBrief } from '../lib/screening.js';
import { extractJsonObject } from '../lib/ask.js';
import { calibration as learnCalibration, comparisonText } from '../lib/accuracy.js';
import { cleanProposal, diffEdit, applyProposal } from '../lib/evolve.js';

// The review lessons, not the whole notes: personas and next-screening advice.
function lessonsOf(sim) {
  const t = sim.accuracyNotes?.text ?? '';
  const parts = t.split(/^##\s+/m).filter((p) => /^(Adjust these personas|For the next screening|What it missed|Comments: predicted vs real)/i.test(p));
  return (parts.length ? parts.join('\n') : t).trim().slice(0, 1500);
}

function calibrationText(cal) {
  if (!cal.n) return '';
  return [
    `${cal.n} published video${cal.n === 1 ? '' : 's'} checked.`,
    cal.watch && `Watch time: screenings were ${Math.abs(cal.watch.value)} points too ${cal.watch.value > 0 ? 'high (real viewers left sooner)' : 'low (real viewers stayed longer)'}.`,
    cal.hook && `The opening: screenings had ${Math.abs(cal.hook.value)} points ${cal.hook.value > 0 ? 'more' : 'fewer'} viewers staying past 0:30 than really did.`,
    cal.ctrRatio && `Real click-through was about ${cal.ctrRatio.value.toFixed(2)}× the share of personas who said they'd click.`,
  ].filter(Boolean).join(' ');
}

/**
 * Asks for an update. `sim`: one checked screening to focus on (from the
 * Forecast vs reality card), or null for everything. Returns the cleaned
 * proposal plus what it was based on.
 */
export async function proposeUpdate({ ai, group, sim = null, onProgress = () => {} }) {
  if (!group.avatars.length) throw new Error('This group has no avatars to update.');
  const auth = await send({ type: 'authStatus' }).catch(() => ({}));
  let sheet = '';
  if (auth.signedIn && group.source?.kind !== 'channel') {
    onProgress('Reading your audience from YouTube Analytics…');
    const [profile, ov] = await Promise.all([send({ type: 'myAudience', days: 90 }).catch(() => null), send({ type: 'myOverview', days: 90 }).catch(() => null)]);
    onProgress('Reading recent comments on your videos…');
    const comments = await send({ type: 'channelComments', channelId: auth.me.id }).catch(() => []);
    sheet = audienceSheet({ channel: { title: auth.me.title }, profile, comments, retention: ov?.current?.averageViewPercentage ?? null });
  } else if (group.source?.kind === 'channel') {
    onProgress('Reading the channel\'s recent comments…');
    const comments = await send({ type: 'channelComments', channelId: group.source.channelId }).catch(() => []);
    sheet = audienceSheet({ channel: { title: group.source.title }, comments });
  }
  const sims = (await send({ type: 'screenings' }).catch(() => [])).filter((s) => s.groupId === group.id && s.accuracy);
  const cal = learnCalibration(sims);
  const lessons = sims.filter((s) => s.accuracyNotes?.text).slice(0, 4).map((s) => `From "${s.projectTitle ?? s.title}":\n${lessonsOf(s)}`).join('\n\n');
  const video = sim?.accuracy ? `"${sim.projectTitle ?? sim.title}"\n${comparisonText(sim, sim.actual, sim.accuracy)}${sim.accuracyNotes?.text ? `\n\nThe review:\n${lessonsOf(sim)}` : ''}` : '';
  if (!sheet && !lessons && !video && !cal.n) throw new Error('There is no real data to learn from yet: sign in on My channel, or check a published video in its Forecast vs reality card.');
  onProgress(`Asking ${PROVIDERS[ai.provider].label} what the real data says about these avatars…`);
  const p = evolvePrompt({ avatars: group.avatars.map((a) => ({ brief: avatarBrief(a), weight: a.weight, locked: a.locked })), sheet, lessons, calibration: calibrationText(cal), video, niche: ai.niche });
  const proposal = cleanProposal(extractJsonObject(await generate({ ...ai, ...p })), group.avatars);
  proposal.basis = [sheet && 'current analytics and comments', cal.n && `${cal.n} checked video${cal.n === 1 ? '' : 's'}`, sim && `"${sim.projectTitle ?? sim.title}"`].filter(Boolean).join(', ');
  proposal.from = sim ? { simId: sim.id, title: sim.projectTitle ?? sim.title } : null;
  return proposal;
}

const LABELS = { lifeStage: 'situation', commentStyle: 'comments', basedOn: 'based on', turnoffs: 'clicks away when', moves: 'moved by' };
const pct = (x) => `${Math.round(x * 100)}%`;

/**
 * The review: every proposed change with a checkbox (changes to locked
 * avatars start unchecked). Resolves with the saved group, or null if closed.
 */
export function reviewUpdate(group, proposal) {
  const byId = Object.fromEntries(group.avatars.map((a) => [a.id, a]));
  const box = (checked) => h('input', { type: 'checkbox', checked });
  const rows = { edits: [], add: [], retire: [] };
  const item = (cb, title, reason, extra = null) => h('label', { class: 'ev-item' }, cb, h('div', {}, h('b', {}, title), extra, reason && h('div', { class: 'muted small' }, `Why: ${reason}`)));

  const edits = proposal.edits.map((e) => {
    const a = byId[e.id];
    const cb = box(!a.locked);
    rows.edits.push([e.id, cb]);
    return item(cb, `${a.name}${a.locked ? ' 🔒' : ''}`, e.reason,
      h('table', { class: 'ev-diff' }, diffEdit(a, e.patch).map((d) => h('tr', {}, h('th', {}, LABELS[d.field] ?? d.field), h('td', { class: 'before' }, d.before), h('td', {}, '→'), h('td', { class: 'after' }, d.after)))));
  });
  const adds = proposal.add.map((x, i) => {
    const cb = box(true);
    rows.add.push([i, cb]);
    const a = x.avatar;
    return item(cb, `New: ${a.name}`, x.reason, h('div', { class: 'small' }, [a.age, a.occupation, a.location].filter(Boolean).join(' · '), a.wants ? ` · wants ${a.wants}` : ''));
  });
  const retires = proposal.retire.map((r) => {
    const cb = box(!byId[r.id].locked);
    rows.retire.push([r.id, cb]);
    return item(cb, `Retire ${byId[r.id].name}${byId[r.id].locked ? ' 🔒' : ''}`, r.reason);
  });
  const wIds = Object.keys(proposal.weights);
  const wBox = box(wIds.length > 0);
  const weights = wIds.length ? item(wBox, 'New shares of viewers', '', h('div', { class: 'small' }, wIds.map((id) => `${byId[id].name} ${pct(byId[id].weight)} → ${pct(proposal.weights[id])}`).join(' · '), h('div', { class: 'muted' }, 'Rebalanced to add up to 100%.'))) : null;

  const nothing = !edits.length && !adds.length && !retires.length && !weights;
  const dlg = h('dialog', { class: 'edit ev' });
  document.body.append(dlg);
  return new Promise((resolve) => {
    const close = (v) => {
      dlg.close();
      dlg.remove();
      resolve(v);
    };
    const apply = h('button', { class: 'primary', disabled: nothing }, 'Apply the checked changes');
    apply.addEventListener('click', async () => {
      const pick = (list) => new Set(list.filter(([, cb]) => cb.checked).map(([k]) => k));
      const accept = { edits: pick(rows.edits), add: pick(rows.add), retire: pick(rows.retire), weights: wBox.checked };
      const { avatars, revision } = applyProposal(group.avatars, proposal, accept);
      apply.disabled = true;
      try {
        close(await send({ type: 'avatarGroupSave', group: { ...group, avatars, revision: { ...revision, basis: proposal.basis, from: proposal.from } } }));
      } catch (err) {
        apply.disabled = false;
        alert(err.message);
      }
    });
    const section = (title, list) => (list.length ? [h('h3', {}, title), ...list] : []);
    dlg.replaceChildren(h('div', { class: 'ev-body' },
      h('h2', {}, `Update "${group.name}" from real data`),
      h('p', { class: 'muted small' }, `Based on ${proposal.basis || 'your data'}. Check what to apply; nothing changes until you do. Locked avatars start unchecked.`),
      proposal.summary && h('p', {}, proposal.summary),
      nothing ? h('p', {}, 'No changes proposed: these avatars already match the real data.') : null,
      ...section('Changes', edits), ...section('New avatars', adds), ...section('Retire', retires), ...(weights ? [h('h3', {}, 'Shares'), weights] : []),
      h('div', { class: 'acts' }, h('button', { onclick: () => close(null) }, nothing ? 'Close' : 'Cancel'), nothing ? null : apply)));
    dlg.addEventListener('cancel', (e) => {
      e.preventDefault();
      close(null);
    });
    dlg.showModal();
  });
}

export const EVOLVE_CSS = `
dialog.ev { width: min(760px, calc(100vw - 32px)); max-height: calc(100vh - 48px); border: 1px solid var(--border); border-radius: 14px; background: var(--bg); color: var(--fg); padding: 0; }
dialog.ev::backdrop { background: rgba(0, 0, 0, 0.4); }
.ev-body { padding: 18px 20px; display: flex; flex-direction: column; gap: 8px; }
.ev-body h2 { margin: 0; font-size: 18px; }
.ev-body h3 { margin: 10px 0 0; font-size: 14px; }
.ev-item { display: flex; gap: 10px; align-items: flex-start; padding: 8px 10px; border: 1px solid var(--border); border-radius: 10px; cursor: pointer; }
.ev-item input { margin-top: 3px; }
.ev-diff { border-collapse: collapse; margin: 4px 0; font-size: 13px; }
.ev-diff th { text-align: left; font-weight: 600; padding: 2px 8px 2px 0; vertical-align: top; white-space: nowrap; opacity: 0.7; }
.ev-diff td { padding: 2px 6px 2px 0; vertical-align: top; }
.ev-diff .before { text-decoration: line-through; opacity: 0.6; }
.ev-body .acts { display: flex; gap: 8px; justify-content: flex-end; margin-top: 8px; }
.revs { margin-top: 6px; }
.revs li { margin: 2px 0; }
`;
