# Testing and contributing

## Run the tests

Node 20+ (no dependencies to install):

```
npm test
```

The tests (`test/*.test.js`, Node's built-in test runner) cover:

| File | Covers |
| --- | --- |
| `stats.test.js` | Outlier math, baselines, trend, percentile, growth, keyword opportunity, phrases, heatmap, channel profile, radar detection |
| `background.test.js` | The real background modules against a **fake YouTube API** (in-memory `chrome.storage`, mocked `fetch`): scoring, caching, fallbacks, channel analysis, keyword exploration and search fallback, heatmaps, idea snapshots and history, keyword alerts, published tracking |
| `account.test.js` | Google sign-in response parsing, Analytics client, CTR fallback, watchlist and radar |
| `storage.test.js` | Rabbit-hole tree, cleanup actions, backup contents, restore merging (projects, followed channels, radar, alerts, AI settings), cascading deletes |
| `projects.test.js` | Idea-board projects, the archive, write queue recovery |
| `notes.test.js` | Timestamped notes: time parsing, ordering, edits, Markdown export |
| `channel-review.test.js` | The AI channel review's data sheet and prompt |
| `shorts.test.js` | Shorts candidates from a transcript and heatmap, and the Shorts prompt |
| `search.test.js` | Quick-search index and ranking |
| `creator-tools.test.js` | Title checklist, content gaps, script analysis, drafts, drift zones, comments, shot list |
| `ai.test.js` | Every AI provider's request and response shape, retries, images, prompts |
| `markdown.test.js` | Markdown rendering (tables, nested lists, code, links, task lists) and HTML escaping |
| `web.test.js` | Video-web graph, insights, clusters, layout |

## Try it in the browser

1. `chrome://extensions` → **Load unpacked** → this folder.
2. After changing code, click the extension's reload icon, then reload YouTube tabs.
3. Service-worker logs: `chrome://extensions` → Outlier Lab → **Inspect views: service worker**. Page logs: right-click a page → Inspect.

## Adding a feature

1. Put the logic in a pure function in `src/lib/` and test it in `test/`.
2. If it needs YouTube data, add a function in `src/background/` (reuse `getVideos`, `getBaseline`, `scoreVideos`, the cache) and a message handler in `index.js`. Map API errors to a `reason`.
3. If it stores shared data, write through the background with a serialized `mutate()` (keep the chain alive after a failed write: `chain = run.catch(() => {})`); give per-item data its own key prefix so it can be deleted cleanly, and register the prefix in `storage-admin.js` (usage, cleanup, backup summary).
4. For a new page: create `src/<page>/<page>.html|css|js`, call `mountShell('<nav id>')` first, add the entry to `NAV` in `src/lib/nav.js`, use `h()` from `ui.js` for DOM (text nodes only for untrusted text).
5. AI prompts live in `src/lib/ai.js`; always let the user's channel description (`nicheLine`) in, and save results so they aren't paid for twice.
6. Document it in `docs/` (guide + any formula in `reference/metrics.md`, cost in `reference/quota.md`).

## Conventions

- Plain ES modules, no build step, no dependencies.
- Keep API cost visible: note the unit cost in a comment and in `docs/reference/quota.md`.
- One commit per feature or fix, with a message explaining *why*.
