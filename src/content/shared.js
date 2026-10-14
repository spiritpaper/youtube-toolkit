// Shared helpers for the content scripts (classic scripts share this global).
const YTK = (window.YTK = {});

YTK.settings = { badges: true, watchPanel: true, badgeMin: 0 };
YTK.saved = new Set();
YTK.following = new Set();

YTK.loadSettings = async () => {
  const s = await chrome.storage.local.get(Object.keys(YTK.settings));
  for (const k of Object.keys(YTK.settings)) if (s[k] !== undefined) YTK.settings[k] = s[k];
  try {
    YTK.saved = new Set(await YTK.send({ type: 'savedIds' }));
  } catch {}
  const { watchlist = {} } = await chrome.storage.local.get('watchlist');
  YTK.following = new Set(Object.keys(watchlist));
};

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  let settingsChanged = false;
  for (const k of Object.keys(YTK.settings)) {
    if (k in changes) {
      YTK.settings[k] = changes[k].newValue;
      settingsChanged = true;
    }
  }
  if ('ideas' in changes) {
    YTK.saved = new Set(Object.keys(changes.ideas.newValue ?? {}));
    document.dispatchEvent(new CustomEvent('ytk-saved-changed'));
  }
  if ('watchlist' in changes) YTK.following = new Set(Object.keys(changes.watchlist.newValue ?? {}));
  if ('apiKey' in changes) settingsChanged = true;
  if (settingsChanged) document.dispatchEvent(new CustomEvent('ytk-settings-changed'));
});

YTK.send = (msg) =>
  new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(msg, (res) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (!res) return reject(new Error('No response from extension.'));
        if (res.ok) resolve(res.data);
        else reject(Object.assign(new Error(res.error), { reason: res.reason }));
      });
    } catch {
      reject(Object.assign(new Error('Extension was updated. Reload this tab.'), { reason: 'stale' }));
    }
  });

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
YTK.fmtNum = (n) => (n == null || !Number.isFinite(n) ? '—' : compact.format(n));
YTK.fmtPct = (x, digits = 1) => (x == null || !Number.isFinite(x) ? '—' : `${(x * 100).toFixed(digits)}%`);
YTK.fmtMult = (m) =>
  m == null || !Number.isFinite(m) ? '—' : m >= 10 ? `${Math.round(m)}x` : `${m.toFixed(1)}x`;

// Color bands for the multiplier, matching the 2x / 5x / 10x tiers outlier
// tools use.
YTK.tier = (m) => {
  if (m == null || !Number.isFinite(m)) return 'none';
  if (m < 0.5) return 'low';
  if (m < 2) return 'mid';
  if (m < 5) return 'good';
  if (m < 10) return 'great';
  return 'viral';
};
YTK.tierLabel = {
  none: 'No baseline',
  low: 'Underperforming',
  mid: 'Typical',
  good: 'Outlier',
  great: 'Strong outlier',
  viral: 'Breakout',
};

// "Is the channel growing?" from the background's channelTrend().
YTK.fmtTrend = (t) => {
  if (!t?.label) return { text: 'Not enough data', cls: 'tier-none', title: '' };
  const arrow = { growing: '↑', stable: '→', declining: '↓' }[t.label];
  const cls = { growing: 'tier-good', stable: 'tier-mid', declining: 'tier-low' }[t.label];
  const word = t.label[0].toUpperCase() + t.label.slice(1);
  return {
    text: `${arrow} ${word}`,
    cls,
    title:
      `Last ${t.recentCount} uploads: median ${YTK.fmtNum(t.recentMedian)} views vs ${YTK.fmtNum(t.priorMedian)} before (${YTK.fmtMult(t.momentum)}).\n` +
      `Trend line: ${t.monthlyChange >= 0 ? '+' : ''}${(t.monthlyChange * 100).toFixed(0)}% views per month across ${t.sample} videos.`,
  };
};

