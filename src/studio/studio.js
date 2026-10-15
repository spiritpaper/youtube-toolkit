import { mountShell } from '../lib/nav.js';
import { send, h, fmtNum, fmtMult, fmtPct, tier, ageText, videoUrl, emptyState } from '../lib/ui.js';
import { change, median, retentionSummary, formatTime } from '../lib/stats.js';
import { lineChart } from '../lib/linechart.js';
import { contentGaps } from '../lib/gaps.js';
import { titleChecks, similarTitles } from '../lib/titles.js';
import { activeAi, generate, gapsPrompt, titlesPrompt, channelReviewPrompt, PROVIDERS } from '../lib/ai.js';
import { reviewData } from '../lib/channel-review.js';
import { markdownToHtml } from '../lib/markdown.js';

const shell = mountShell('mine');

const $ = (id) => document.getElementById(id);
const main = $('main');
const COLORS = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)'];

const state = {
  tab: 'mine',
  days: 28,
  auth: null,
  selected: [], // up to 3 video ids for the retention chart
  compareSort: 'medianLong',
};

// ---------- tabs ----------

const TAB_TITLES = { mine: 'My channel', compare: 'Compare channels', radar: 'Outlier radar', gaps: 'Content gaps', titles: 'Title lab' };
function setTab(tab) {
  state.tab = tab;
  history.replaceState(null, '', `#${tab}`);
  shell.setActive(tab);
  document.querySelector('.top h1').textContent = TAB_TITLES[tab];
  document.title = `${TAB_TITLES[tab]} · YT Toolkit`;
  for (const b of document.querySelectorAll('.tabs button')) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
  ({ mine: renderMine, compare: renderCompare, radar: renderRadar, gaps: renderGaps, titles: renderTitles })[tab]();
}
for (const b of document.querySelectorAll('.tabs button')) b.addEventListener('click', () => setTab(b.dataset.tab));
// Sidebar links change only the hash on this page.
window.addEventListener('hashchange', () => {
  const tab = location.hash.slice(1);
  if (tab !== state.tab && TAB_TITLES[tab]) setTab(tab);
});

const loading = (text) => main.replaceChildren(h('div', { class: 'loading' }, text));
const errorBox = (err) => h('div', { class: 'error' }, err.message ?? String(err));

// ---------- My channel ----------

function setupCard(auth, err) {
  const clientInput = h('input', { value: auth.clientId, placeholder: '1234567890-abc….apps.googleusercontent.com', spellcheck: 'false' });
  const copyBtn = h('button', { type: 'button', onclick: async (e) => { await navigator.clipboard.writeText(auth.redirectUri); e.target.textContent = 'Copied'; } }, 'Copy');
  return h(
    'section',
    { class: 'card setup' },
    h('h2', {}, 'Connect your YouTube channel'),
    h('p', { class: 'muted' }, 'Sign in with Google to see your own retention curves, watch time and subscriber data, and compare yourself with other channels. One-time setup, about 5 minutes, in the same Google Cloud project as your YouTube API key:'),
    err && errorBox(err),
    h(
      'ol',
      {},
      h('li', {}, 'Enable the ', h('a', { href: 'https://console.cloud.google.com/apis/library/youtubeanalytics.googleapis.com', target: '_blank' }, 'YouTube Analytics API'), '.'),
      h('li', {}, 'Open ', h('a', { href: 'https://console.cloud.google.com/auth/overview', target: '_blank' }, 'Google Auth Platform'), ': set an app name and your email, choose ', h('b', {}, 'External'), ', and under ', h('b', {}, 'Audience'), ' add your own Google account as a ', h('b', {}, 'test user'), '.'),
      h('li', {}, 'Under ', h('a', { href: 'https://console.cloud.google.com/auth/clients', target: '_blank' }, 'Clients'), ', create a client of type ', h('b', {}, 'Web application'), ' and add this ', h('b', {}, 'Authorized redirect URI'), ':', h('div', { class: 'row', style: 'margin-top:6px' }, h('code', {}, auth.redirectUri), copyBtn)),
      h('li', {}, 'Paste the client ID here and sign in. Google will say the app is unverified. It\'s your own app, so choose ', h('b', {}, 'Continue'), '.'),
    ),
    h(
      'form',
      {
        class: 'row',
        onsubmit: async (e) => {
          e.preventDefault();
          await send({ type: 'setClientId', clientId: clientInput.value });
          try {
            await send({ type: 'signIn' });
            state.auth = await send({ type: 'authStatus' });
            renderMine();
          } catch (error) {
            state.auth = await send({ type: 'authStatus' });
            main.replaceChildren(setupCard(state.auth, error));
          }
        },
      },
      clientInput,
      h('button', { class: 'primary', type: 'submit' }, 'Save & sign in with Google'),
    ),
    h('p', { class: 'muted small' }, 'Your sign-in stays in this browser. The extension only asks for read-only access to your YouTube data and analytics. If you move the extension folder, its ID and redirect URI change.'),
  );
}

const dur = (sec) => (sec == null ? '—' : formatTime(sec));
function delta(cur, prev, { invert = false } = {}) {
  const c = change(cur, prev);
  if (c == null) return h('div', { class: 'd' }, 'no previous data');
  const up = c >= 0;
  return h('div', { class: `d ${up !== invert ? 'up' : 'down'}` }, `${up ? '▲' : '▼'} ${fmtPct(Math.abs(c))} vs previous ${state.days} days`);
}
const kpi = (k, v, d) => h('div', { class: 'kpi' }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v), d);

