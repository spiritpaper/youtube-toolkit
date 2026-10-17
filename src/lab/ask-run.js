// Runs "Ask your audience": pitch tests and follow-up chats with a group.

import { send } from '../lib/ui.js';
import { generate, pitchPrompt, audienceChatPrompt } from '../lib/ai.js';
import { avatarBrief, extractJsonArray } from '../lib/screening.js';
import { extractJsonObject, cleanPitch, scorePitches, cleanReplies, historyText } from '../lib/ask.js';

/** What the creator has so far, from a project (or ''). */
export const projectContext = (project) =>
  project ? [project.title && `Working title: "${project.title}".`, project.angle && `Angle: ${project.angle}`].filter(Boolean).join(' ') : '';

/** Pitches up to 4 ideas to a group. One AI call. Returns the saved pitch test. */
export async function runPitch({ ai, group, pitches, project = null }) {
  const avatars = group.avatars;
  if (!avatars.length) throw new Error('This audience group has no avatars yet.');
  if (!pitches.length) throw new Error('Write at least one idea, one per line.');
  const p = pitchPrompt({ avatars: avatars.map(avatarBrief), pitches, context: projectContext(project), niche: ai.niche });
  const { viewers, takeaways } = cleanPitch(extractJsonObject(await generate({ ...ai, ...p })), avatars, pitches.length);
  return send({
    type: 'screeningSave',
    sim: {
      kind: 'pitch',
      projectId: project?.id ?? null,
      projectTitle: project?.title ?? pitches[0],
      groupId: group.id,
      groupName: group.name,
      title: pitches.length === 1 ? pitches[0] : `${pitches.length} ideas`,
      avatars,
      pitches,
      viewers,
      scored: scorePitches(avatars, viewers, pitches),
      takeaways,
      summary: { provider: ai.provider, model: ai.model },
    },
  });
}

/**
 * Sends a question to the group (to: 'all') or one avatar (to: its id), in
 * the chat `chat` (or a new one). One AI call. Returns the saved chat.
 */
export async function askChat({ ai, group, chat = null, to = 'all', question, project = null }) {
  const q = String(question ?? '').trim().slice(0, 1000);
  if (!q) throw new Error('Type a question first.');
  const avatars = chat?.avatars ?? group.avatars;
  const who = to === 'all' ? avatars : avatars.filter((a) => a.id === to);
  if (!who.length) throw new Error('That viewer is no longer in this conversation.');
  const names = Object.fromEntries(avatars.map((a) => [a.id, a.name]));
  const messages = [...(chat?.messages ?? [])];
  const p = audienceChatPrompt({ avatars: who.map(avatarBrief), question: q, history: historyText(messages, names), context: projectContext(project), single: who.length === 1, niche: ai.niche });
  const replies = cleanReplies(extractJsonArray(await generate({ ...ai, ...p })), who);
  const now = Date.now();
  messages.push({ from: 'you', to, text: q, at: now }, ...replies.map((r, i) => ({ from: r.id, text: r.reply, at: now + i + 1 })));
  return send({
    type: 'screeningSave',
    sim: {
      ...(chat ?? {}),
      kind: 'chat',
      id: chat?.id,
      at: chat?.at,
      updatedAt: now,
      projectId: project?.id ?? chat?.projectId ?? null,
      projectTitle: project?.title ?? chat?.projectTitle ?? q.slice(0, 80),
      groupId: group?.id ?? chat?.groupId,
      groupName: group?.name ?? chat?.groupName,
      title: chat?.title ?? q.slice(0, 80),
      avatars,
      messages,
      summary: { provider: ai.provider, model: ai.model },
    },
  });
}