YTK.ageDays = (publishedAt) => Math.max((Date.now() - new Date(publishedAt).getTime()) / 86_400_000, 0);
YTK.fmtAge = (publishedAt) => {
  const d = YTK.ageDays(publishedAt);
  if (d < 1 / 24) return `${Math.max(1, Math.round(d * 1440))}m ago`;
  if (d < 1) return `${Math.round(d * 24)}h ago`;
  if (d < 30) return `${Math.round(d)}d ago`;
  if (d < 365) return `${Math.round(d / 30)}mo ago`;
  return `${(d / 365).toFixed(d < 3650 ? 1 : 0)}y ago`;
};

const VIDEO_ID = /^[\w-]{11}$/;
YTK.videoIdFromHref = (href) => {
  if (!href) return null;
  try {
    const u = new URL(href, location.origin);
    if (u.pathname === '/watch') {
      const v = u.searchParams.get('v');
      return VIDEO_ID.test(v) ? v : null;
    }
    const m = /^\/shorts\/([\w-]{11})/.exec(u.pathname);
    return m ? m[1] : null;
  } catch {
    return null;
  }
};

YTK.pageType = () => {
  const p = location.pathname;
  if (p === '/watch') return 'watch';
  if (p.startsWith('/shorts/')) return 'shorts';
  if (YTK.channelRefFromPath(p)) return 'channel';
  return 'other';
};

YTK.channelRefFromPath = (pathname) => {
  let m;
  if ((m = /^\/channel\/(UC[\w-]{22})/.exec(pathname))) return { id: m[1] };
  if ((m = /^\/(@[^/]+)/.exec(pathname))) return { handle: decodeURIComponent(m[1]) };
  if ((m = /^\/user\/([^/]+)/.exec(pathname))) return { username: decodeURIComponent(m[1]) };
  return null;
};

// Tiny DOM builder. Text is always set via text nodes, never innerHTML,
// because titles come from YouTube and are untrusted.
YTK.h = (tag, attrs = {}, ...children) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
};

// Inline SVG icons (paths are static, so innerHTML is safe here).
const ICONS = {
  star: '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>',
  chevron: '<path d="M6 9l6 6 6-6"/>',
};
YTK.icon = (name, { filled = false } = {}) => {
  const span = document.createElement('span');
  span.className = 'ytk-icon';
  span.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="${filled ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
  return span;
};

// Design tokens shared by the shadow-DOM panels; follows YouTube's dark mode.
YTK.panelCss = `
  :host {
    --bg: #ffffff; --bg-2: #f2f2f2; --bg-3: #e5e5e5; --fg: #0f0f0f; --fg-2: #606060;
    --border: rgba(0,0,0,.1); --accent: #065fd4; --shadow: 0 8px 28px rgba(0,0,0,.18);
    --t-low: #c62828; --t-mid: #606060; --t-good: #2e7d32; --t-great: #1b5e20; --t-viral: #6a1b9a;
    --t-low-bg: #fdecea; --t-mid-bg: #ededed; --t-good-bg: #e6f4e7; --t-great-bg: #c8ebcb; --t-viral-bg: #f1e4f7;
    font-family: "Roboto", "Arial", sans-serif; color: var(--fg); font-size: 13px; line-height: 1.4;
  }
  :host-context(html[dark]) {
    --bg: #212121; --bg-2: #2c2c2c; --bg-3: #3a3a3a; --fg: #f1f1f1; --fg-2: #aaaaaa;
    --border: rgba(255,255,255,.12); --accent: #3ea6ff; --shadow: 0 8px 28px rgba(0,0,0,.5);
    --t-low: #ff8a80; --t-mid: #bdbdbd; --t-good: #81c784; --t-great: #b9f6ca; --t-viral: #e1bee7;
    --t-low-bg: #4a1f1f; --t-mid-bg: #333333; --t-good-bg: #1e3a20; --t-great-bg: #1b4d24; --t-viral-bg: #42204f;
  }
  * { box-sizing: border-box; }
  .ytk-icon { display: inline-flex; }
  button { font: inherit; color: inherit; cursor: pointer; }
  .tier-none { color: var(--fg-2); }
  .tier-low { color: var(--t-low); } .tier-mid { color: var(--t-mid); }
  .tier-good { color: var(--t-good); } .tier-great { color: var(--t-great); } .tier-viral { color: var(--t-viral); }
  .pill { display: inline-block; padding: 2px 7px; border-radius: 999px; font-weight: 700; font-variant-numeric: tabular-nums; }
  .pill.tier-none { background: var(--bg-2); } .pill.tier-low { background: var(--t-low-bg); }
  .pill.tier-mid { background: var(--t-mid-bg); } .pill.tier-good { background: var(--t-good-bg); }
  .pill.tier-great { background: var(--t-great-bg); } .pill.tier-viral { background: var(--t-viral-bg); }
  .btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 7px 12px;
    border-radius: 18px; border: 1px solid var(--border); background: var(--bg-2); font-weight: 500; }
  .btn:hover { background: var(--bg-3); }
  .btn.primary { background: var(--fg); color: var(--bg); border-color: transparent; }
  .btn.primary:hover { opacity: .85; }
  .icon-btn { border: 0; background: transparent; padding: 6px; border-radius: 50%; display: inline-flex; color: var(--fg-2); }
  .icon-btn:hover { background: var(--bg-2); color: var(--fg); }
  .muted { color: var(--fg-2); }
  .error { color: var(--t-low); }
`;