async function renderMine() {
  state.auth = await send({ type: 'authStatus' });
  const auth = state.auth;
  if (!auth.signedIn) return main.replaceChildren(setupCard(auth));
  loading('Loading your analytics…');
  let ov, top;
  try {
    [ov, top] = await Promise.all([send({ type: 'myOverview', days: state.days }), send({ type: 'myTopVideos', days: state.days })]);
  } catch (err) {
    if (err.reason === 'signedOut') return main.replaceChildren(setupCard(auth, err));
    return main.replaceChildren(header(auth), errorBox(err));
  }
  // Titles, thumbnails and public outlier scores (same math as competitors).
  const pub = await send({ type: 'scoreVideos', ids: top.map((r) => r.video) }).catch(() => ({}));
  if (!state.selected.length && top.length) state.selected = [top[0].video];

  const c = ov.current;
  const p = ov.previous;
  const net = (o) => (o.subscribersGained ?? 0) - (o.subscribersLost ?? 0);
  main.replaceChildren(
    header(auth),
    h(
      'div',
      { class: 'kpis' },
      kpi('Views', fmtNum(c.views), delta(c.views, p.views)),
      kpi('Watch time', `${fmtNum((c.estimatedMinutesWatched ?? 0) / 60)} h`, delta(c.estimatedMinutesWatched, p.estimatedMinutesWatched)),
      kpi('Avg view duration', dur(c.averageViewDuration), delta(c.averageViewDuration, p.averageViewDuration)),
      kpi('Avg % viewed', fmtPct((c.averageViewPercentage ?? 0) / 100, 1), delta(c.averageViewPercentage, p.averageViewPercentage)),
      kpi('Net subscribers', fmtNum(net(c)), delta(net(c), net(p))),
      kpi('Likes', fmtNum(c.likes), delta(c.likes, p.likes)),
    ),
    h(
      'section',
      { class: 'card' },
      h('h3', {}, `Daily views, ${ov.startDate} to ${ov.endDate}`),
      lineChart({
        label: 'Daily views',
        area: true,
        series: [{ name: 'Views', color: COLORS[0], points: ov.daily.map((d, i) => ({ x: i, y: d.views, day: d.day })) }],
        xFormat: (i) => {
          const d = ov.daily[Math.round(i)]?.day;
          return d ? new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
        },
        yFormat: fmtNum,
      }),
    ),
    reviewCard(auth, ov, top, pub),
    retentionCard(top, pub),
    topTable(top, pub),
  );
  loadRetention(top, pub);
}

// ---------- AI channel review ----------

const REVIEW_RETENTION_VIDEOS = 6;

/** Everything the review is built on, from your analytics (no YouTube Data quota beyond cached profiles). */
async function gatherReview(auth, ov, top, pub, progress) {
  progress('Reading traffic sources…');
  const traffic = await send({ type: 'myTraffic', days: state.days }).catch(() => []);
  // Retention for the most-viewed long-form videos (Shorts curves say little).
  const ids = top.filter((r) => pub[r.video]?.format !== 'short').slice(0, REVIEW_RETENTION_VIDEOS).map((r) => r.video);
  const curves = {};
  for (const [i, id] of ids.entries()) {
    progress(`Reading retention ${i + 1} of ${ids.length}…`);
    curves[id] = await send({ type: 'myRetention', id, publishedAt: pub[id]?.publishedAt }).catch(() => null);
  }
  const txs = await chrome.storage.local.get(ids.map((id) => `tx:${id}`));
  const transcripts = Object.fromEntries(ids.filter((id) => txs[`tx:${id}`]).map((id) => [id, txs[`tx:${id}`].segments]));
  progress('Comparing with the channels you follow…');
  const rows = await send({ type: 'compare' }).catch(() => []);
  return reviewData({
    me: auth.me,
    days: state.days,
    ov,
    top,
    pub,
    traffic,
    curves,
    transcripts,
    profile: rows.find((r) => r.mine && !r.error) ?? null,
    peers: rows.filter((r) => !r.mine),
  });
}

function reviewView(r) {
  return h('div', { class: 'review' },
    h('div', { class: 'row' },
      h('span', { class: 'muted small grow' }, `${new Date(r.at).toLocaleString()} · last ${r.days} days · ${PROVIDERS[r.provider]?.label ?? r.provider} · ${r.model}`),
      h('button', { onclick: (e) => navigator.clipboard.writeText(r.text).then(() => (e.target.textContent = 'Copied')) }, 'Copy')),
    mdBlock(r.text),
    r.data && h('details', { class: 'review-data' }, h('summary', {}, 'The data this review was based on'), h('pre', {}, r.data)));
}

