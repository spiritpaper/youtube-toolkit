// Small helpers shared by the extension pages (ideas, explorer, settings).

export function send(msg) {
  return chrome.runtime.sendMessage(msg).then((res) => {
    if (!res?.ok) throw Object.assign(new Error(res?.error ?? 'No response from extension.'), { reason: res?.reason });
    return res.data;
  });
}

// DOM builder; text children become text nodes, so untrusted strings are safe.
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  el.append(...children.flat(Infinity).filter((c) => c != null && c !== false));
  return el;
}

/**
 * A friendly "nothing here yet" block: a heading, what to do, and links to
 * the page where it happens. actions: [{ label, href, primary }].
 */
export function emptyState(title, text, actions = []) {
  return h('div', { class: 'empty-state' },
    h('h2', {}, title),
    h('p', {}, text),
    actions.length > 0 && h('div', { class: 'empty-actions' }, actions.map((a) => h('a', { class: `button-link${a.primary ? ' primary' : ''}`, href: a.href, target: a.external ? '_blank' : null }, a.label))));
}

/** Placeholder cards while a list loads. */
export const skeletons = (n = 3, cls = 'skeleton-card') => h('div', { class: 'skeletons', 'aria-busy': 'true', 'aria-label': 'Loading' }, Array.from({ length: n }, () => h('div', { class: cls })));

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
export const fmtNum = (n) => (n == null || !Number.isFinite(n) ? '—' : compact.format(n));
export const fmtMult = (m) => (m == null || !Number.isFinite(m) ? '—' : m >= 10 ? `${Math.round(m)}x` : `${m.toFixed(1)}x`);
export const fmtPct = (x, d = 0) => (x == null || !Number.isFinite(x) ? '—' : `${(x * 100).toFixed(d)}%`);
export const fmtDate = (d) => new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
export const isoDate = (t) => (t ? new Date(t).toISOString().slice(0, 10) : '');
export const round = (x, d = 4) => (x == null || !Number.isFinite(x) ? '' : Number(x.toFixed(d)));
export const fmtBytes = (b) =>
  b < 1024 ? `${b} B` : b < 1024 ** 2 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1024 ** 2).toFixed(1)} MB`;

// Outlier tiers: 2x / 5x / 10x, as used by outlier tools.
export const tier = (m) =>
  m == null || !Number.isFinite(m) ? 'none' : m < 0.5 ? 'low' : m < 2 ? 'mid' : m < 5 ? 'good' : m < 10 ? 'great' : 'viral';

// Percentile 0–100 -> "Top 4%" / "Bottom 20%".
export const rank = (p) => (p >= 50 ? `Top ${Math.max(1, Math.round(100 - p))}%` : `Bottom ${Math.max(1, Math.round(p))}%`);

export const ageText = (publishedAt) => {
  const d = (Date.now() - new Date(publishedAt)) / 86_400_000;
  if (d < 1 / 1440) return 'just now';
  if (d < 1 / 24) return `${Math.round(d * 1440)}m ago`;
  if (d < 1) return `${Math.round(d * 24)}h ago`;
  if (d < 30) return `${Math.round(d)}d ago`;
  if (d < 365) return `${Math.round(d / 30)}mo ago`;
  return `${(d / 365).toFixed(1)}y ago`;
};

export const videoUrl = (v) =>
  v.format === 'short' ? `https://www.youtube.com/shorts/${v.id}` : `https://www.youtube.com/watch?v=${v.id}`;

export function download(name, text, type = 'text/plain;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  h('a', { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// A short searchable topic from a video title ("I Spent 7 Days in Tokyo!!" -> "Spent 7 Days in Tokyo").
export function topicOf(title) {
  return title
    .replace(/[[(【].*?[\])】]/g, ' ')
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5)
    .join(' ');
}
