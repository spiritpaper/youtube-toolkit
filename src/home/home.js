import { mountShell } from '../lib/nav.js';
import { send, h, fmtNum, fmtMult, tier, ageText, videoUrl } from '../lib/ui.js';
import { channelGrowth } from '../lib/stats.js';

mountShell('home');
const $ = (id) => document.getElementById(id);
const page = (p) => chrome.runtime.getURL(`src/${p}`);
const idFrom = (s) => (/(?:v=|youtu\.be\/|shorts\/)([\w-]{11})/.exec(s) ?? /^([\w-]{11})$/.exec(s.trim()))?.[1];

$('dig').addEventListener('submit', (e) => {
  e.preventDefault();
  location.href = page(`explore/explore.html?q=${encodeURIComponent($('dig-q').value.trim())}`);
});
$('map').addEventListener('submit', (e) => {
  e.preventDefault();
  const id = idFrom($('map-q').value);
  if (!id) return alert('Paste a YouTube video link.');
  location.href = page(`web/web.html?v=${id}`);
});

const card = (title, link, linkText, ...body) =>
  h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', {}, title), link && h('a', { href: page(link) }, linkText ?? 'Open')), ...body);
const videoRow = (v, meta) =>
  h('a', { class: 'r', href: videoUrl(v), target: '_blank' }, h('img', { src: v.thumb ?? `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`, alt: '', loading: 'lazy' }), h('div', {}, h('div', { class: 't' }, v.title), h('div', { class: 'm' }, meta)), h('span', { class: `pill tier-${tier(v.multiplier)}` }, fmtMult(v.multiplier)));

// Everything here comes from saved data: opening Home costs no API quota.
const s = await chrome.storage.local.get(null);
const ideas = Object.values(s.ideas ?? {});
const radar = s.radar ?? [];
const follows = Object.values(s.watchlist ?? {});
const holes = Object.values(s['explore:index'] ?? {}).filter((n) => !n.parentId).sort((a, b) => b.updatedAt - a.updatedAt);
const webs = Object.entries(s).filter(([k]) => k.startsWith('vw:')).map(([, w]) => w).sort((a, b) => b.updatedAt - a.updatedAt);
const projects = Object.values(s.projects ?? {});
const aiReady = !!s.ai?.keys?.[s.ai?.provider];

const steps = [
  [!!s.apiKey, 'Add your YouTube API key', 'popup', 'Open the extension popup'],
  [follows.length > 0, 'Follow channels you want to learn from', 'channels/channels.html', 'Following'],
  [ideas.length > 0, 'Save your first outlier (☆ on any video)', 'explore/explore.html', 'Find outliers'],
  [aiReady, 'Connect an AI provider (optional)', 'options/options.html', 'Settings'],
  [!!s.google?.signedIn, 'Sign in to see your own retention (optional)', 'studio/studio.html#mine', 'My channel'],
];
if (steps.some(([done]) => !done)) {
  $('setup').replaceWith(
    h('section', { class: 'setup' }, h('h2', {}, `Getting started · ${steps.filter(([d]) => d).length} of ${steps.length} done`),
      h('ul', { class: 'steps' }, steps.map(([done, label, link, linkText]) =>
        h('li', {}, h('span', { class: done ? 'ok' : 'todo' }, done ? '✓' : '○'), h('span', {}, label), !done && link !== 'popup' && h('a', { href: page(link) }, `${linkText} →`), !done && link === 'popup' && h('span', { class: 'muted small', style: 'margin-left:auto' }, 'click the Outlier Lab icon in the toolbar'))))),
  );
}

// A newer release on GitHub (public build only; see background/updates.js).
if (s.updateAvailable?.version) {
  $('grid').before(h('div', { class: 'banner update-banner' },
    h('b', {}, `Outlier Lab ${s.updateAvailable.version} is out.`), ' ',
    s.updateAvailable.zip && h('a', { href: s.updateAvailable.zip }, 'Download'), ' · ',
    h('a', { href: s.updateAvailable.url, target: '_blank', rel: 'noopener' }, "What's new"), ' · ',
    h('a', { href: page('options/options.html#updates') }, 'How to update')));
}

