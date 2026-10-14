// Video web: a graph of YouTube's "suggested next" links around a seed video.
// Nodes are videos; an edge A → B means YouTube suggests B on A's watch page
// (rank 1 = top of the sidebar). Pure functions: relationships, insights and
// a small force-directed layout for drawing.

import { words } from './titles.js';

const GENERIC = new Set('video videos official full new part ep episode best top travel vlog guide'.split(' '));
export const topicWords = (title, tags = []) =>
  new Set([...words(title), ...tags.flatMap((t) => words(t))].filter((w) => w.length > 2 && !/^\d+$/.test(w) && !GENERIC.has(w)));

export function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const x of a) if (b.has(x)) shared++;
  return shared / (a.size + b.size - shared);
}

/**
 * Adds suggestion edges to a web, without duplicates.
 * web: { nodes: { [id]: node }, edges: [{ from, to, rank }] }
 */
export function addSuggestions(web, from, ids, perNode) {
  const have = new Set(web.edges.map((e) => `${e.from}>${e.to}`));
  ids.slice(0, perNode).forEach((to, i) => {
    if (to === from || have.has(`${from}>${to}`)) return;
    web.edges.push({ from, to, rank: i + 1 });
    web.nodes[to] ??= { id: to, depth: (web.nodes[from]?.depth ?? 0) + 1 };
  });
  web.nodes[from].expanded = true;
}

/** Why two videos are connected, in plain words. */
export function relationship(web, aId, bId) {
  const a = web.nodes[aId];
  const b = web.nodes[bId];
  const out = [];
  const ab = web.edges.find((e) => e.from === aId && e.to === bId);
  const ba = web.edges.find((e) => e.from === bId && e.to === aId);
  if (ab && ba) out.push(`YouTube suggests each from the other (#${ab.rank} and #${ba.rank})`);
  else if (ab) out.push(`Suggested on "${a.title ?? aId}" (#${ab.rank})`);
  else if (ba) out.push(`Suggests "${a.title ?? aId}" (#${ba.rank})`);
  if (a.channelId && a.channelId === b.channelId) out.push(`Same channel (${a.channelTitle})`);
  const shared = [...topicWords(a.title ?? '', a.tags)].filter((w) => topicWords(b.title ?? '', b.tags).has(w));
  if (shared.length) out.push(`Shared topic: ${shared.slice(0, 5).join(', ')}`);
  return out;
}

/**
 * Insights about the whole web: hubs (videos YouTube keeps suggesting),
 * mutual links, dominant channels, topic clusters, and words that are
 * over-represented in the web's outliers.
 */
export function webInsights(web) {
  const nodes = Object.values(web.nodes).filter((n) => n.title);
  const inDeg = new Map();
  for (const e of web.edges) inDeg.set(e.to, (inDeg.get(e.to) ?? 0) + 1);
  const hubs = nodes
    .map((n) => ({ ...n, inDegree: inDeg.get(n.id) ?? 0 }))
    .filter((n) => n.inDegree >= 2)
    .sort((a, b) => b.inDegree - a.inDegree)
    .slice(0, 6);

  const pairs = new Set(web.edges.map((e) => `${e.from}>${e.to}`));
  const mutual = web.edges.filter((e) => e.from < e.to && pairs.has(`${e.to}>${e.from}`)).map((e) => [e.from, e.to]);

  const channels = new Map();
  for (const n of nodes) {
    const c = channels.get(n.channelId) ?? { id: n.channelId, title: n.channelTitle, count: 0, outliers: 0 };
    c.count++;
    if (n.multiplier >= 2) c.outliers++;
    channels.set(n.channelId, c);
  }
  const topChannels = [...channels.values()].sort((a, b) => b.count - a.count || b.outliers - a.outliers).slice(0, 6);

  const outliers = nodes.filter((n) => n.multiplier >= 2).sort((a, b) => b.multiplier - a.multiplier);
  const rest = nodes.filter((n) => !(n.multiplier >= 2));
  const count = (list) => {
    const m = new Map();
    for (const n of list) for (const w of topicWords(n.title, n.tags)) m.set(w, (m.get(w) ?? 0) + 1);
    return m;
  };
  const inOut = count(outliers);
  const inRest = count(rest);
  const outlierWords = [...inOut]
    .filter(([, c]) => c >= 2)
    .map(([w, c]) => ({ word: w, count: c, lift: c / outliers.length / (((inRest.get(w) ?? 0) + 1) / (rest.length + 1)) }))
    .filter((x) => x.lift >= 1.5)
    .sort((a, b) => b.lift * b.count - a.lift * a.count)
    .slice(0, 8);

  return { size: nodes.length, edges: web.edges.length, hubs, mutual, topChannels, outliers: outliers.slice(0, 8), outlierWords, clusters: clusters(web) };
}

