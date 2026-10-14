// Channel analysis modal + the "Analyze channel" button on channel pages.
YTK.channelPanel = (() => {
  const { h } = YTK;
  let host = null;
  let root = null;
  let fab = null;
  let state = null; // { ref, data, tab, sort, minMult, query }
  let token = 0;

  const CSS = `
    ${YTK.panelCss}
    .backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.55); z-index: 9999; display: flex; align-items: center; justify-content: center; padding: 24px; }
    .dialog { background: var(--bg); width: min(980px, 100%); height: min(88vh, 900px); border-radius: 16px; box-shadow: var(--shadow); display: flex; flex-direction: column; overflow: hidden; }
    header { display: flex; align-items: center; gap: 12px; padding: 16px 20px; border-bottom: 1px solid var(--border); }
    header img { width: 44px; height: 44px; border-radius: 50%; }
    .title { flex: 1; min-width: 0; }
    .title a { color: var(--fg); text-decoration: none; font-size: 18px; font-weight: 700; }
    .title .muted { font-size: 12px; }
    .cards { display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; padding: 14px 20px 6px; }
    .card { background: var(--bg-2); border-radius: 10px; padding: 9px 11px; }
    .card .k { color: var(--fg-2); font-size: 11px; }
    .card .v { font-size: 17px; font-weight: 700; font-variant-numeric: tabular-nums; }
    .toolbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 10px 20px; border-bottom: 1px solid var(--border); }
    .tabs, .seg { display: inline-flex; background: var(--bg-2); border-radius: 18px; padding: 3px; }
    .tabs button, .seg button { border: 0; background: transparent; padding: 5px 11px; border-radius: 15px; font-weight: 500; color: var(--fg-2); }
    .tabs button.on, .seg button.on { background: var(--bg); color: var(--fg); box-shadow: 0 1px 2px rgba(0,0,0,.15); }
    select, input { font: inherit; color: var(--fg); background: var(--bg-2); border: 1px solid var(--border); border-radius: 18px; padding: 6px 12px; }
    input { flex: 1; min-width: 140px; }
    .list { flex: 1; overflow: auto; padding: 4px 12px 12px; }
    .row { display: grid; grid-template-columns: 128px 1fr auto auto; gap: 14px; align-items: center; padding: 8px; border-radius: 10px; }
    .row:hover { background: var(--bg-2); }
    .row img { width: 128px; aspect-ratio: 16/9; object-fit: cover; border-radius: 8px; display: block; background: var(--bg-3); }
    .row a { color: var(--fg); text-decoration: none; font-weight: 500; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .row a:hover { color: var(--accent); }
    .row .meta { color: var(--fg-2); font-size: 12px; margin-top: 2px; }
    .row .pill { font-size: 14px; min-width: 56px; text-align: center; }
    .star.on { color: #b58900; }
    .empty, .loading, .error { padding: 48px; text-align: center; }
    footer { padding: 8px 20px; border-top: 1px solid var(--border); color: var(--fg-2); font-size: 11px; }
    @media (max-width: 720px) { .cards { grid-template-columns: repeat(3, 1fr); } .row { grid-template-columns: 96px 1fr auto; } .row img { width: 96px; } .row .star { display: none; } }
  `;

  const FAB_CSS = `
    ${YTK.panelCss}
    button { position: fixed; right: 24px; bottom: 24px; z-index: 2100; display: inline-flex; gap: 8px; align-items: center;
      padding: 11px 18px; border-radius: 24px; border: 0; background: var(--fg); color: var(--bg); font-weight: 600;
      box-shadow: var(--shadow); }
    button:hover { opacity: .9; }
  `;

  function ensureHost() {
    if (!host) {
      host = h('div', { id: 'ytk-channel-panel' });
      root = host.attachShadow({ mode: 'open' });
    }
    if (!host.isConnected) document.body.append(host);
  }

  function onKey(e) {
    if (e.key === 'Escape') close();
  }

  async function open(ref, { fresh = false } = {}) {
    ensureHost();
    document.addEventListener('keydown', onKey, true);
    state = { ref, data: null, tab: 'long', sort: 'mult', minMult: 0, query: '' };
    const mine = ++token;
    paint(h('div', { class: 'loading muted' }, 'Fetching the latest uploads…'));
    try {
      const data = await YTK.send({ type: 'analyzeChannel', ref, fresh });
      if (mine !== token) return;
      state.data = data;
      if (!data.long.videos.length && data.short.videos.length) state.tab = 'short';
      render();
    } catch (err) {
      if (mine !== token) return;
      paint(h('div', { class: 'error' }, err.message));
    }
  }

  function close() {
    token++;
    state = null;
    document.removeEventListener('keydown', onKey, true);
    host?.remove();
  }

  // Wraps content in the dialog chrome.
  function paint(...body) {
    const c = state?.data?.channel;
    const dialog = h(
      'div',
      { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Channel analysis' },
      h(
        'header',
        {},
        c?.thumb && h('img', { src: c.thumb, alt: '' }),
        h(
          'div',
          { class: 'title' },
          c
            ? h('a', { href: `/channel/${c.id}` }, c.title)
            : h('span', { style: 'font-size:18px;font-weight:700' }, 'Channel analysis'),
          c &&
            h(
              'div',
              { class: 'muted' },
              [
                c.handle,
                c.subs == null ? 'subscribers hidden' : `${YTK.fmtNum(c.subs)} subscribers`,
                `${YTK.fmtNum(c.videoCount)} videos`,
                `${YTK.fmtNum(c.totalViews)} total views`,
              ]
                .filter(Boolean)
                .join(' · '),
            ),
        ),
        state?.data &&
          h(
            'button',
            {
              class: 'btn',
              title: 'Follow to track its growth and new uploads, compare it with yours, and get radar alerts for its outliers',
              onclick: async (e) => {
                const btn = e.currentTarget;
                btn.disabled = true;
                try {
                  await YTK.send({ type: 'watch', input: c.id });
                  btn.textContent = 'Following ✓';
                } catch (err) {
                  btn.textContent = err.message;
                }
              },
            },
            YTK.following?.has(c.id) ? 'Following ✓' : 'Follow channel',
          ),
        state?.data &&
          h('button', { class: 'icon-btn', title: 'Refresh (uses ~13 quota units)', onclick: () => open(state.ref, { fresh: true }) }, YTK.icon('refresh')),
        h('button', { class: 'icon-btn', title: 'Close (Esc)', onclick: close }, YTK.icon('close')),
      ),
      ...body,
    );
    const backdrop = h('div', { class: 'backdrop', onclick: (e) => e.target === backdrop && close() }, dialog);
    root.replaceChildren(h('style', {}, CSS), backdrop);
  }

  const card = (k, v, title, cls = '') =>
    h('div', { class: 'card', title }, h('div', { class: 'k' }, k), h('div', { class: `v ${cls}` }, v));

  function visibleVideos() {
    const { data, tab, sort, minMult, query } = state;
    const q = query.trim().toLowerCase();
    const list = data[tab].videos.filter(
      (v) => (minMult ? v.multiplier >= minMult : true) && (!q || v.title.toLowerCase().includes(q)),
    );
    const by = {
      mult: (a, b) => (b.multiplier ?? -1) - (a.multiplier ?? -1),
      views: (a, b) => (b.views ?? -1) - (a.views ?? -1),
      new: (a, b) => new Date(b.publishedAt) - new Date(a.publishedAt),
    }[sort];
    return list.sort(by);
  }

  function row(v) {
    const tier = YTK.tier(v.multiplier);
    const saved = YTK.saved.has(v.id);
    const href = v.format === 'short' ? `/shorts/${v.id}` : `/watch?v=${v.id}`;
    return h(
      'div',
      { class: 'row' },
      h('a', { href, tabindex: '-1' }, h('img', { src: v.thumb, alt: '', loading: 'lazy' })),
      h(
        'div',
        {},
        h('a', { href, title: v.title }, v.title),
        h('div', { class: 'meta' }, `${YTK.fmtNum(v.views)} views · ${YTK.fmtAge(v.publishedAt)}`),
      ),
      h('span', { class: `pill tier-${tier}`, title: YTK.tierLabel[tier] }, YTK.fmtMult(v.multiplier)),
      h(
        'button',
        {
          class: `icon-btn star${saved ? ' on' : ''}`,
          title: saved ? 'Remove from saved ideas' : 'Save idea',
          onclick: () => YTK.send(saved ? { type: 'removeIdea', id: v.id } : { type: 'saveIdea', video: v }),
        },
        YTK.icon('star', { filled: saved }),
      ),
    );
  }

  function render() {
    const { data, tab, sort, minMult } = state;
    const s = data[tab].summary;
    const trend = YTK.fmtTrend(s?.trend);
    const segBtn = (label, on, onclick) => h('button', { class: on ? 'on' : '', onclick }, label);
    const set = (patch) => {
      Object.assign(state, patch);
      render();
    };
    const videos = visibleVideos();

    const search = h('input', {
      type: 'search',
      placeholder: 'Filter titles…',
      value: state.query,
      oninput: (e) => {
        state.query = e.target.value;
        const list = root.querySelector('.list');
        const rows = visibleVideos();
        list.replaceChildren(...(rows.length ? rows.map(row) : [h('div', { class: 'empty muted' }, 'No videos match.')]));
      },
    });

    paint(
      h(
        'div',
        { class: 'cards' },
        card('Median views', YTK.fmtNum(s?.baselineMedian), `Baseline: median of the last ${s?.baselineSample ?? 0} videos older than 3 days`),
        card('Average views', YTK.fmtNum(s?.meanViews), `Mean across all ${s?.count ?? 0} fetched videos`),
        card('Uploads / week', s?.uploadsPerWeek == null ? '—' : s.uploadsPerWeek.toFixed(1)),
        card('Avg like rate', YTK.fmtPct(s?.likeRate, 2)),
        card('Outliers ≥ 2x', s ? `${s.outliers2x} / ${s.count}` : '—'),
        card('Channel trend', trend.text, trend.title, trend.cls),
      ),
      h(
        'div',
        { class: 'toolbar' },
        h(
          'div',
          { class: 'tabs' },
          segBtn(`Long-form (${data.long.videos.length})`, tab === 'long', () => set({ tab: 'long' })),
          segBtn(`Shorts (${data.short.videos.length})`, tab === 'short', () => set({ tab: 'short' })),
        ),
        h(
          'select',
          { onchange: (e) => set({ sort: e.target.value }), 'aria-label': 'Sort by' },
          h('option', { value: 'mult', selected: sort === 'mult' }, 'Sort: Outlier score'),
          h('option', { value: 'views', selected: sort === 'views' }, 'Sort: Views'),
          h('option', { value: 'new', selected: sort === 'new' }, 'Sort: Newest'),
        ),
        h(
          'div',
          { class: 'seg' },
          ...[0, 2, 5, 10].map((m) => segBtn(m ? `≥ ${m}x` : 'All', minMult === m, () => set({ minMult: m }))),
        ),
        search,
      ),
      h(
        'div',
        { class: 'list' },
        ...(videos.length ? videos.map(row) : [h('div', { class: 'empty muted' }, 'No videos match.')]),
      ),
      h(
        'footer',
        {},
        `Score = views ÷ median views of this channel's last ${s?.baselineSample ?? 30} ${tab === 'short' ? 'Shorts' : 'long-form videos'} (videos under 3 days old excluded). ` +
          `Fetched ${new Date(data.fetchedAt).toLocaleTimeString()}; cached for 6h.`,
      ),
    );
  }

  // Floating "Analyze channel" button on channel pages.
  function syncFab() {
    const ref = YTK.pageType() === 'channel' ? YTK.channelRefFromPath(location.pathname) : null;
    if (!ref) {
      fab?.remove();
      return;
    }
    if (!fab) {
      fab = h('div', { id: 'ytk-fab' });
      const shadow = fab.attachShadow({ mode: 'open' });
      shadow.append(
        h('style', {}, FAB_CSS),
        h(
          'button',
          { onclick: () => open(YTK.channelRefFromPath(location.pathname)) },
          YTK.icon('chart'),
          'Analyze channel',
        ),
      );
    }
    if (!fab.isConnected) document.body.append(fab);
  }

  document.addEventListener('ytk-saved-changed', () => {
    if (!state?.data || !host?.isConnected) return;
    const list = root.querySelector('.list');
    const scroll = list?.scrollTop ?? 0;
    render();
    const next = root.querySelector('.list');
    if (next) next.scrollTop = scroll;
  });

  return { open, close, syncFab };
})();