function reviewCard(auth, ov, top, pub) {
  const box = h('div', {});
  const history = h('div', { class: 'review-history' });
  const btn = h('button', { class: 'primary' }, 'Review my channel with AI');
  let reviews = [];

  const paintHistory = (shownAt) => {
    history.replaceChildren(
      ...(reviews.length > 1 || (reviews.length === 1 && shownAt !== reviews[0].at)
        ? [h('span', { class: 'muted small' }, 'Past reviews:'),
          ...reviews.map((r) => h('button', {
            class: `chip-btn${r.at === shownAt ? ' on' : ''}`,
            title: `${r.stats?.views != null ? `${fmtNum(r.stats.views)} views, ` : ''}${r.stats?.netSubs != null ? `${r.stats.netSubs >= 0 ? '+' : ''}${fmtNum(r.stats.netSubs)} subs` : ''}`,
            onclick: () => show(r),
          }, `${new Date(r.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · ${r.days}d`))]
        : []),
    );
  };
  const show = (r) => {
    box.replaceChildren(reviewView(r));
    paintHistory(r.at);
  };

  btn.addEventListener('click', async () => {
    const ai = await activeAi();
    if (!ai) {
      box.replaceChildren(h('p', { class: 'muted' }, 'AI is optional. Connect Gemini, OpenAI, Claude or OpenRouter in ', h('a', { href: '../options/options.html', target: '_blank' }, 'Settings'), ' to use it.'));
      return;
    }
    if (!top.length) {
      box.replaceChildren(h('p', { class: 'muted' }, `No videos had views in the last ${state.days} days, so there is nothing to review yet. Try a longer period.`));
      return;
    }
    btn.disabled = true;
    const status = h('div', { class: 'loading' }, 'Gathering your analytics…');
    box.replaceChildren(status);
    try {
      const data = await gatherReview(auth, ov, top, pub, (msg) => (status.textContent = msg));
      status.textContent = `Asking ${PROVIDERS[ai.provider].label} (${ai.model}) for an honest review. This can take a minute…`;
      const { system, prompt } = channelReviewPrompt(data.text, ai.niche);
      const text = await generate({ ...ai, system, prompt });
      const saved = await send({ type: 'saveChannelReview', review: { text, data: data.text, stats: data.stats, days: state.days, provider: ai.provider, model: ai.model } });
      reviews = [saved, ...reviews];
      show(saved);
    } catch (err) {
      box.replaceChildren(errorBox(err));
    } finally {
      btn.disabled = false;
    }
  });

  send({ type: 'channelReviews' }).then((list) => {
    reviews = list;
    if (reviews.length && !box.childElementCount) show(reviews[0]);
  }).catch(() => {});

  return h('section', { class: 'card', id: 'review' },
    h('div', { class: 'row' }, h('h3', { class: 'grow', style: 'margin:0' }, 'Honest channel review (AI)'), btn),
    h('p', { class: 'muted small' }, `Built only on your analytics for the selected period (${state.days} days): totals, every top video, retention with the moments viewers left (and what you said there, if you saved the transcript), traffic sources and the channels you follow. It names each problem, where it is and how to fix it, without softening.`),
    history,
    box);
}

function header(auth) {
  return h(
    'div',
    { class: 'me' },
    auth.me?.thumb && h('img', { src: auth.me.thumb, alt: '' }),
    h('div', { class: 'grow' }, h('h2', {}, auth.me?.title ?? 'Your channel'), h('div', { class: 'muted small' }, 'Analytics lag about 2 days behind.')),
    h('div', { class: 'seg' }, [7, 28, 90].map((d) => h('button', { class: state.days === d ? 'on' : '', onclick: () => { state.days = d; renderMine(); } }, `${d} days`))),
    h('button', { onclick: async () => { await send({ type: 'signOut' }); renderMine(); } }, 'Sign out'),
  );
}

function topTable(top, pub) {
  const hasCtr = top.some((r) => r.videoThumbnailImpressionsClickRate != null);
  return h(
    'section',
    { class: 'card' },
    h('h3', {}, `Top videos in the last ${state.days} days`),
    h('p', { class: 'muted small' }, 'Tick up to 3 videos to compare their retention. Outlier = lifetime views ÷ your channel median, the same score shown for every other channel.'),
    h(
      'div',
      { class: 'table-wrap' },
      h(
        'table',
        {},
        h(
          'thead',
          {},
          h('tr', {}, h('th', {}, 'Video'), h('th', {}, 'Views'), h('th', {}, 'Watch time'), h('th', {}, 'Avg % viewed'), h('th', {}, 'Avg duration'), h('th', {}, 'Subs gained'), hasCtr && h('th', {}, 'Impressions'), hasCtr && h('th', {}, 'CTR'), h('th', {}, 'Outlier'), h('th', {}, 'Retention')),
        ),
        h(
          'tbody',
          {},
          top.map((r) => {
            const v = pub[r.video];
            return h(
              'tr',
              {},
              h('td', {}, h('div', { class: 'vid' }, h('img', { src: v?.thumb ?? `https://i.ytimg.com/vi/${r.video}/mqdefault.jpg`, alt: '', loading: 'lazy' }), h('div', {}, h('a', { href: `https://www.youtube.com/watch?v=${r.video}`, target: '_blank' }, v?.title ?? r.video), v && h('div', { class: 'muted small' }, ageText(v.publishedAt))))),
              h('td', {}, fmtNum(r.views)),
              h('td', {}, `${fmtNum(r.estimatedMinutesWatched / 60)} h`),
              h('td', {}, fmtPct(r.averageViewPercentage / 100, 1)),
              h('td', {}, dur(r.averageViewDuration)),
              h('td', {}, fmtNum(r.subscribersGained)),
              hasCtr && h('td', {}, fmtNum(r.videoThumbnailImpressions)),
              hasCtr && h('td', {}, r.videoThumbnailImpressionsClickRate == null ? '—' : `${Number(r.videoThumbnailImpressionsClickRate).toFixed(1)}%`),
              h('td', {}, h('span', { class: `pill tier-${tier(v?.multiplier)}` }, fmtMult(v?.multiplier))),
              h(
                'td',
                {},
                h('input', {
                  type: 'checkbox',
                  class: 'pick',
                  'aria-label': 'Show retention',
                  checked: state.selected.includes(r.video),
                  onchange: (e) => {
                    if (e.target.checked) state.selected = [...state.selected, r.video].slice(-3);
                    else state.selected = state.selected.filter((id) => id !== r.video);
                    loadRetention(top, pub);
                    for (const box of document.querySelectorAll('.pick')) box.checked = state.selected.includes(box.closest('tr').dataset.id);
                  },
                }),
              ),
            );
          }).map((tr, i) => {
            tr.dataset.id = top[i].video;
            return tr;
          }),
        ),
      ),
    ),
  );
}

function retentionCard() {
  return h('section', { class: 'card', id: 'retention' }, h('h3', {}, 'Audience retention'), h('div', { class: 'loading' }, 'Loading retention…'));
}