YTK.toast = (message) => {
  const el = YTK.h('div', { class: 'ytk-toast' }, message);
  document.body.append(el);
  setTimeout(() => el.remove(), 6000);
};

YTK.sleep = (ms) => new Promise((r) => setTimeout(r, ms));

YTK.parseTime = (ts) => (ts ?? '').split(':').reduce((acc, part) => acc * 60 + Number(part || 0), 0);
YTK.fmtTime = (sec) => {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
};

// ---------- Transcripts ----------

// Caption files the player downloaded, keyed by video id (see page-hook.js).
YTK.captions = new Map();

/** Parses YouTube caption files (json3 or XML) into [{ start, text }]. */
YTK.parseTimedText = (body) => {
  const clean = (t) => t.replace(/\s+/g, ' ').trim();
  try {
    const data = JSON.parse(body);
    return (data.events ?? [])
      .filter((e) => e.segs)
      .map((e) => ({ start: (e.tStartMs ?? 0) / 1000, text: clean(e.segs.map((s) => s.utf8 ?? '').join('')) }))
      .filter((s) => s.text);
  } catch {}
  const doc = new DOMParser().parseFromString(body, 'text/xml');
  return [...doc.querySelectorAll('p, text')]
    .map((n) => ({
      start: n.hasAttribute('t') ? Number(n.getAttribute('t')) / 1000 : Number(n.getAttribute('start') ?? 0),
      text: clean(n.textContent),
    }))
    .filter((s) => s.text);
};

window.addEventListener('message', (e) => {
  if (e.source !== window || e.origin !== location.origin || e.data?.source !== 'ytk-timedtext') return;
  try {
    const u = new URL(e.data.url);
    const id = u.searchParams.get('v');
    if (!id || u.searchParams.get('tlang')) return; // skip auto-translations
    const segments = YTK.parseTimedText(e.data.body);
    if (!segments.length) return;
    const lang = u.searchParams.get('lang') ?? '';
    const kind = u.searchParams.get('kind') === 'asr' ? 'auto-generated' : 'creator';
    const prev = YTK.captions.get(id);
    // Prefer creator captions over auto-generated ones.
    if (!prev || (prev.kind === 'auto-generated' && kind === 'creator')) YTK.captions.set(id, { segments, lang, kind });
  } catch {}
});

const currentVideoId = () => new URLSearchParams(location.search).get('v');

// Makes the player fetch captions by switching CC on and back off.
async function captionsViaPlayer(id) {
  if (YTK.captions.has(id)) return YTK.captions.get(id);
  const btn = document.querySelector('#movie_player .ytp-subtitles-button');
  if (!btn || btn.getAttribute('aria-disabled') === 'true' || btn.style.display === 'none') return null;
  const wasOn = btn.getAttribute('aria-pressed') === 'true';
  btn.click();
  if (wasOn) {
    await YTK.sleep(300);
    btn.click(); // turn it back on to force a fresh download
  }
  for (let i = 0; i < 24 && !YTK.captions.has(id); i++) await YTK.sleep(250);
  if (!wasOn) {
    // Put CC back the way the viewer had it (the button state can lag a moment).
    for (let i = 0; i < 4 && btn.getAttribute('aria-pressed') === 'true'; i++) {
      btn.click();
      await YTK.sleep(250);
    }
  }
  return YTK.captions.get(id) ?? null;
}

