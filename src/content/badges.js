// Outlier badges on video thumbnails (home, search, sidebar, channel pages).
YTK.badges = (() => {
  const results = new Map(); // videoId -> scored video | null
  const waiting = new Map(); // videoId -> Set<anchor>
  let halted = null; // reason we stopped calling the API (no key, quota)
  let scanTimer = null;
  let flushTimer = null;

  // Thumbnail links contain an image; title links to the same video don't.
  const THUMB_CONTENT = 'img, yt-image, yt-thumbnail-view-model, .yt-core-image';

  function isThumbAnchor(a) {
    return a.querySelector(THUMB_CONTENT) && !a.closest('#movie_player, .ytp-ce-element');
  }

  function scan() {
    if (!YTK.settings.badges) return;
    const anchors = document.querySelectorAll('a[href*="/watch?v="], a[href^="/shorts/"]');
    for (const a of anchors) {
      const id = YTK.videoIdFromHref(a.getAttribute('href'));
      if (!id || a.dataset.ytkId === id || !isThumbAnchor(a)) continue;
      // YouTube recycles elements, so an anchor may already carry a stale badge.
      a.dataset.ytkId = id;
      a.querySelector(':scope > .ytk-badge')?.remove();
      if (results.has(id)) render(a, results.get(id));
      else enqueue(id, a);
    }
  }

  function scanSoon() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, 300);
  }

  function enqueue(id, a) {
    if (!waiting.has(id)) waiting.set(id, new Set());
    waiting.get(id).add(a);
    if (halted) return;
    clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, 250);
  }

  let busy = false;
  async function flush() {
    if (busy || halted) return;
    const ids = [...waiting.keys()].filter((id) => !results.has(id)).slice(0, 50);
    if (!ids.length) return;
    busy = true;
    try {
      await fetchAndRender(ids);
    } finally {
      busy = false;
    }
    if (waiting.size) flush();
  }

  async function fetchAndRender(ids) {
    let data;
    try {
      data = await YTK.send({ type: 'scoreVideos', ids });
    } catch (err) {
      if (['noKey', 'quotaExceeded', 'keyInvalid', 'stale'].includes(err.reason)) {
        if (!halted) YTK.toast(`YT Toolkit: ${err.message}`);
        halted = err.reason;
        return;
      }
      data = {};
    }
    for (const id of ids) {
      const v = data[id] ?? null;
      results.set(id, v);
      for (const a of waiting.get(id) ?? []) if (a.dataset.ytkId === id) render(a, v);
      waiting.delete(id);
    }
  }

  function render(a, v) {
    a.querySelector(':scope > .ytk-badge')?.remove();
    if (!v || v.multiplier == null || v.multiplier < (YTK.settings.badgeMin || 0)) return;
    if (getComputedStyle(a).position === 'static') a.classList.add('ytk-anchor');
    const tier = YTK.tier(v.multiplier);
    a.append(
      YTK.h(
        'span',
        {
          class: `ytk-badge ytk-tier-${tier}`,
          title:
            `${YTK.fmtMult(v.multiplier)} the channel's median (${YTK.fmtNum(v.baselineMedian)} views)\n` +
            `${YTK.fmtNum(v.views)} views · ${YTK.fmtAge(v.publishedAt)} · ${v.format === 'short' ? 'Short' : 'Long-form'}`,
        },
        YTK.fmtMult(v.multiplier),
      ),
    );
  }

  function resetAll() {
    halted = null;
    for (const a of document.querySelectorAll('a[data-ytk-id]')) {
      delete a.dataset.ytkId;
      a.querySelector(':scope > .ytk-badge')?.remove();
    }
    scanSoon();
  }

  function start() {
    new MutationObserver(scanSoon).observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['href'],
    });
    document.addEventListener('ytk-settings-changed', resetAll);
    scanSoon();
  }

  return { start, scanSoon };
})();