const TRAFFIC = {
  YT_SEARCH: 'YouTube search', SUGGESTED: 'Suggested videos', BROWSE: 'Browse features', EXT_URL: 'External',
  NO_LINK_OTHER: 'Direct / unknown', PLAYLIST: 'Playlists', YT_CHANNEL: 'Channel pages', NOTIFICATION: 'Notifications',
  SUBSCRIBER: 'Subscriptions', SHORTS: 'Shorts feed', END_SCREEN: 'End screens', ANNOTATION: 'Cards & annotations',
  YT_OTHER_PAGE: 'Other YouTube pages', ADVERTISING: 'Ads', HASHTAGS: 'Hashtags', SOUND_PAGE: 'Sound pages',
  RELATED_VIDEO: 'Related video', CAMPAIGN_CARD: 'Campaign cards', LIVE_REDIRECT: 'Live redirect', YT_PLAYLIST_PAGE: 'Playlist pages',
};

async function loadRetention(top, pub) {
  const card = $('retention');
  if (!card) return;
  if (!state.selected.length) return card.replaceChildren(h('h3', {}, 'Audience retention'), h('p', { class: 'muted' }, 'Tick a video below to see its retention.'));
  const vids = state.selected.map((id) => ({ id, pub: pub[id], row: top.find((r) => r.video === id) }));
  let curves;
  let traffic;
  try {
    [curves, traffic] = await Promise.all([
      Promise.all(vids.map((v) => send({ type: 'myRetention', id: v.id, publishedAt: v.pub?.publishedAt }))),
      send({ type: 'myTraffic', days: state.days, id: vids[0].id }),
    ]);
  } catch (err) {
    return card.replaceChildren(h('h3', {}, 'Audience retention'), errorBox(err));
  }
  const name = (v) => (v.pub?.title ?? v.id).slice(0, 48);
  const primaryDuration = vids[0].pub?.durationSec;
  const xFormat = vids.length === 1 && primaryDuration ? (x) => formatTime((x / 100) * primaryDuration) : (x) => `${Math.round(x)}%`;
  const sum = retentionSummary(curves[0]);
  const at = (ratio) => (vids.length === 1 && primaryDuration ? formatTime(ratio * primaryDuration) : `${Math.round(ratio * 100)}%`);
  const totalTraffic = traffic.reduce((n, t) => n + t.views, 0) || 1;

  card.replaceChildren(
    h('h3', {}, 'Audience retention'),
    h(
      'div',
      { class: 'ret-grid' },
      h(
        'div',
        {},
        lineChart({
          label: 'Audience retention',
          series: vids.map((v, i) => ({ name: name(v), color: COLORS[i], points: curves[i].map((p) => ({ x: p.ratio * 100, y: p.watch * 100 })) })),
          xFormat,
          yFormat: (y) => `${Math.round(y)}%`,
          yMax: Math.ceil(Math.max(100, ...curves.flat().map((p) => p.watch * 100)) / 25) * 25,
          yTicks: (top) => top / 25,
        }),
        h('h3', { style: 'margin-top:16px' }, 'Compared with YouTube videos of similar length'),
        lineChart({
          label: 'Relative retention',
          height: 140,
          series: vids.map((v, i) => ({ name: name(v), color: COLORS[i], points: curves[i].map((p) => ({ x: p.ratio * 100, y: p.relative })) })),
          xFormat,
          yFormat: (y) => y.toFixed(2),
          yMax: 1,
          refLine: { y: 0.5, label: 'typical' },
        }),
        h('p', { class: 'muted small' }, 'Above 0.5 means this moment holds viewers better than most YouTube videos of the same length; 1.0 is the best.'),
      ),
      h(
        'div',
        {},
        h('h3', {}, name(vids[0])),
        sum &&
          h(
            'div',
            { class: 'facts' },
            h('div', { class: 'f' }, h('span', {}, 'Still watching at 10%'), h('b', {}, fmtPct(sum.at10))),
            h('div', { class: 'f' }, h('span', {}, 'At the halfway point'), h('b', {}, fmtPct(sum.at50))),
            h('div', { class: 'f' }, h('span', {}, 'At 90%'), h('b', {}, fmtPct(sum.at90))),
            sum.steepestDrop && h('div', { class: 'f' }, h('span', {}, 'Steepest drop'), h('b', {}, `${at(sum.steepestDrop.ratio)} (−${fmtPct(sum.steepestDrop.drop, 1)})`)),
            sum.rewatchMoments.length > 0 && h('div', { class: 'f' }, h('span', {}, 'Rewatched moments'), h('b', {}, sum.rewatchMoments.slice(0, 3).map(at).join(', '))),
            h('div', { class: 'f' }, h('span', {}, 'Avg vs similar length'), h('b', {}, sum.relative == null ? '—' : sum.relative.toFixed(2))),
            vids[0].row && h('div', { class: 'f' }, h('span', {}, 'Avg % viewed (period)'), h('b', {}, fmtPct(vids[0].row.averageViewPercentage / 100, 1))),
          ),
        h('h3', { style: 'margin-top:16px' }, `Traffic sources, last ${state.days} days`),
        h(
          'div',
          { class: 'bars' },
          traffic.slice(0, 8).map((t) =>
            h(
              'div',
              { class: 'bar', title: `${t.views.toLocaleString()} views` },
              h('span', {}, TRAFFIC[t.insightTrafficSourceType] ?? t.insightTrafficSourceType),
              h('div', { class: 'track' }, h('div', { class: 'fill', style: `width:${(t.views / totalTraffic) * 100}%` })),
              h('span', { class: 'num' }, fmtPct(t.views / totalTraffic)),
            ),
          ),
        ),
      ),
    ),
  );
}

