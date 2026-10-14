// Routes YouTube's single-page navigations to the right feature.
(async () => {
  let lastUrl = null;

  function route() {
    if (location.href === lastUrl) return;
    lastUrl = location.href;

    const type = YTK.pageType();
    if (type === 'watch') {
      YTK.watchPanel.show(new URLSearchParams(location.search).get('v'), { floating: false });
    } else if (type === 'shorts') {
      YTK.watchPanel.show(location.pathname.split('/')[2], { floating: true });
    } else {
      YTK.watchPanel.remove();
    }
    YTK.channelPanel.syncFab();
    YTK.badges.scanSoon();
  }

  await YTK.loadSettings();
  document.addEventListener('yt-navigate-finish', route);
  // Shorts swipes and some navigations don't always fire yt-navigate-finish.
  setInterval(route, 1000);
  document.addEventListener('ytk-settings-changed', () => {
    lastUrl = null;
    route();
  });

  route();
  YTK.badges.start();
})();
