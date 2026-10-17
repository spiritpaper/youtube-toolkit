// The "Ask your audience" panel: pitch ideas to a group, then follow up in a
// chat. Used on a project (ideas start from its title and angle) and in the
// Audience lab (ideas without a project yet).

import { send, h } from '../lib/ui.js';
import { activeAi } from '../lib/ai.js';
import { parsePitches } from '../lib/ask.js';
import { runPitch, askChat } from './ask-run.js';
import { renderPitch, renderChat, ASK_CSS } from './ask-view.js';
import { REPORT_CSS } from './report.js';

let styled = false;

/** project: optional; returns an element that keeps itself up to date. */
export function askPanel({ project = null } = {}) {
  if (!styled) {
    document.head.append(h('style', {}, REPORT_CSS + ASK_CSS));
    styled = true;
  }
  const root = h('div', { class: 'ask-panel' });
  let chatId = null; // the conversation shown

  async function draw(status = null) {
    const [groups, sims, fresh] = await Promise.all([
      send({ type: 'avatarGroups' }).catch(() => ({})),
      send({ type: 'screenings', projectId: project?.id ?? undefined }).catch(() => []),
      project ? send({ type: 'projects' }).then((all) => all[project.id] ?? project).catch(() => project) : null,
    ]);
    if (fresh) project = fresh;
    const list = Object.values(groups).filter((g) => g.avatars.length);
    if (!list.length) {
      root.replaceChildren(h('p', { class: 'muted' }, 'Pitch ideas to your audience before you write anything. ', h('a', { href: '../lab/lab.html' }, 'Build your audience in the Audience lab first →')));
      return;
    }
    const mine = sims.filter((s) => (project ? s.projectId === project.id : !s.projectId));
    const pitch = mine.find((s) => s.kind === 'pitch');
    const chats = mine.filter((s) => s.kind === 'chat');
    const chat = chatId ? chats.find((c) => c.id === chatId) ?? null : chats[0] ?? null;

    // ----- pitch -----
    const groupSel = h('select', { 'aria-label': 'Audience group' }, list.map((g) => h('option', { value: g.id, selected: chat?.groupId === g.id }, `${g.name} (${g.avatars.length})`)));
    const seed = project ? [project.title, ...(project.titles ?? [])].filter(Boolean).slice(0, 4).join('\n') : '';
    const pitches = h('textarea', { placeholder: 'One idea per line (up to 4), e.g.\nI tried to build a game in 7 days with no experience\nWhy I switched from Unity to Godot after 3 years', 'aria-label': 'Ideas to pitch', value: seed });
    const pitchBtn = h('button', { class: 'primary' }, 'Ask (1 AI call)');
    const busy = async (btn, fn) => {
      const ai = await activeAi();
      if (!ai) return draw(h('p', { class: 'muted' }, 'This uses AI. Connect a provider in ', h('a', { href: '../options/options.html' }, 'Settings'), '.'));
      btn.disabled = true;
      const old = btn.textContent;
      btn.textContent = 'Asking…';
      try {
        await fn(ai);
        draw();
      } catch (err) {
        btn.disabled = false;
        btn.textContent = old;
        if (!err.cancelled) draw(h('p', { class: 'error' }, err.message));
      }
    };
    pitchBtn.addEventListener('click', () => busy(pitchBtn, (ai) => runPitch({ ai, group: groups[groupSel.value], pitches: parsePitches(pitches.value), project })));

    // ----- chat -----
    const chatGroup = chat ? groups[chat.groupId] ?? { id: chat.groupId, name: chat.groupName, avatars: chat.avatars } : null;
    const people = chat?.avatars ?? groups[groupSel.value]?.avatars ?? [];
    const toSel = h('select', { 'aria-label': 'Who to ask' }, h('option', { value: 'all' }, 'Everyone'), people.map((a) => h('option', { value: a.id }, a.name)));
    groupSel.addEventListener('change', () => {
      if (chat) return; // a running conversation keeps its group
      toSel.replaceChildren(h('option', { value: 'all' }, 'Everyone'), ...(groups[groupSel.value]?.avatars ?? []).map((a) => h('option', { value: a.id }, a.name)));
    });
    const question = h('input', { type: 'text', placeholder: chat ? 'Ask a follow-up…' : 'Ask your audience anything, e.g. "Would you watch 25 minutes of this?"', 'aria-label': 'Your question' });
    const askBtn = h('button', { class: 'primary' }, 'Send');
    const submit = () => busy(askBtn, async (ai) => {
      const saved = await askChat({ ai, group: chatGroup ?? groups[groupSel.value], chat, to: toSel.value, question: question.value, project });
      chatId = saved.id;
    });
    askBtn.addEventListener('click', submit);
    question.addEventListener('keydown', (e) => e.key === 'Enter' && submit());

    root.replaceChildren(...[
      h('div', { class: 'ask-form' },
        h('div', { class: 'ask-row' }, h('b', {}, 'Pitch ideas'), groupSel, h('span', { class: 'muted small' }, 'Who\'d watch each idea, what they\'d expect, what they\'d rather see.')),
        pitches,
        h('div', { class: 'ask-row' }, pitchBtn)),
      status,
      pitch && h('div', { class: 'screen-latest' }, h('h3', {}, 'Latest pitch'), renderPitch(pitch, { compact: true })),
      h('div', { class: 'ask-chat' },
        h('h3', {}, chat ? `Conversation with ${chat.groupName}` : 'Ask a question'),
        chat && renderChat(chat),
        h('div', { class: 'ask-row' }, toSel, question, askBtn,
          chat && h('button', { onclick: () => { chatId = '__new__'; draw(); } }, 'New conversation')),
        h('p', { class: 'muted small' }, 'Everyone: viewers who\'d actually have something to say answer, in their own voice. 1 AI call per message.'),
        chats.length > 1 && h('details', {}, h('summary', { class: 'small' }, `Earlier conversations (${chats.length - 1})`),
          h('ul', { class: 'small' }, chats.filter((c) => c !== chat).map((c) => h('li', {}, h('button', { class: 'link', onclick: () => { chatId = c.id; draw(); } }, `${new Date(c.updatedAt ?? c.at).toLocaleDateString()} · ${c.title}`), ` · ${c.groupName}`))))),
    ].filter(Boolean));
    if (chatId === '__new__') chatId = null;
    root.querySelector('.chat')?.scrollTo({ top: 1e6 });
  }
  draw();
  return root;
}