// ---------- Compare ----------

const COLS = [
  { key: 'subs', label: 'Subscribers', fmt: fmtNum },
  { key: 'medianLong', label: 'Median views', fmt: fmtNum, title: 'Median views of the last 30 long-form videos (older than 3 days)' },
  { key: 'medianShort', label: 'Median Shorts views', fmt: fmtNum },
  { key: 'uploadsPerWeek', label: 'Uploads / week', fmt: (x) => (x == null ? '—' : x.toFixed(1)) },
  { key: 'hitRate', label: 'Hit rate', fmt: (x) => fmtPct(x), title: 'Share of recent long-form videos at 2x+ the channel\'s own median' },
  { key: 'momentum', label: 'Trend', fmt: (x, r) => (x == null ? '—' : `${{ growing: '↑', stable: '→', declining: '↓' }[r.trend] ?? ''} ${fmtMult(x)}`), title: 'Median views of the last ~10 uploads ÷ the ones before' },
  { key: 'viewsPerSub', label: 'Views / sub', fmt: (x) => fmtPct(x), title: 'Median long-form views ÷ subscribers: how far videos reach beyond the subscriber base' },
  { key: 'likeRate', label: 'Like rate', fmt: (x) => fmtPct(x, 1) },
];

function insights(mine, others) {
  if (!mine || !others.length) return null;
  const lines = [];
  const say = (key, what) => {
    const peer = median(others.map((o) => o[key]));
    if (mine[key] == null || !peer) return;
    const r = mine[key] / peer;
    lines.push(`Your ${what} is ${fmtMult(r)} the competitor median (${COLS.find((c) => c.key === key).fmt(mine[key], mine)} vs ${COLS.find((c) => c.key === key).fmt(peer, {})}).`);
  };
  say('medianLong', 'median views per video');
  say('uploadsPerWeek', 'upload rate');
  say('hitRate', 'outlier hit rate');
  say('viewsPerSub', 'reach beyond subscribers');
  say('likeRate', 'like rate');
  return lines.length ? h('ul', { class: 'insights' }, lines.map((l) => h('li', {}, l))) : null;
}

async function renderCompare() {
  loading('Comparing channels…');
  let rows;
  try {
    rows = await send({ type: 'compare' });
  } catch (err) {
    return main.replaceChildren(errorBox(err));
  }
  const auth = state.auth ?? (await send({ type: 'authStatus' }));
  const mine = rows.find((r) => r.mine);
  const others = rows.filter((r) => !r.mine && !r.error);
  const key = state.compareSort;
  const sorted = [...rows].sort((a, b) => (b[key] ?? -1) - (a[key] ?? -1));
  const input = h('input', { placeholder: '@handle, channel URL or ID', class: 'grow', style: 'max-width:420px' });
  const meInput = h('input', { placeholder: 'Your channel @handle', style: 'max-width:280px' });
  const msg = h('span', { class: 'muted small' });

  main.replaceChildren(
    h(
      'section',
      { class: 'card' },
      h('h2', {}, 'Compare channels'),
      h('p', { class: 'muted small' }, 'Every number comes from public data with the same math for every channel, your own included. Watched channels also feed the Radar.'),
      h(
        'form',
        {
          class: 'row',
          onsubmit: async (e) => {
            e.preventDefault();
            msg.textContent = 'Adding…';
            try {
              await send({ type: 'watch', input: input.value });
              renderCompare();
            } catch (err) {
              msg.textContent = err.message;
            }
          },
        },
        input,
        h('button', { class: 'primary', type: 'submit' }, 'Watch channel'),
        msg,
      ),
      !auth.signedIn &&
        !mine &&
        h(
          'form',
          {
            class: 'row',
            style: 'margin-top:10px',
            onsubmit: async (e) => {
              e.preventDefault();
              try {
                await send({ type: 'setCompareAs', input: meInput.value });
                renderCompare();
              } catch (err) {
                msg.textContent = err.message;
              }
            },
          },
          h('span', { class: 'muted small' }, 'Not signed in? Compare as:'),
          meInput,
          h('button', { type: 'submit' }, 'Set as my channel'),
        ),
    ),
    rows.length
      ? h(
          'section',
          { class: 'card' },
          h(
            'div',
            { class: 'table-wrap' },
            h(
              'table',
              {},
              h(
                'thead',
                {},
                h(
                  'tr',
                  {},
                  h('th', {}, 'Channel'),
                  COLS.map((c) => h('th', { class: key === c.key ? 'sorted' : '', title: c.title, onclick: () => { state.compareSort = c.key; renderCompare(); } }, c.label)),
                  h('th', {}, ''),
                ),
              ),
              h(
                'tbody',
                {},
                sorted.map((r) =>
                  h(
                    'tr',
                    { class: r.mine ? 'mine' : '' },
                    h('td', {}, h('div', { class: 'ch' }, r.thumb && h('img', { src: r.thumb, alt: '' }), h('a', { href: `https://www.youtube.com/channel/${r.id}`, target: '_blank' }, r.title ?? r.id), r.mine && h('span', { class: 'muted small' }, '(you)'))),
                    r.error ? h('td', { colspan: COLS.length }, r.error) : COLS.map((c) => h('td', {}, c.fmt(r[c.key], r))),
                    h('td', {}, r.mine ? '' : h('button', { class: 'x', title: 'Stop watching', onclick: async () => { await send({ type: 'unwatch', id: r.id }); renderCompare(); } }, '✕')),
                  ),
                ),
                others.length > 1 &&
                  h('tr', { class: 'summary' }, h('td', {}, 'Competitor median'), COLS.map((c) => h('td', {}, c.fmt(median(others.map((o) => o[c.key])), {}))), h('td', {})),
              ),
            ),
          ),
          insights(mine, others),
        )
      : emptyState('Compare yourself with the channels you follow', 'Follow a few channels you learn from or compete with (above, or on Following). Each one is measured with the same math as yours: median views, upload rate, hit rate and trend.', [{ label: 'Go to Following', href: '../channels/channels.html', primary: true }]),
  );
}

