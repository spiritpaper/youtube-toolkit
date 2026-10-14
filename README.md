# YT Toolkit

A Chrome extension for YouTube creators: find outliers, learn from the channels you follow, and plan, write, film and track your own videos. AI is optional (bring your own key).

Every extension page shares one sidebar:

| Section | Pages |
| --- | --- |
| **Home** | Setup checklist, radar, top-moving channels, recent ideas, rabbit holes and webs (reads saved data only, so no API cost) |
| **Discover** | Keyword explorer (rabbit holes) · Video web · Radar |
| **Channels** | Following · Compare · Content gaps |
| **Create** | Idea board · Saved outliers · Title lab · Script lab (hook library, script analyzer, audience questions) |
| **You** | My channel (Google sign-in) · Settings |

On YouTube itself:
- **Outlier badges** on thumbnails.
- **The video panel:** outlier score, stats, "Most replayed" heatmap, and buttons for Save idea, Follow, Analyze channel, Transcript, Explore topic, Video web and Comments.
- **Channel analysis** with Follow.

## What's inside

- **Following**: channels you learn from or compete with, tracked daily for growth (subscriber and median-view history), latest uploads with outlier scores, hit rate, trend, and your notes. The daily refresh doubles as the radar check, so tracking costs no extra quota.
- **Radar**: new outliers from followed channels, plus **keyword trend alerts**. Follow a keyword (🔔 in the explorer, or on the Radar) and new 2x+ videos from the last 30 days are reported daily.
- **Idea board**: your own videos as cards from Idea → Planned → Scripting → Filming & editing → Published. Start a project from a saved outlier, a content gap, an AI outline, a remix or audience research. Each project has a workspace:
  - **Idea & inspiration**: your angle, notes, and the outliers it's modelled on
  - **Titles** (sent to the Title lab) and an **outline** (AI can draft it from your linked outliers' scripts)
  - **Script** with **Script check**: your draft is timed at your speaking pace and compared with a linked outlier (hook signals, attention devices per minute, "you" per minute). It shows re-hook checkpoints at 25/50/75% and *drift zones* (a minute or more without a hook, twist, question or tease).
  - **Hook rewriter** (AI): 5 new openings modelled on your hook library
  - **Re-hook planner** (AI): lines to win viewers back at the weak checkpoints
  - **Shot list**: a starter from your script, or AI-generated (A-roll, B-roll, on-screen text, props), to download or print
  - **Thumbnail**: upload it and see it in a mock home feed next to your outliers, dark or light, full size and phone size. AI critiques it against the outliers' thumbnails.
  - **After publishing**: link the video and it's tracked for 30 days (views and outlier score vs your median at 48 hours and 7 days, next to the outliers you modelled it on). If you're signed in, your real retention curve, average % viewed and thumbnail click-through rate are added.
- **Outlier remix** (Saved outliers): tick 2–4 outliers and AI combines their formats into new concepts.
- **Audience questions**: the top 100 comments of any video (1 API unit, saved permanently), sorted into requests, questions, pain points and timestamped moments. AI turns them into video ideas.
- Plus everything from before: the keyword explorer, video web, script analyzer and hook library, content gaps, title lab, compare, my channel, saved outliers with tracked stats, CSV exports and storage management.

**Saving quota.** API data is cached and reused:
- **Kept for good:** results that don't change (AI reviews, saved comments, transcripts, heatmaps).
- **Refreshed in the background:** things that change (followed channels, keyword alerts, saved ideas, published videos), on a schedule.

Home, Following, the Idea board and the project pages read saved data only.

## Quick start

1. Download the latest zip from [Releases](https://github.com/spiritpaper/youtube-toolkit/releases) and unzip it into a folder (or clone this repository). In Chrome, open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and pick that folder.
2. Get a free [YouTube Data API v3](https://console.cloud.google.com/apis/library/youtube.googleapis.com) key (**Credentials → Create credentials → API key**), click the YT Toolkit icon and paste it.
3. Reload YouTube. Then open **Home** from the popup and follow its checklist.

Full walkthrough: **[Getting started](docs/getting-started.md)**.

## Documentation

| | |
| --- | --- |
| **Guides** | [Finding outliers](docs/guides/finding-outliers.md) · [Keyword explorer](docs/guides/keyword-explorer.md) · [Video web](docs/guides/video-web.md) · [Channels, Radar & gaps](docs/guides/channels.md) · [Idea board & projects](docs/guides/idea-board.md) · [Scripts, hooks & titles](docs/guides/scripts-and-titles.md) · [My channel](docs/guides/my-channel.md) · [AI assistant](docs/guides/ai-assistant.md) · [Data & storage](docs/guides/data-and-storage.md) |
| **Reference** | [How the numbers are calculated](docs/reference/metrics.md) · [API quota & caching](docs/reference/quota.md) · [Privacy](docs/reference/privacy.md) · [Troubleshooting](docs/reference/troubleshooting.md) |
| **Developers** | [Architecture](docs/development/architecture.md) · [Testing & contributing](docs/development/testing.md) |

The core idea in one line: **outlier score = video views ÷ median views of the channel's 30 most recent videos of the same format** (long-form and Shorts separately). See [metrics](docs/reference/metrics.md) for every formula.

## Development

No build step and no dependencies: plain ES modules loaded straight from `src/`.

```
npm test      # 76 tests: math, the background against a fake YouTube API, AI providers, storage, UI helpers
```

After editing, click the extension's reload icon in `chrome://extensions`, then reload YouTube tabs. See [Architecture](docs/development/architecture.md) and [Releasing](docs/development/releasing.md) (push a `vX.Y.Z` tag and GitHub Actions publishes the release zip). Changes are listed in the [changelog](CHANGELOG.md).

## Support

If YT Toolkit helps you, you can support its development. The link appears in the popup and Settings once `SUPPORT_URL` is set in `src/lib/support.js`. It stays hidden while that's empty.