const unread = radar.filter((r) => !r.read);
const movers = follows
  .map((f) => ({ ...f, g: channelGrowth(f.history, 7) }))
  .filter((f) => f.g?.subs != null)
  .sort((a, b) => b.g.subs - a.g.subs)
  .slice(0, 4);
const byStatus = (st) => projects.filter((p) => p.status === st).length;

$('grid').append(
  card('Radar', 'studio/studio.html#radar', 'Open radar',
    h('div', {}, h('span', { class: 'big' }, unread.length), h('span', { class: 'muted' }, ' new outliers from channels you follow')),
    h('div', { class: 'rows' }, (unread.length ? unread : radar).slice(0, 3).map((r) => videoRow(r, `${r.channelTitle} · ${ageText(r.publishedAt)}`))),
    !radar.length && h('p', { class: 'muted small' }, 'Follow channels and the radar checks them daily for new outliers.')),
  card('Idea board', 'board/board.html', 'Open board',
    projects.length
      ? h('p', {}, ['idea', 'planned', 'scripting', 'filming', 'published'].map((st) => `${byStatus(st)} ${st}`).join(' · '))
      : h('p', { class: 'muted' }, 'Turn saved outliers into your own video projects and track them from idea to published.')),
  card('Following', 'channels/channels.html', 'All channels',
    h('div', {}, h('span', { class: 'big' }, follows.length), h('span', { class: 'muted' }, ' channels tracked daily')),
    movers.length > 0 && h('div', { class: 'rows' }, movers.map((f) => h('a', { class: 'r noimg', href: `https://www.youtube.com/channel/${f.id}`, target: '_blank' }, h('div', {}, h('div', { class: 't' }, f.title), h('div', { class: 'm' }, 'subscribers, last 7 days')), h('b', { class: f.g.subs >= 0 ? 'up' : 'down' }, `${f.g.subs >= 0 ? '+' : ''}${fmtNum(f.g.subs)}`))))),
  card('Saved outliers', 'ideas/ideas.html', 'All saved',
    ideas.length
      ? h('div', { class: 'rows' }, ideas.sort((a, b) => b.savedAt - a.savedAt).slice(0, 4).map((i) => videoRow({ ...i, multiplier: i.stats?.multiplier ?? i.multiplier }, `${i.channelTitle} · saved ${ageText(i.savedAt)}`)))
      : h('p', { class: 'muted' }, 'Nothing saved yet.')),
  card('Rabbit holes', 'explore/explore.html', 'Explorer',
    holes.length
      ? h('div', { class: 'rows' }, holes.slice(0, 5).map((n) => h('a', { class: 'r noimg', href: page(`explore/explore.html?node=${n.id}`) }, h('div', {}, h('div', { class: 't' }, n.keyword), h('div', { class: 'm' }, `explored ${ageText(n.updatedAt)}`)), h('span', { class: 'muted small' }, `opportunity ${n.metrics?.opportunity ?? '—'}`))))
      : h('p', { class: 'muted' }, 'Start with a keyword above.')),
  card('Video webs', 'web/web.html', 'Video web',
    webs.length
      ? h('div', { class: 'rows' }, webs.slice(0, 4).map((w) => h('a', { class: 'r noimg', href: page(`web/web.html?v=${w.seed}`) }, h('div', {}, h('div', { class: 't' }, w.nodes[w.seed]?.title ?? w.seed), h('div', { class: 'm' }, `${Object.keys(w.nodes).length} videos · ${ageText(w.updatedAt)}`)), h('span', {}, '→'))))
      : h('p', { class: 'muted' }, 'Paste a video link above to map what YouTube suggests around it.')),
);
