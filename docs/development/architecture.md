# Architecture

YT Toolkit is a Manifest V3 Chrome extension written in plain JavaScript (ES modules), with no build step and no dependencies. Load the folder unpacked and it runs.

## The four parts

```
┌─────────────────────────┐   messages   ┌──────────────────────────────┐
│ Content scripts          │ ───────────▶ │ Background service worker     │
│ (on youtube.com)         │              │ src/background/index.js       │
│ badges, video panel,     │ ◀─────────── │ the only place that calls the │
│ channel analysis,        │              │ YouTube APIs and writes most  │
│ transcript capture       │              │ shared data                   │
└─────────────────────────┘              └──────────────┬───────────────┘
            ▲ page-hook.js (MAIN world)                  │ chrome.storage.local
            │ captions the player downloads              ▼
┌─────────────────────────┐   messages   ┌──────────────────────────────┐
│ Extension pages          │ ───────────▶ │ Storage (everything local)    │
│ home, explore, web,      │ ◀─────────── │ ideas, projects, watchlist,   │
│ channels, board, project,│   reads      │ explore:index, tx:/hm:/cm:…   │
│ studio, script, audience,│              └──────────────────────────────┘
│ ideas, options, popup    │──▶ AI provider APIs (direct from the page)
└─────────────────────────┘
```

1. **Background service worker** (`src/background/`) owns every YouTube Data API call, the cache, quota counting, Google sign-in and the scheduled jobs (an alarm every 4 hours). Pages and content scripts ask it for things by message.
2. **Content scripts** (`src/content/`, classic scripts sharing the `YTK` global) run on youtube.com: thumbnail badges, the video panel, the channel analysis modal, Follow buttons and transcript capture. `page-hook.js` runs in the page's own context (`"world": "MAIN"`) only to see the caption files the video player downloads, and hands them over with `postMessage`.
3. **Extension pages** (`src/<page>/`) are ES-module pages sharing the sidebar (`src/lib/nav.js`) and helpers (`src/lib/ui.js`). They read storage directly and send messages for anything that writes shared data or calls YouTube.
4. **Shared libraries** (`src/lib/`) are pure functions with no DOM or storage dependence, used by the background, the pages and the tests.

AI calls are made **from the pages**, not the service worker (which may be suspended during a long generation), straight to the provider with the user's key (`src/lib/ai.js`).

## Folder map

| Path | What it is |
| --- | --- |
| `manifest.json` | Permissions, content scripts, pages |
| `src/background/index.js` | Message router, alarm jobs, small handlers |
| `src/background/api.js` | YouTube Data API client, error mapping, quota counter |
| `src/background/cache.js` | TTL cache (memory + `chrome.storage.local`, keys `cache:*`) |
| `src/background/youtube.js` | Videos, channel baselines, analysis, search scraping, watch pages (heatmap, suggestions), video webs, comments |
| `src/background/watchlist.js` | Followed channels, daily snapshots, Compare, Radar, gap data |
| `src/background/trends.js` | Keyword alerts |
| `src/background/published.js` | After-publishing tracking for projects |
| `src/background/auth.js`, `analytics.js` | Google sign-in, YouTube Analytics reports |
| `src/lib/stats.js` | Outlier score, baselines, trend, keyword opportunity, heatmap, growth… |
| `src/lib/script.js` | Script analysis, draft timing, drift zones, re-hook checkpoints |
| `src/lib/titles.js`, `gaps.js`, `web.js`, `comments.js` | Title checklist, content gaps, video-web graph and layout, comment analysis |
| `src/lib/ideas.js`, `projects.js`, `explore-store.js`, `storage-admin.js` | Stores (single writer: the background) |
| `src/lib/ai.js` | AI providers and every prompt |
| `src/lib/nav.js`, `ui.js`, `markdown.js`, `linechart.js`, `heatmap-view.js`, `base.css` | Shared page UI |
| `src/content/` | YouTube overlays |
| `src/home`, `explore`, `web`, `channels`, `board`, `project`, `studio`, `script`, `audience`, `ideas`, `options`, `popup` | Pages |
| `test/` | Node tests (`node --test`) |
| `docs/` | Documentation |

## Messages

