# API quota and caching

The YouTube Data API gives each key **10,000 units per day**, reset at midnight Pacific time. The sidebar and popup show today's usage. Most requests cost 1 unit; YouTube's `search` costs 100, which is why the extension reads YouTube's own search pages instead whenever it can.

## What each action costs

| Action | Units | Reused for |
| --- | --- | --- |
| A channel's baseline (its recent long-form and Shorts uploads) | ~5 | 12 hours |
| Thumbnail badges | 1 per 50 videos (+ baselines for new channels) | 1 hour |
| Video panel | 1 + channel baseline | 1 hour |
| Channel analysis (200 long-form + 100 Shorts) | ~13 | 6 hours |
| Keyword exploration | ~1 + ~5 per uncached channel (search page free) | search 6 hours |
| Keyword fallback when the search page can't be read | 100 | 6 hours |
| Video web (new) | ~100–150 (suggestions free) | saved |
| Audience questions (top 100 comments) | 1 | saved permanently |
| Following / Radar refresh | ~5 per followed channel per day | daily |
| Keyword alerts | ~1 per keyword + uncached channels, per day | daily |
| Saved outliers refresh | 1 per 50 outliers + uncached channels, per day | daily |
| Published-video tracking | 1 per 50 videos per check | every ~4 h in week 1, then daily |
| Heatmaps, transcripts, autocomplete | 0 (read from YouTube's pages) | heatmap 24 h; transcripts saved |
| Home, Following, Idea board, projects, Saved outliers | 0 (saved data only) | |

Your own analytics (My channel) use the separate **YouTube Analytics API** quota, cached for 3 hours.

## Caching rules

- **Data that changes** (views, channel baselines, search results) is cached for the times above, so revisiting a page or video is free within that window.
- **Data that doesn't change** is kept until you delete it: AI results, transcripts, replay heatmaps, saved comments, video webs, rabbit holes.
- **Tracking** (saved outliers, followed channels, keyword alerts, published projects) happens in the background on a schedule, at most once a day per job (published videos more often in their first week).
- Two pages asking for the same channel at the same time share one request.
- **Settings → Storage & data → Temporary API cache → Clear** forgets cached API responses (they're refetched when needed, which uses quota). It never touches your saved data.

## Typical day

Following 20 channels and 5 keywords, with 100 saved outliers: background tracking uses roughly 100–150 units. A few keyword digs and two video webs add ~500. That's well under 10,000.

If you hit the limit, the extension shows "Daily YouTube API quota used up" and everything saved keeps working; API features resume after midnight Pacific.