// ---------- Radar ----------

let radarFilter = '';
async function renderRadar() {
  const { radar: all = [], radarCheckedAt, watchlist = {}, keywordAlerts = {} } = await chrome.storage.local.get(['radar', 'radarCheckedAt', 'watchlist', 'keywordAlerts']);
  const saved = new Set(await send({ type: 'savedIds' }).catch(() => []));
  const n = Object.keys(watchlist).length;
  const kws = Object.values(keywordAlerts);
  const radar = all.filter((r) => !radarFilter || (radarFilter === 'keyword' ? r.source?.type === 'keyword' : r.source?.type !== 'keyword'));
  const status = h('span', { class: 'muted small' }, radarCheckedAt ? `Checked ${new Date(radarCheckedAt).toLocaleString()}. ` : 'Not checked yet. ', `Following ${n} channel${n === 1 ? '' : 's'} and ${kws.length} keyword${kws.length === 1 ? '' : 's'}; checks run daily.`);
  const kwInput = h('input', { placeholder: 'Add a keyword to watch…', style: 'min-width:220px' });
  main.replaceChildren(
    h(
      'section',
      { class: 'card' },
      h('div', { class: 'row' }, h('h2', { class: 'grow' }, 'Outlier radar'),
        h('button', { onclick: async (e) => { e.target.disabled = true; e.target.textContent = 'Checking…'; try { await send({ type: 'radarCheck' }); } catch (err) { alert(err.message); } renderRadar(); } }, 'Check now'),
        h('button', { onclick: async () => { await send({ type: 'radarRead' }); renderRadar(); } }, 'Mark all read'),
        h('button', { onclick: async () => { if (confirm('Clear the radar feed?')) { await send({ type: 'radarClear' }); renderRadar(); } } }, 'Clear')),
      status,
      h('p', { class: 'muted small' }, 'New outliers (2x+ their channel\'s median): recent uploads from channels you follow, and new videos from the last 30 days for keywords you follow.'),
      h('div', { class: 'row' },
        h('div', { class: 'seg' }, [['', 'All'], ['channel', 'Channels'], ['keyword', 'Keywords']].map(([f, l]) => h('button', { class: radarFilter === f ? 'on' : '', onclick: () => { radarFilter = f; renderRadar(); } }, l))),
        h('span', { class: 'grow' }),
        kws.map((k) => h('span', { class: 'pill tier-none', title: `${k.found ?? 0} alerts so far${k.lastChecked ? ` · checked ${new Date(k.lastChecked).toLocaleDateString()}` : ''}` }, `🔔 ${k.keyword} `, h('button', { class: 'x', title: 'Stop watching this keyword', onclick: async () => { await send({ type: 'unfollowKeyword', keyword: k.keyword }); renderRadar(); } }, '✕'))),
        h('form', { class: 'row', onsubmit: async (e) => { e.preventDefault(); try { await send({ type: 'followKeyword', keyword: kwInput.value }); renderRadar(); } catch (err) { alert(err.message); } } }, kwInput, h('button', { type: 'submit' }, 'Watch keyword'))),
    ),
    radar.length
      ? h(
          'div',
          { class: 'feed' },
          radar.map((r) =>
            h(
              'div',
              { class: 'item' },
              h('a', { href: videoUrl(r), target: '_blank', onclick: () => send({ type: 'radarRead', ids: [r.id] }) }, h('img', { src: r.thumb, alt: '', loading: 'lazy' })),
              h(
                'div',
                {},
                h('a', { class: 't', href: videoUrl(r), target: '_blank', onclick: () => send({ type: 'radarRead', ids: [r.id] }) }, !r.read && h('span', { class: 'new' }, 'NEW'), r.title || r.id),
                h('div', { class: 'm' }, `${r.source?.type === 'keyword' ? `🔔 "${r.source.keyword}" · ` : ''}${r.channelTitle} · ${fmtNum(r.views)} views · ${ageText(r.publishedAt)} · median ${fmtNum(r.baselineMedian)}`),
              ),
              h('span', { class: `pill tier-${tier(r.multiplier)}` }, fmtMult(r.multiplier)),
              h(
                'button',
                {
                  disabled: saved.has(r.id),
                  onclick: async (e) => {
                    await send({ type: 'saveIdea', video: { ...r, channelId: r.channelId, channelTitle: r.channelTitle } });
                    e.target.textContent = '★ Saved';
                    e.target.disabled = true;
                  },
                },
                saved.has(r.id) ? '★ Saved' : '☆ Save idea',
              ),
            ),
          ),
        )
      : n
        ? emptyState('No new outliers yet', 'The radar checks the channels and keywords you follow once a day and lists new uploads already at 2x their channel\'s median. Check back tomorrow, or click Check now.')
        : emptyState('Nothing to watch yet', 'Follow channels (or add a keyword above) and the radar checks them daily for new uploads that are already outperforming their channel.', [{ label: 'Follow channels', href: '../channels/channels.html', primary: true }, { label: 'Keyword explorer', href: '../explore/explore.html' }]),
  );
}

// ---------- AI helpers ----------

function mdBlock(text) {
  const div = h('div', { class: 'md' });
  div.innerHTML = markdownToHtml(text); // escapes everything first
  return div;
}

