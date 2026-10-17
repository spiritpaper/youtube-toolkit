# Data and storage

Everything is stored **only in your browser** (Chrome's extension storage). Nothing is uploaded anywhere except API requests to YouTube/Google and, if you use AI, to the provider you chose.

## What's tracked automatically

A background check runs every few hours and does each job at most once a day:

| Job | What it records | Cost |
| --- | --- | --- |
| Saved outliers | A stats snapshot per outlier (views, likes, outlier score, channel subscribers) | ~1 unit per 50 outliers + ~5 per uncached channel |
| Followed channels | A daily snapshot (subscribers, total views, median views) and new outliers for the Radar | ~5 units per channel |
| Keyword alerts | New outliers for keywords you follow | ~1 unit per keyword + uncached channels |
| Published projects | Views and outlier score, every ~4 hours in week 1, then daily to day 30 | ~1 unit per 50 videos |

Turn off the daily refresh of saved outliers under **Settings → Tracking saved ideas**.

Data that doesn't change is kept instead of re-fetched: AI results, transcripts, replay heatmaps, saved comments. Data that changes (video stats, channel baselines, search results) is cached for hours. See [API quota and caching](../reference/quota.md).

## Exports

- **Saved outliers → Export CSV**: one row per outlier, about 50 columns ([column reference](../reference/metrics.md#csv-columns))
- **Saved outliers → Export history**: one row per outlier per day
- **Keyword explorer → Export CSV**: every explored keyword with its metrics; **Export results CSV** for one keyword's videos
- **Script analyzer → Download transcript**, **Hook library → Export hooks**
- **Project → Shot list → Download / Print**
- AI results: **Copy** or **Download .md**

All exports respect the current search and filters.

## Cleaning up

**Settings → Storage & data** shows how much space each kind of data uses, and lets you delete:

- rabbit holes not touched in 30, 90 or 180 days, or all of them
- tracking history older than 30 days, 90 days or a year (the latest snapshot of each outlier is kept)
- saved outliers whose videos were deleted or made private, or saved more than 90 days or a year ago (their transcripts and heatmaps go too)
- transcripts and heatmaps not linked to a saved outlier, or all of them
- AI idea lists, AI breakdowns, video webs, saved comment research
- the temporary API cache (it's refetched when needed, which uses quota)

**Automatic cleanup**: rabbit holes untouched for 180 days are deleted by default; choose 30/90/365 days or "keep forever". Deleting a saved outlier also deletes its transcript and heatmap; deleting a project deletes its uploaded thumbnail.

## Backup and restore

- **Download backup**: one JSON file with everything you'd miss on a new computer:
  - saved outliers and their tracking history, notes and AI breakdowns
  - Idea board projects, their uploaded thumbnails and after-publishing numbers
  - followed channels with their notes, daily growth history and **last-known stats and uploads**, so Following, Compare and Content gaps work right after a restore without spending quota
  - the radar feed and keyword alerts
  - rabbit holes, video webs, transcripts, retention heatmaps and comment research
  - your notes, and the lab notebook's lessons and experiments
  - recent AI results and your AI settings (provider, models, channel description)
  - your Google client ID (you still sign in again)

  **API keys and sign-in tokens are never included.** Settings shows when you last downloaded a backup, in orange after two weeks.
- **Restore backup**: pick the file and you'll see what it holds before anything changes. **Restore and merge** then merges it into your current data: for items in both, the more recently updated copy wins; followed channels combine their growth history from both; restoring the same file twice doesn't duplicate anything. Nothing is deleted, and your keys and current AI choices are kept.

If a followed channel can't be refreshed (no quota left, invalid key, offline), Following shows its last-known numbers with an orange "Showing data from …" note instead of an error.

Back up before moving the extension folder, reinstalling, or switching computers.

**Delete everything** removes all data but keeps your settings and keys.
