// Quick search (Ctrl+K) across everything you've saved: projects, saved
// outliers, followed channels, your notes, lessons, experiments, rabbit
// holes and video webs.

export const KINDS = {
  project: 'Projects',
  idea: 'Saved outliers',
  channel: 'Following',
  note: 'Your notes',
  lesson: 'Lessons & experiments',
  hole: 'Rabbit holes',
  web: 'Video webs',
  page: 'Pages',
};

const fold = (s) =>
  String(s ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '');

/**
 * Turns stored data into searchable items { kind, title, sub, href, text }.
 * `href`s are relative to src/. `data` holds the storage keys (ideas,
 * projects, watchlist, explore:index, sn:*, vw:*) plus `pages` (NAV items).
 */
export function buildIndex(data) {
  const items = [];
  for (const p of Object.values(data.projects ?? {})) {
    items.push({
      kind: 'project',
      title: p.title,
      sub: [p.archivedAt ? 'archived' : p.status, p.angle].filter(Boolean).join(' · '),
      href: `project/project.html?id=${p.id}`,
      text: [p.title, p.angle, p.notes, ...(p.titles ?? []), p.outline?.slice(0, 2000)].join(' '),
      t: p.updatedAt ?? 0,
    });
  }
  for (const i of Object.values(data.ideas ?? {})) {
    items.push({
      kind: 'idea',
      title: i.title,
      sub: [i.channelTitle, ...(i.tags ?? []).map((t) => `#${t}`)].filter(Boolean).join(' · '),
      href: `ideas/ideas.html?q=${encodeURIComponent(i.id)}`,
      text: [i.title, i.channelTitle, i.notes, ...(i.tags ?? [])].join(' '),
      t: i.savedAt ?? 0,
    });
  }
  for (const c of Object.values(data.watchlist ?? {})) {
    items.push({
      kind: 'channel',
      title: c.title ?? c.id,
      sub: [c.handle, c.role === 'competitor' ? 'competitor' : 'learn from'].filter(Boolean).join(' · '),
      href: `channels/channels.html#ch-${c.id}`,
      text: [c.title, c.handle, c.notes].join(' '),
      t: c.addedAt ?? 0,
    });
  }
  for (const [k, e] of Object.entries(data)) {
    if (k.startsWith('sn:') && e?.notes?.length) {
      const analyzed = data.analyzed?.has?.(e.videoId);
      for (const n of e.notes) {
        items.push({
          kind: 'note',
          title: n.text.split('\n')[0].slice(0, 120),
          sub: `${e.title || e.videoId} · ${fmt(n.t)}`,
          href: analyzed ? `script/script.html?id=${e.videoId}#notes` : `https://www.youtube.com/watch?v=${e.videoId}&t=${n.t}s`,
          text: [n.text, e.title].join(' '),
          t: n.updatedAt ?? n.createdAt ?? 0,
        });
      }
    }
    if (k.startsWith('vw:') && e?.seed) {
      const seed = e.nodes?.[e.seed] ?? e.nodes?.find?.((n) => n.id === e.seed);
      const title = seed?.title ?? e.title ?? e.seed;
      items.push({ kind: 'web', title, sub: 'video web', href: `web/web.html?v=${e.seed}`, text: title, t: e.at ?? 0 });
    }
  }
  for (const n of Object.values(data['explore:index'] ?? {})) {
    items.push({
      kind: 'hole',
      title: n.keyword,
      sub: n.parentId ? 'keyword in a rabbit hole' : 'rabbit hole',
      href: `explore/explore.html?node=${n.id}`,
      text: n.keyword,
      t: n.updatedAt ?? 0,
    });
  }
  for (const l of Object.values(data.notebook?.lessons ?? {})) {
    items.push({ kind: 'lesson', title: l.text.split('\n')[0].slice(0, 120), sub: 'lesson', href: 'notebook/notebook.html#lessons', text: l.text, t: l.updatedAt ?? 0 });
  }
  for (const x of Object.values(data.notebook?.experiments ?? {})) {
    items.push({ kind: 'lesson', title: x.hypothesis, sub: 'experiment', href: `notebook/notebook.html#x=${x.id}`, text: [x.hypothesis, x.change, x.conclusion].join(' '), t: x.updatedAt ?? 0 });
  }
  for (const p of data.pages ?? []) items.push({ kind: 'page', title: p.label, sub: 'page', href: p.href, text: p.label, t: 0 });
  return items;
}

const fmt = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

/**
 * Items matching every word of `query`, best first: title matches beat body
 * matches, word starts beat substrings, recent beats old. At most `limit`.
 */
export function search(items, query, limit = 30) {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const scored = [];
  for (const it of items) {
    const title = fold(it.title);
    const body = fold(`${it.title} ${it.sub} ${it.text}`);
    let score = 0;
    let ok = true;
    for (const w of words) {
      const esc = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const at = new RegExp(`(^|[^\\p{L}\\p{N}])${esc}`, 'u').exec(title);
      if (at) {
        // A whole word beats the start of a longer word; the title's first word beats the rest.
        const whole = new RegExp(`(^|[^\\p{L}\\p{N}])${esc}($|[^\\p{L}\\p{N}])`, 'u').test(title);
        score += (whole ? 6 : 4) + (at.index === 0 ? 1 : 0);
      } else if (title.includes(w)) score += 2;
      else if (body.includes(w)) score += 1;
      else {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    if (it.kind === 'page') score += 0.5;
    scored.push({ ...it, score: score + Math.min(0.9, (it.t ?? 0) / 1e13) });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}
