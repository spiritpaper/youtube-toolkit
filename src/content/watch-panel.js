// Performance panel on watch pages (in the sidebar) and Shorts (floating).
YTK.watchPanel = (() => {
  const { h } = YTK;
  let host = null;
  let root = null;
  let currentId = null;
  let report = null;
  let token = 0;
  let collapsed = false;
  let heat; // undefined = loading, null = none, array = points
  let tx = { status: 'idle' }; // transcript capture state
  let notesUi = null; // the notes section, kept across re-renders of the panel

  const CSS = `
    ${YTK.panelCss}
    .card { background: var(--bg); border: 1px solid var(--border); border-radius: 12px; padding: 12px 14px; margin-bottom: 12px; }
    :host(.floating) { position: fixed; top: 72px; right: 16px; width: 300px; z-index: 2100; }
    :host(.floating) .card { box-shadow: var(--shadow); }
    .head { display: flex; align-items: center; gap: 8px; }
    .brand { font-weight: 700; font-size: 12px; letter-spacing: .4px; text-transform: uppercase; color: var(--fg-2); flex: 1; }
    .chip { font-size: 11px; padding: 1px 7px; border-radius: 999px; background: var(--bg-2); color: var(--fg-2); }
    .collapsed .body { display: none; }
    .collapsed .chev { transform: rotate(-90deg); }
    .hero { display: flex; align-items: baseline; gap: 10px; margin: 10px 0 2px; }
    .mult { font-size: 34px; font-weight: 700; line-height: 1; font-variant-numeric: tabular-nums; }
    .verdict { font-weight: 600; }
    .sub { color: var(--fg-2); font-size: 12px; margin-bottom: 10px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 12px; }
    .stat { background: var(--bg-2); border-radius: 8px; padding: 7px 9px; min-width: 0; }
    .stat .k { color: var(--fg-2); font-size: 11px; }
    .stat .v { font-weight: 600; font-size: 14px; font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .actions { display: flex; gap: 8px; flex-wrap: wrap; }
    .actions .btn { flex: 1 1 auto; }
    .btn.saved { color: #b58900; }
    .skeleton { height: 120px; border-radius: 8px; background: linear-gradient(90deg, var(--bg-2), var(--bg-3), var(--bg-2)); background-size: 200% 100%; animation: shimmer 1.2s infinite; margin-top: 10px; }
    @keyframes shimmer { to { background-position: -200% 0; } }
    .error { margin-top: 10px; }
    .section { margin: 0 0 12px; }
    .section-head { display: flex; justify-content: space-between; align-items: baseline; font-weight: 600; font-size: 12px; margin-bottom: 4px; }
    .small { font-size: 11px; font-weight: 400; }
    .heatmap { width: 100%; height: 44px; display: block; background: var(--bg-2); border-radius: 6px; }
    .heatmap path { fill: var(--accent); opacity: .55; }
    .heatmap line { stroke: var(--fg); stroke-width: 1; stroke-dasharray: 2 2; opacity: .6; }
    .peaks { display: flex; gap: 6px; align-items: center; margin-top: 6px; font-size: 12px; color: var(--fg-2); flex-wrap: wrap; }
    .peak { border: 1px solid var(--border); background: var(--bg-2); border-radius: 12px; padding: 1px 8px; font-variant-numeric: tabular-nums; }
    .peak:hover { background: var(--bg-3); }
    .actions + .actions { margin-top: 8px; }
    .notes { margin-top: 12px; border-top: 1px solid var(--border); padding-top: 10px; }
    .notes ol { list-style: none; margin: 6px 0 0; padding: 0; display: grid; gap: 4px; max-height: 220px; overflow: auto; }
    .notes li { display: grid; grid-template-columns: auto 1fr auto; gap: 6px; align-items: start; font-size: 12px; }
    .notes li span { white-space: pre-wrap; overflow-wrap: anywhere; }
    .notes .x { border: 0; background: none; color: var(--fg-2); cursor: pointer; padding: 0 4px; font-size: 12px; }
    .note-form { display: grid; gap: 6px; margin-top: 8px; }
    .note-form .row { display: flex; gap: 6px; align-items: center; }
    .note-form input { width: 64px; }
    .note-form input, .note-form textarea { font: inherit; font-size: 12px; color: var(--fg); background: var(--bg-2); border: 1px solid var(--border); border-radius: 6px; padding: 5px 7px; }
    .note-form textarea { width: 100%; box-sizing: border-box; resize: vertical; min-height: 54px; }
    .note-err { color: #e53935; font-size: 11px; }
    .btn.small-btn { padding: 6px 10px; font-size: 12px; }
  `;

  function container() {
    return (
      document.querySelector('ytd-watch-flexy #secondary-inner') ??
      document.querySelector('ytd-watch-flexy #secondary')
    );
  }

  async function mount(floating) {
    if (!host) {
      host = h('div', { id: 'ytk-watch-panel' });
      root = host.attachShadow({ mode: 'open' });
    }
    host.classList.toggle('floating', floating);
    if (floating) {
      if (host.parentElement !== document.body) document.body.append(host);
      return;
    }
    // The sidebar can take a moment to appear after navigation.
    for (let i = 0; i < 40 && !container(); i++) await new Promise((r) => setTimeout(r, 250));
    const target = container();
    if (!target) {
      host.classList.add('floating');
      document.body.append(host);
    } else if (target.firstElementChild !== host) {
      target.prepend(host);
    }
  }

  function frame(...children) {
    const card = h(
      'div',
      { class: `card${collapsed ? ' collapsed' : ''}` },
      h(
        'div',
        { class: 'head' },
        h('span', { class: 'brand' }, 'YT Toolkit'),
        report && h('span', { class: 'chip' }, report.video.format === 'short' ? 'Short' : 'Long-form'),
        h(
          'button',
          {
            class: 'icon-btn chev',
            title: collapsed ? 'Expand' : 'Collapse',
            onclick: () => {
              collapsed = !collapsed;
              card.classList.toggle('collapsed', collapsed);
            },
          },
          YTK.icon('chevron'),
        ),
      ),
      h('div', { class: 'body' }, ...children),
    );
    // Re-rendering moves the notes section; keep the cursor where it was.
    const active = root.activeElement;
    const keep = active && notesUi?.el.contains(active) ? { el: active, start: active.selectionStart, end: active.selectionEnd } : null;
    root.replaceChildren(h('style', {}, CSS), card);
    if (keep) {
      keep.el.focus({ preventScroll: true });
      if (keep.start != null) keep.el.setSelectionRange(keep.start, keep.end);
    }
  }

  const stat = (k, v, title, cls = '') =>
    h('div', { class: 'stat', title }, h('div', { class: 'k' }, k), h('div', { class: `v ${cls}` }, v));

  const player = () => document.querySelector('#movie_player video, video.html5-main-video, #shorts-player video');
  function seek(sec) {
    const video = player();
    if (video) video.currentTime = sec;
  }

  // ---------- your notes ----------
  // Timestamped notes on this video, shared with the Script lab ("sn:<id>").
  function notesSection(v) {
    if (notesUi?.id === v.id) return notesUi.el;
    let notes = [];
    let form = null; // { t } while the note form is open
    const el = h('div', { class: 'notes' });
    const stop = (e) => e.stopPropagation(); // keep YouTube's k/j/l/f shortcuts out of the text box
    const paint = (err = '') => {
      const list = notes.length
        ? h('ol', {}, notes.map((n) =>
            h('li', {},
              h('button', { class: 'peak', title: 'Jump to this moment', onclick: () => seek(n.t) }, YTK.fmtTime(n.t)),
              h('span', {}, n.text),
              h('button', { class: 'x', title: 'Delete note', 'aria-label': 'Delete note', onclick: () => confirm('Delete this note?') && YTK.send({ type: 'notesDelete', id: v.id, noteId: n.id }).then(load, (e) => paint(e.message)) }, '✕'))))
        : null;
      let body = null;
      if (form) {
        const time = h('input', { 'aria-label': 'Time in the video', title: 'Time in the video', onkeydown: stop, onkeyup: stop, onkeypress: stop });
        time.value = YTK.fmtTime(form.t);
        const text = h('textarea', { placeholder: 'What you noticed at this moment… (Ctrl+Enter to save)', 'aria-label': 'Note', onkeyup: stop, onkeypress: stop });
        text.value = form.text ?? '';
        text.addEventListener('input', () => (form.text = text.value));
        const save = async () => {
          try {
            await YTK.send({ type: 'notesAdd', id: v.id, note: { t: time.value, text: text.value, title: v.title } });
            form = null;
            await load();
          } catch (e) {
            paint(e.message);
          }
        };
        text.addEventListener('keydown', (e) => {
          e.stopPropagation();
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) save();
          if (e.key === 'Escape') {
            form = null;
            paint();
          }
        });
        body = h('div', { class: 'note-form' }, text,
          h('div', { class: 'row' }, 'at', time, h('span', { style: 'flex:1' }), h('button', { class: 'btn small-btn', onclick: () => { form = null; paint(); } }, 'Cancel'), h('button', { class: 'btn small-btn primary', onclick: save }, 'Save')),
          err && h('div', { class: 'note-err' }, err));
        queueMicrotask(() => text.isConnected && root.activeElement !== time && text.focus({ preventScroll: true }));
      } else if (err) {
        body = h('div', { class: 'note-err' }, err);
      }
      el.replaceChildren(
        h('div', { class: 'section-head' },
          h('span', {}, `My notes${notes.length ? ` (${notes.length})` : ''}`),
          h('button', {
            class: 'btn small-btn',
            title: 'Pin a note to the current moment of the video',
            onclick: () => {
              const t = Math.floor(player()?.currentTime ?? 0);
              form = { t, text: form?.text ?? '' };
              paint();
            },
          }, `Add note at ${YTK.fmtTime(Math.floor(player()?.currentTime ?? 0))}`)),
        ...[body, list, !notes.length && !form && h('div', { class: 'muted small' }, 'Notes you add here also show up in the Script lab.')].filter(Boolean));
    };
    const load = async () => {
      const entry = await YTK.send({ type: 'notesGet', id: v.id }).catch(() => null);
      notes = entry?.notes ?? [];
      if (notesUi?.id === v.id) paint();
    };
    // Keep the button's time roughly current while the video plays.
    const tick = setInterval(() => {
      if (!el.isConnected) return clearInterval(tick);
      const btn = el.querySelector('.section-head .btn');
      if (btn) btn.textContent = `Add note at ${YTK.fmtTime(Math.floor(player()?.currentTime ?? 0))}`;
    }, 1000);
    notesUi = { id: v.id, el, load };
    paint();
    load();
    return el;
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && notesUi && changes[`sn:${notesUi.id}`]) notesUi.load();
  });

  function heatSection() {
    if (heat === undefined) return null;
    if (!heat) {
      return h('div', { class: 'section muted small' }, 'No "Most replayed" data for this video yet (it needs more views).');
    }
    const peaks = YTK.heatmapPeaks(heat);
    return h(
      'div',
      { class: 'section' },
      h(
        'div',
        { class: 'section-head' },
        h('span', {}, 'Most replayed'),
        h(
          'span',
          { class: 'muted small', title: "YouTube's replay heatmap: how often each moment is watched, relative to the video's peak. It's not the creator's retention curve, which only they can see." },
          'relative replays',
        ),
      ),
      YTK.heatmapSvg(heat, { peaks }),
      peaks.length &&
        h(
          'div',
          { class: 'peaks' },
          'Peaks:',
          peaks.map((p) => h('button', { class: 'peak', title: 'Jump to this moment', onclick: () => seek(p.start) }, YTK.fmtTime(p.start))),
        ),
    );
  }

  // A short topic to start a keyword rabbit hole from this video.
  function topicOf(v) {
    const tag = (v.tags ?? []).find((t) => t.split(/\s+/).length <= 4);
    if (tag) return tag;
    return v.title
      .replace(/[\[(【].*?[\])】]/g, ' ')
      .replace(/[^\p{L}\p{N}\s']/gu, ' ')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 5)
      .join(' ');
  }

  async function captureTranscript() {
    tx = { status: 'loading' };
    render();
    try {
      const { segments, lang, kind } = await YTK.captureTranscript();
      tx = { status: 'done', segments, lang, kind, saved: false };
    } catch (err) {
      tx = { status: 'error', message: err.message };
    }
    render();
  }

  async function saveTranscript(v, { open = false } = {}) {
    if (!tx.saved) {
      if (!YTK.saved.has(v.id)) await YTK.send({ type: 'saveIdea', video: v });
      await YTK.send({ type: 'saveTranscript', id: v.id, segments: tx.segments, lang: tx.lang, kind: tx.kind });
      tx = { ...tx, saved: true };
      render();
    }
    if (open) await YTK.send({ type: 'openPage', page: 'script', query: `?id=${v.id}` });
  }

  // Optional: download through the companion app (Settings → Downloads).
  function downloadButton(v) {
    const btn = h('button', { class: 'btn small-btn', title: 'Save this video with the companion app (only videos you own or may use)' }, 'Download');
    btn.addEventListener('click', async () => {
      const url = `https://www.youtube.com/watch?v=${v.id}`;
      btn.disabled = true;
      try {
        await YTK.send({ type: 'downloadStart', url, kind: 'video', title: v.title });
        btn.textContent = 'Downloading… (see Downloads)';
        btn.onclick = () => YTK.send({ type: 'openPage', page: 'downloads' });
      } catch (err) {
        // First time, or the companion isn't set up: finish on the Downloads page.
        YTK.send({ type: 'openPage', page: 'downloads', query: `?url=${encodeURIComponent(url)}&title=${encodeURIComponent(v.title)}` });
        btn.textContent = 'Download';
      } finally {
        btn.disabled = false;
      }
    });
    return btn;
  }

  function toolRow(v) {
    const url = `https://www.youtube.com/watch?v=${v.id}`;
    const transcriptButtons =
      v.format === 'short'
        ? []
        : tx.status === 'done'
          ? [
              h(
                'button',
                {
                  class: 'btn small-btn',
                  title: `${tx.segments.length} lines${tx.kind ? ` · ${tx.kind} captions` : ''}${tx.lang ? ` (${tx.lang})` : ''}`,
                  onclick: () =>
                    YTK.download(`${YTK.safeFileName(v.title)}.txt`, YTK.transcriptText(tx.segments, { title: v.title, url })),
                },
                'Download .txt',
              ),
              h(
                'button',
                { class: 'btn small-btn', disabled: tx.saved, onclick: () => saveTranscript(v) },
                tx.saved ? 'Transcript saved' : 'Save transcript',
              ),
              h(
                'button',
                {
                  class: 'btn small-btn',
                  title: 'Hook, attention devices, keywords and structure (saves the idea and transcript)',
                  onclick: () => saveTranscript(v, { open: true }),
                },
                'Analyze script',
              ),
            ]
          : [
              h(
                'button',
                { class: 'btn small-btn', disabled: tx.status === 'loading', onclick: captureTranscript, title: tx.message },
                tx.status === 'loading' ? 'Reading…' : tx.status === 'error' ? 'No transcript' : 'Transcript',
              ),
            ];
    return h(
      'div',
      { class: 'actions' },
      ...transcriptButtons,
      h(
        'button',
        {
          class: 'btn small-btn',
          title: 'Start a keyword rabbit hole from this topic',
          onclick: () => YTK.send({ type: 'openExplorer', keyword: topicOf(v) }),
        },
        'Explore topic',
      ),
      h(
        'button',
        {
          class: 'btn small-btn',
          title: 'Map the videos YouTube suggests around this one',
          onclick: () => YTK.send({ type: 'openPage', page: 'web', query: `?v=${v.id}` }),
        },
        'Video web',
      ),
      YTK.downloadsEnabled && downloadButton(v),
      h(
        'button',
        {
          class: 'btn small-btn',
          title: "What viewers ask, request and struggle with, from this video's top comments (1 API unit, saved)",
          onclick: () => YTK.send({ type: 'openPage', page: 'audience', query: `?v=${v.id}` }),
        },
        'Comments',
      ),
    );
  }

  function render() {
    const { video: v, channel: c, baseline: b } = report;
    const trend = YTK.fmtTrend(report.trend);
    const tier = YTK.tier(v.multiplier);
    const age = YTK.ageDays(v.publishedAt);
    const velocity =
      age < 2
        ? stat('Views / hour', YTK.fmtNum(v.views / Math.max(age * 24, 1)))
        : stat('Views / day', YTK.fmtNum(v.views / age));
    const saved = YTK.saved.has(v.id);
    const formatWord = v.format === 'short' ? 'Shorts' : 'long-form videos';

    frame(
      h(
        'div',
        { class: 'hero' },
        h('span', { class: `mult tier-${tier}` }, YTK.fmtMult(v.multiplier)),
        h('span', { class: `verdict tier-${tier}` }, YTK.tierLabel[tier]),
      ),
      h(
        'div',
        { class: 'sub' },
        b
          ? `vs. median of ${YTK.fmtNum(b.median)} views across the channel's last ${b.sample} ${formatWord}`
          : `This channel has no ${formatWord} to compare against yet.`,
      ),
      h(
        'div',
        { class: 'grid' },
        stat('Views', YTK.fmtNum(v.views), v.views?.toLocaleString()),
        velocity,
        stat('Channel median', YTK.fmtNum(b?.median)),
        stat('Channel average', YTK.fmtNum(b?.mean), 'Mean views of the same videos; one viral hit can skew it.'),
        stat('Like rate', YTK.fmtPct(v.views ? v.likes / v.views : null, 2), `${YTK.fmtNum(v.likes)} likes`),
        stat('Comment rate', YTK.fmtPct(v.views ? v.comments / v.views : null, 2), `${YTK.fmtNum(v.comments)} comments`),
        stat('Subscribers', c.subs == null ? 'Hidden' : YTK.fmtNum(c.subs)),
        stat('Views ÷ subs', !c.subs ? '—' : v.views / c.subs < 10 ? YTK.fmtPct(v.views / c.subs, 0) : YTK.fmtMult(v.views / c.subs)),
        stat('Published', YTK.fmtAge(v.publishedAt), new Date(v.publishedAt).toLocaleString()),
        stat('Channel trend', trend.text, trend.title, trend.cls),
      ),
      heatSection(),
      h(
        'div',
        { class: 'actions' },
        h(
          'button',
          {
            class: `btn${saved ? ' saved' : ''}`,
            onclick: async () => {
              await YTK.send(saved ? { type: 'removeIdea', id: v.id } : { type: 'saveIdea', video: v });
            },
          },
          YTK.icon('star', { filled: saved }),
          saved ? 'Saved' : 'Save idea',
        ),
        h(
          'button',
          {
            class: 'btn',
            title: 'Track this channel: growth, new uploads and outlier alerts',
            onclick: async (e) => {
              const btn = e.currentTarget;
              btn.disabled = true;
              await YTK.send({ type: 'watch', input: c.id }).then(
                () => YTK.following.add(c.id),
                (err) => (btn.title = err.message),
              );
              render();
            },
          },
          YTK.following.has(c.id) ? 'Following ✓' : 'Follow',
        ),
        h(
          'button',
          { class: 'btn primary', onclick: () => YTK.channelPanel.open({ id: c.id }) },
          YTK.icon('chart'),
          'Analyze channel',
        ),
      ),
      toolRow(v),
      notesSection(v),
    );
  }

  async function show(videoId, { floating }) {
    if (!YTK.settings.watchPanel) return remove();
    if (videoId === currentId && host?.isConnected) return;
    currentId = videoId;
    report = null;
    heat = undefined;
    tx = { status: 'idle' };
    const mine = ++token;
    await mount(floating);
    if (mine !== token) return;
    frame(h('div', { class: 'skeleton' }));
    try {
      const data = await YTK.send({ type: 'videoReport', id: videoId });
      if (mine !== token) return;
      report = data;
      render();
      YTK.send({ type: 'heatmap', id: videoId })
        .catch(() => null)
        .then((points) => {
          if (mine !== token) return;
          heat = points ?? null;
          render();
        });
    } catch (err) {
      if (mine !== token) return;
      frame(h('div', { class: 'error' }, err.message));
      currentId = null; // allow a retry on the next navigation
    }
  }

  function remove() {
    token++;
    host?.remove();
    currentId = null;
    report = null;
  }

  document.addEventListener('ytk-saved-changed', () => report && host?.isConnected && render());

  return { show, remove };
})();