/**
 * Topic clusters: videos joined by suggestion links whose titles share
 * enough words. Each cluster is labelled by its most common words.
 */
export function clusters(web, minSimilarity = 0.15) {
  const nodes = Object.values(web.nodes).filter((n) => n.title);
  const topics = new Map(nodes.map((n) => [n.id, topicWords(n.title, n.tags)]));
  const parent = new Map(nodes.map((n) => [n.id, n.id]));
  const find = (x) => (parent.get(x) === x ? x : (parent.set(x, find(parent.get(x))), parent.get(x)));
  for (const e of web.edges) {
    if (!topics.has(e.from) || !topics.has(e.to)) continue;
    if (jaccard(topics.get(e.from), topics.get(e.to)) >= minSimilarity) parent.set(find(e.from), find(e.to));
  }
  const groups = new Map();
  for (const n of nodes) {
    const r = find(n.id);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(n);
  }
  return [...groups.values()]
    .filter((g) => g.length >= 3)
    .map((g) => {
      const freq = new Map();
      for (const n of g) for (const w of topics.get(n.id)) freq.set(w, (freq.get(w) ?? 0) + 1);
      const label = [...freq].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([w]) => w);
      return { label, ids: g.map((n) => n.id), outliers: g.filter((n) => n.multiplier >= 2).length };
    })
    .sort((a, b) => b.ids.length - a.ids.length);
}

/**
 * Force-directed layout (repulsion + springs + gentle centering), run to rest.
 * Deterministic: start positions come from a seeded spiral, so the same web
 * draws the same way. Returns Map(id -> { x, y }) in a width × height box.
 */
export function layout(web, { width = 1000, height = 700, iterations = 350, center = null } = {}) {
  const ids = Object.keys(web.nodes);
  const pos = new Map();
  ids.forEach((id, i) => {
    const angle = i * 2.399963; // golden angle
    const r = 30 + 12 * Math.sqrt(i) * 6;
    pos.set(id, { x: width / 2 + r * Math.cos(angle), y: height / 2 + r * Math.sin(angle), vx: 0, vy: 0 });
  });
  if (center && pos.has(center)) Object.assign(pos.get(center), { x: width / 2, y: height / 2 });
  const k = Math.sqrt((width * height) / Math.max(ids.length, 1)) * 0.55; // ideal edge length
  const links = web.edges.filter((e) => pos.has(e.from) && pos.has(e.to));
  for (let it = 0; it < iterations; it++) {
    const temp = 1 - it / iterations;
    for (let i = 0; i < ids.length; i++) {
      const a = pos.get(ids[i]);
      for (let j = i + 1; j < ids.length; j++) {
        const b = pos.get(ids[j]);
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        const d2 = dx * dx + dy * dy || 0.01;
        const f = (k * k) / d2;
        dx *= f;
        dy *= f;
        a.vx += dx;
        a.vy += dy;
        b.vx -= dx;
        b.vy -= dy;
      }
    }
    for (const e of links) {
      const a = pos.get(e.from);
      const b = pos.get(e.to);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const f = ((d - k) / d) * 0.06;
      a.vx += dx * f;
      a.vy += dy * f;
      b.vx -= dx * f;
      b.vy -= dy * f;
    }
    for (const id of ids) {
      const p = pos.get(id);
      p.vx += (width / 2 - p.x) * 0.01;
      p.vy += (height / 2 - p.y) * 0.01;
      const v = Math.sqrt(p.vx * p.vx + p.vy * p.vy) || 1;
      const step = Math.min(v, 30 * temp + 1);
      if (id !== center) {
        p.x += (p.vx / v) * step;
        p.y += (p.vy / v) * step;
      }
      p.vx *= 0.5;
      p.vy *= 0.5;
    }
  }
  // Fit into the box with a margin.
  const xs = [...pos.values()].map((p) => p.x);
  const ys = [...pos.values()].map((p) => p.y);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const m = 60;
  const sx = (width - 2 * m) / (maxX - minX || 1);
  const sy = (height - 2 * m) / (maxY - minY || 1);
  const s = Math.min(sx, sy, 1.5);
  const ox = (width - (maxX - minX) * s) / 2;
  const oy = (height - (maxY - minY) * s) / 2;
  return new Map([...pos].map(([id, p]) => [id, { x: ox + (p.x - minX) * s, y: oy + (p.y - minY) * s }]));
}