/** Runs an AI prompt into `box`, saving the result to "Past AI results". */
async function runAi(box, btn, title, build) {
  const ai = await activeAi();
  if (!ai) {
    box.replaceChildren(
      h('p', { class: 'muted' }, 'AI is optional. Connect Gemini, OpenAI, Claude or OpenRouter in ', h('a', { href: '../options/options.html', target: '_blank' }, 'Settings'), ' to use it.'),
    );
    return;
  }
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Thinking…';
  box.replaceChildren(h('div', { class: 'loading' }, `Asking ${PROVIDERS[ai.provider].label} (${ai.model})…`));
  try {
    const { system, prompt } = build(ai.niche);
    const text = await generate({ ...ai, system, prompt });
    await send({ type: 'saveAiRun', run: { title, text, provider: ai.provider, model: ai.model } });
    box.replaceChildren(
      h('div', { class: 'row' }, h('h3', { class: 'grow' }, title), h('span', { class: 'muted small' }, `${PROVIDERS[ai.provider].label} · ${ai.model}`),
        h('button', { onclick: (e) => navigator.clipboard.writeText(text).then(() => (e.target.textContent = 'Copied')) }, 'Copy')),
      mdBlock(text),
    );
  } catch (err) {
    box.replaceChildren(errorBox(err));
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

let gapCache = null;
async function loadGapData(force = false) {
  if (!gapCache || force) gapCache = await send({ type: 'gapData' });
  return gapCache;
}

const openExplorer = (q) => send({ type: 'openExplorer', keyword: q });

// ---------- Content gaps ----------

async function renderGaps() {
  loading('Collecting outliers from the channels you watch…');
  let data;
  try {
    data = await loadGapData();
  } catch (err) {
    return main.replaceChildren(errorBox(err));
  }
  if (!data.watched) {
    return main.replaceChildren(
      h('section', { class: 'card' }, h('h2', {}, 'Content gaps'), h('p', { class: 'muted' }, 'Watch a few competitor channels on the Compare tab first. Gaps are topics that keep producing outliers for them but that you haven\'t covered.'),
        h('button', { class: 'primary', onclick: () => setTab('compare') }, 'Go to Compare')),
    );
  }
  const saved = new Set(await send({ type: 'savedIds' }).catch(() => []));
  const gaps = contentGaps(data.outliers, data.mine.map((m) => m.title), { all: data.allTitles });
  const aiBox = h('div', { class: 'ai-out' });
  const aiBtn = h('button', {
    class: 'primary',
    onclick: () =>
      runAi(aiBox, aiBtn, 'Content gaps', (niche) => gapsPrompt(data.outliers, data.mine.map((m) => m.title), niche)),
  }, 'Find gaps with AI');

  main.replaceChildren(
    h(
      'section',
      { class: 'card' },
      h('div', { class: 'row' }, h('h2', { class: 'grow' }, 'Content gaps'),
        h('button', { onclick: async () => { gapCache = null; renderGaps(); } }, 'Refresh'), aiBtn),
      h('p', { class: 'muted small' },
        `${data.outliers.length} outliers (2x+) among the recent uploads of ${data.watched} watched channel${data.watched === 1 ? '' : 's'}, compared with your ${data.mine.length} recent titles.`,
        !data.myId && ' Set your channel on the Compare tab (or sign in) so topics you already covered are left out.'),
      aiBox,
    ),
    gaps.length
      ? h(
          'div',
          { class: 'gaps' },
          gaps.map((g) =>
            h(
              'section',
              { class: 'gap' },
              h(
                'div',
                { class: 'gap-head' },
                h('h3', {}, g.topic),
                h(
                  'span',
                  { class: 'muted small grow', title: g.lift ? 'Lift: how much more often this topic appears in outliers than in ordinary uploads' : '' },
                  `${g.videos.length} outlier${g.videos.length > 1 ? 's' : ''} · ${g.channels.join(', ')} · best ${fmtMult(g.videos[0].multiplier)}${g.lift ? ` · ${g.lift.toFixed(1)}x more common in outliers` : ''}`,
                ),
                h('button', { onclick: () => openExplorer(g.topic), title: 'Start a keyword rabbit hole from this topic' }, 'Explore keyword'),
                h('button', {
                  title: 'Create a video project for this gap',
                  onclick: async () => {
                    const p = await send({ type: 'projectCreate', data: { title: g.topic.replace(/\b\w/g, (c) => c.toUpperCase()), angle: `Content gap: ${g.videos.length} competitor outliers (best ${fmtMult(g.videos[0].multiplier)}) cover this; I haven't yet.`, source: { type: 'gap', topic: g.topic } } });
                    location.href = `../project/project.html?id=${p.id}`;
                  },
                }, 'Start project'),
              ),
              h(
                'div',
                { class: 'ev' },
                g.videos.slice(0, 4).map((v) =>
                  h(
                    'div',
                    { class: 'evr' },
                    h('img', { src: v.thumb, alt: '', loading: 'lazy' }),
                    h('a', { href: videoUrl(v), target: '_blank' }, v.title, h('span', { class: 'muted small' }, ` · ${v.channelTitle} · ${fmtNum(v.views)} views · ${ageText(v.publishedAt)}`)),
                    h('span', { class: `pill tier-${tier(v.multiplier)}` }, fmtMult(v.multiplier)),
                    h('button', {
                      disabled: saved.has(v.id),
                      onclick: async (e) => { await send({ type: 'saveIdea', video: v, foundVia: { keyword: g.topic, path: ['content gap', g.topic] } }); e.target.textContent = '★ Saved'; e.target.disabled = true; },
                    }, saved.has(v.id) ? '★ Saved' : '☆ Save'),
                  ),
                ),
              ),
            ),
          ),
        )
      : h('p', { class: 'muted' }, 'No clear gaps yet: either you already cover what works for these channels, or they need more outliers. Try watching more channels.'),
  );
}

// ---------- Title lab ----------

async function provenTitles() {
  const ideas = Object.values((await chrome.storage.local.get('ideas')).ideas ?? {}).map((i) => ({ title: i.title, multiplier: i.stats?.multiplier ?? i.multiplier, source: 'saved idea', id: i.id, format: i.format }));
  let theirs = [];
  try {
    theirs = (await loadGapData()).outliers.map((o) => ({ title: o.title, multiplier: o.multiplier, source: o.channelTitle, id: o.id, format: o.format }));
  } catch {}
  const seen = new Set();
  return [...ideas, ...theirs].filter((t) => t.title && t.multiplier >= 1.5 && !seen.has(t.id) && seen.add(t.id));
}

function titleCard(result, proven, { thumbnailText }) {
  const sym = { true: ['✓', 'ok'], false: ['✗', 'no'], null: ['–', 'na'] };
  const sim = similarTitles(result.title, proven);
  return h(
    'div',
    { class: 'tcard' },
    h(
      'div',
      { class: 'mock' },
      h('div', { class: 'thumb' }, thumbnailText || 'thumbnail'),
      h('div', { class: 'tt' }, result.title),
      h('div', { class: 'meta' }, 'Your channel · 12K views · 2 days ago'),
      h('div', { class: 'search' }, result.title),
      h('div', { class: 'cap' }, 'Home feed (2 lines) and a one-line search result, at phone width'),
    ),
    h(
      'div',
      {},
      h('div', { class: 'tscore' }, h('b', {}, result.score), ' / 100 on the packaging checklist'),
      h('ul', { class: 'checks' }, result.checks.map((c) => {
        const [mark, cls] = sym[String(c.pass)];
        return h('li', {}, h('span', { class: cls }, mark), h('span', {}, c.label, h('div', { class: 'why' }, c.detail)));
      })),
      h(
        'div',
        { class: 'similar' },
        h('b', {}, 'Closest proven outliers'),
        sim.length
          ? sim.map((s) => h('div', {}, h('span', { class: `pill tier-${tier(s.multiplier)}` }, fmtMult(s.multiplier)), h('span', {}, s.title), h('span', { class: 'muted' }, ` · ${[...s.sharedFeatures, ...s.sharedWords].slice(0, 4).join(', ')}`)))
          : h('div', { class: 'muted' }, 'None of your saved or competitor outliers look like this one.'),
      ),
    ),
  );
}

async function renderTitles() {
  const { titleLab = {} } = await chrome.storage.local.get('titleLab');
  const drafts = h('textarea', { placeholder: 'One title per line, e.g.\nI Lived on $10 a Day in Tokyo\nTokyo on a budget: full guide', value: titleLab.drafts ?? '' });
  const keyword = h('input', { placeholder: 'e.g. tokyo budget travel', value: titleLab.keyword ?? '' });
  const thumb = h('input', { placeholder: 'e.g. NEVER AGAIN', value: titleLab.thumbnailText ?? '' });
  const cards = h('div', { class: 'tcards' });
  const aiBox = h('div', { class: 'ai-out' });
  let proven = [];

  const read = () => ({
    titles: drafts.value.split('\n').map((t) => t.trim()).filter(Boolean).slice(0, 10),
    keyword: keyword.value.trim(),
    thumbnailText: thumb.value.trim(),
  });
  const update = () => {
    const { titles, keyword: kw, thumbnailText } = read();
    chrome.storage.local.set({ titleLab: { drafts: drafts.value, keyword: kw, thumbnailText } });
    const results = titles.map((t) => titleChecks(t, { keyword: kw, thumbnailText })).sort((a, b) => b.score - a.score);
    cards.replaceChildren(...(results.length ? results.map((r) => titleCard(r, proven, { thumbnailText })) : [h('p', { class: 'muted' }, 'Type a few title ideas to test them.')]));
  };
  let timer;
  for (const el of [drafts, keyword, thumb]) el.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(update, 250); });

  const aiBtn = h('button', {
    type: 'button',
    class: 'primary',
    onclick: () => {
      const { titles, keyword: kw, thumbnailText } = read();
      if (!titles.length) return;
      runAi(aiBox, aiBtn, `Title lab: ${titles[0].slice(0, 40)}`, (niche) => titlesPrompt(titles, proven, niche, { keyword: kw, thumbnailText }));
    },
  }, 'Improve with AI');

  main.replaceChildren(
    h(
      'div',
      { class: 'lab' },
      h(
        'form',
        { class: 'card', onsubmit: (e) => e.preventDefault() },
        h('h2', {}, 'Title lab'),
        h('p', { class: 'muted small' }, 'Test draft titles against a packaging checklist and your proven outliers (saved ideas plus competitor outliers). The checklist is guidance, not a CTR prediction.'),
        h('label', {}, 'Draft titles', drafts),
        h('label', {}, 'Target keyword (optional)', keyword),
        h('label', {}, 'Thumbnail text (optional)', thumb),
        aiBtn,
        h('span', { class: 'muted small', id: 'proven-count' }, 'Loading proven outliers…'),
      ),
      h('div', {}, aiBox, cards),
    ),
  );
  update();
  proven = await provenTitles();
  const counter = document.getElementById('proven-count');
  if (counter) counter.textContent = `${proven.length} proven outlier titles to compare against.`;
  update();
}

async function updateCount() {
  const { radar = [] } = await chrome.storage.local.get('radar');
  const unread = radar.filter((r) => !r.read).length;
  $('radar-count').textContent = unread ? String(unread) : '';
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.radar) updateCount();
});

updateCount();
setTab(['mine', 'compare', 'radar', 'gaps', 'titles'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'mine');