Pages and content scripts call `chrome.runtime.sendMessage({ type, ...args })`; the router replies `{ ok: true, data }` or `{ ok: false, error, reason }`. `reason` carries machine-readable causes such as `noKey`, `quotaExceeded`, `keyInvalid`, `signedOut`, `commentsDisabled`.

| Area | Message types |
| --- | --- |
| Scoring | `scoreVideos`, `videoReport`, `analyzeChannel`, `videoInfo`, `heatmap`, `comments` |
| Saved outliers | `saveIdea`, `updateIdea`, `removeIdea`, `savedIds`, `refreshIdeas`, `saveTranscript`, `saveScriptAi`, `saveAiRun` |
| Keyword explorer | `explore`, `suggest`, `exploreNodes`, `exploreNode`, `updateNode`, `deleteNodes` |
| Video web | `webBuild`, `webExpand`, `webGet`, `webList`, `webDelete` |
| Channels | `watch`, `unwatch`, `following`, `updateFollow`, `compare`, `setCompareAs`, `gapData` |
| Radar | `radarCheck`, `radarRead`, `radarClear`, `followKeyword`, `unfollowKeyword`, `keywords` |
| Projects | `projects`, `projectCreate`, `projectUpdate`, `projectDelete`, `projectPublish`, `projectTrack` |
| Google | `authStatus`, `setClientId`, `signIn`, `signOut`, `myOverview`, `myTopVideos`, `myRetention`, `myTraffic`, `myVideoTotals` |
| Storage | `storageUsage`, `cleanup`, `exportData`, `importData`, `clearCache` |
| Misc | `quota`, `testKey`, `openExplorer`, `openPage` |

## Storage keys

| Key | Contents | Written by |
| --- | --- | --- |
| `apiKey`, `ai`, `google` | Keys and settings (never exported) | popup, settings, auth |
| `badges`, `watchPanel`, `badgeMin`, `trackDaily`, `holeRetentionDays` | Settings | popup, settings |
| `ideas` | Saved outliers with history, stats, notes, AI breakdown | background |
| `tx:<videoId>` | Transcript (+ AI script breakdown and outline) | background |
| `hm:<videoId>` | Replay heatmap of a saved outlier | background |
| `cm:<videoId>` | Saved comments | background |
| `explore:index`, `xn:<nodeId>` | Rabbit-hole tree and each node's results | background |
| `vw:<seedId>` | Video webs | background |
| `watchlist`, `radar`, `keywordAlerts` | Followed channels (with history), radar feed, keyword alerts | background |
| `projects`, `th:<projectId>` | Idea-board projects; uploaded thumbnails | background; project page (thumbnails) |
| `aiRuns`, `titleLab` | Past AI results; Title-lab drafts | background; studio |
| `quota`, `*CheckedAt`, `ideasRefreshedAt` | Bookkeeping | background |
| `cache:*` | API response cache (TTL) | background |

**Single writer**: stores that several places change (`ideas`, `projects`, `watchlist`/`radar`, `explore:index`, `keywordAlerts`) are only written by the background, through a serialized `mutate()` chain, so concurrent updates can't overwrite each other.

**Versioned cache**: channel baselines carry a version (`BASELINE_VERSION` in `youtube.js`); bump it when their shape changes so old cache entries are refetched.

## Scheduled jobs

`chrome.alarms` fires every 4 hours. Each job keeps its own "last run" time and runs at most daily (published videos more often in week 1): delete old rabbit holes, prune the cache, track published videos, radar check (followed channels: daily snapshots + new outliers), keyword alerts, saved-outlier refresh. Extra API cost only happens when an API key is set.

## Design choices

- **Free sources first**: YouTube's search pages, watch pages (heatmap, suggestions), autocomplete and the player's own captions cost no quota; the API is used for numbers that need accuracy.
- **Cache by volatility**: things that change are cached for hours; things that don't (AI results, transcripts, comments) are kept until deleted.
- **Pure math in `src/lib`** with tests; pages stay thin.
- **No remote code**: no CDN scripts (MV3 forbids them); charts and the graph layout are small in-house SVG code.
- **Untrusted text**: titles, comments and AI output are inserted as text nodes; AI Markdown is HTML-escaped before formatting (`markdown.js`).