// Fallback: open YouTube's transcript panel and read it.
async function captionsViaPanel() {
  const SEG = 'transcript-segment-view-model, ytd-transcript-segment-renderer';
  const panelOf = (el) => el?.closest('ytd-engagement-panel-section-list-renderer');
  let opened = false;
  if (!document.querySelector(SEG)) {
    const findButton = () =>
      document.querySelector('ytd-video-description-transcript-section-renderer button, button[aria-label="Show transcript"]');
    let btn = findButton();
    if (!btn) {
      document.querySelector('#description-inline-expander #expand, ytd-watch-metadata #expand')?.click();
      await YTK.sleep(600);
      btn = findButton();
    }
    if (!btn) return null;
    btn.click();
    opened = true;
    for (let i = 0; i < 40 && !document.querySelector(SEG); i++) await YTK.sleep(250);
  }
  let last = -1;
  for (let i = 0; i < 20; i++) {
    const n = document.querySelectorAll(SEG).length;
    if (n > 0 && n === last) break;
    last = n;
    await YTK.sleep(250);
  }
  const els = [...document.querySelectorAll(SEG)];
  const segments = els
    .map((el) => ({
      start: YTK.parseTime(el.querySelector('.ytwTranscriptSegmentViewModelTimestamp, .segment-timestamp')?.textContent.trim()),
      text: (el.querySelector('span.ytAttributedStringHost, .segment-text')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
    }))
    .filter((s) => s.text);
  if (opened) panelOf(els[0] ?? document.querySelector('ytd-engagement-panel-section-list-renderer[visibility=ENGAGEMENT_PANEL_VISIBILITY_EXPANDED]'))?.querySelector('button[aria-label="Close"]')?.click();
  return segments.length ? { segments, lang: '', kind: 'panel' } : null;
}

/**
 * The transcript of the video on this watch page: the captions the player
 * downloaded (switching CC on briefly if needed), else YouTube's transcript
 * panel. Returns { segments: [{ start, text }], lang, kind }.
 */
YTK.captureTranscript = async () => {
  const id = currentVideoId();
  const result = (id && (await captionsViaPlayer(id))) || (await captionsViaPanel());
  if (!result) throw new Error('This video has no captions or transcript.');
  return result;
};

YTK.transcriptText = (segments, { title = '', url = '' } = {}) =>
  [title, url, '', ...segments.map((s) => `[${YTK.fmtTime(s.start)}] ${s.text}`)].join('\n');

YTK.download = (name, text) => {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  YTK.h('a', { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

YTK.safeFileName = (s) => s.replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'video';

// "Most replayed" heatmap as an SVG area chart (same drawing as the ideas page).
YTK.heatmapSvg = (points, { width = 280, height = 44, peaks = [] } = {}) => {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('class', 'heatmap');
  const total = points.at(-1).start + points.at(-1).duration;
  const x = (t) => (t / total) * width;
  const y = (v) => height - 2 - v * (height - 4);
  const d =
    `M0,${height} ` +
    points.map((p) => `L${x(p.start + p.duration / 2).toFixed(1)},${y(p.intensity).toFixed(1)}`).join(' ') +
    ` L${width},${height} Z`;
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', d);
  svg.append(path);
  for (const p of peaks) {
    const line = document.createElementNS(ns, 'line');
    line.setAttribute('x1', x(p.start));
    line.setAttribute('x2', x(p.start));
    line.setAttribute('y1', 0);
    line.setAttribute('y2', height);
    svg.append(line);
  }
  return svg;
};

// Same peak picking as src/lib/stats.js heatmapPeaks (content scripts can't import modules).
YTK.heatmapPeaks = (points, count = 3, gap = 5) => {
  const picked = [];
  for (const c of points.map((p, i) => ({ ...p, i })).filter((p) => p.i >= 3).sort((a, b) => b.intensity - a.intensity)) {
    if (picked.length >= count) break;
    if (picked.every((p) => Math.abs(p.i - c.i) >= gap)) picked.push(c);
  }
  return picked.sort((a, b) => a.start - b.start);
};
