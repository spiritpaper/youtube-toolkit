# Outlier Lab

**A creator's laboratory for YouTube.** Find the videos that beat their channel, test your own ideas on realistic viewers before you publish, and learn from what really happened, so every video teaches the next one.

Free and open source. Your data stays in your browser. AI is optional: use your own key (Gemini has a free tier), or run it fully offline on your own computer with Ollama.

- **Discover:** outlier badges right on YouTube, a keyword explorer, video webs, a radar on the channels you follow, and content gaps.
- **Plan:** an idea board where every video gets a workspace for its angle, titles, outline, script with script checks, shot list and thumbnail.
- **Test:** the **Audience lab** builds avatars of your real audience from your analytics and comments. Pitch ideas to them, ask them questions, and test-screen your title, opening and script before you publish.
- **Learn:** after publishing, **Forecast vs reality** compares the screening with the real numbers and updates the avatars from real viewers. The **Lab notebook** keeps your notes, lessons and experiments, and brings the right ones back while you write.

Every extension page shares one sidebar:

| Section | Pages |
| --- | --- |
| **Home** | Setup checklist, radar, top-moving channels, recent ideas, rabbit holes and webs (reads saved data only, so no API cost) |
| **Discover** | Keyword explorer (rabbit holes) · Video web · Radar |
| **Channels** | Following · Compare · Content gaps |
| **Create** | Idea board · Saved outliers · Title lab · Script lab (hook library, script analyzer, audience questions) · Audience lab · Lab notebook · Downloads |
| **You** | My channel (Google sign-in) · Settings |

On YouTube itself:
- **Outlier badges** on thumbnails.
- **The video panel:** outlier score, stats, "Most replayed" heatmap, buttons for Save idea, Follow, Analyze channel, Transcript, Explore topic, Video web and Comments, and **your own timestamped notes** ("Add note at 3:42").
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
  - **After publishing**: link the video and it's tracked for 30 days (views and outlier score vs your median at 48 hours and 7 days, next to the outliers you modelled it on). If you're signed in, your real retention curve, average % viewed and thumbnail click-through rate are added. After 30 days it moves to the board's **Archive** with its final numbers.
- **Audience lab**: avatar groups built from your real analytics (ages, countries, devices, subscribers, how people find you) and comments. **Ask your audience** to react to one-line pitches or answer questions. **Test screenings** show who clicks, who stays past the opening and where they leave, beat by beat, with ranked changes. **Compare titles** on the same audience. After publishing, **Forecast vs reality** checks the screening against the real numbers, calibrates the next ones, and proposes updates to the avatars. See [Audience lab](docs/guides/audience-lab.md).
- **Lab notebook**: every timestamped note you take on videos (group them with #tags), lessons you've learned, and experiments that test an idea across videos against your real numbers. While you write an outline or script, the matching notes and lessons appear under it. See [Lab notebook](docs/guides/lab-notebook.md).
- **Local AI**: every AI feature can run on Ollama or LM Studio on your own computer, free and private. See [Local AI](docs/guides/local-ai.md) for what to install and which model fits your machine.
- **Honest channel review** (AI, My channel): built only on your own analytics (retention drop-offs with what you said there, top videos, traffic, followed channels), listing every problem with where it is, the evidence and how to fix it.
- **Shorts from a long video** (Script analyzer): clips around the most replayed moments, and an AI plan with hooks, cuts and loop endings.
- **Quick search** (Ctrl+K on any page) across projects, saved videos, channels, notes and rabbit holes.
- **Video downloads** (optional add-on): save your own videos, audio or a clip with a small companion app for Windows, Mac and Linux. See [Video downloads](docs/guides/video-downloads.md).
- **Outlier remix** (Saved outliers): tick 2–4 outliers and AI combines their formats into new concepts.
- **Audience questions**: the top 100 comments of any video (1 API unit, saved permanently), sorted into requests, questions, pain points and timestamped moments. AI turns them into video ideas.
- Plus the keyword explorer, video web, script analyzer and hook library, content gaps, title lab, compare, my channel, saved outliers with tracked stats, CSV exports, storage management and full backups (everything except your keys).

**Saving quota.** API data is cached and reused:
- **Kept for good:** results that don't change (AI reviews, saved comments, transcripts, heatmaps).
- **Refreshed in the background:** things that change (followed channels, keyword alerts, saved ideas, published videos), on a schedule.

Home, Following, the Idea board and the project pages read saved data only.

## Quick start

> **Why isn't it on the Chrome Web Store?** Publishing there needs a paid developer account, which this project can't cover yet. Installing by hand takes about two minutes, and later updates are one double-click (one command on Mac and Linux).

1. Download `outlier-lab-v….zip` from the [latest release](https://github.com/spiritpaper/outlier-lab/releases/latest) and unzip it into a folder you'll keep (for example `Documents/Outlier Lab`). Chrome runs it from that folder, so don't delete it.
2. In Chrome, open `chrome://extensions`, turn on **Developer mode** (top right), click **Load unpacked** and pick that folder.
3. Get a free [YouTube Data API v3](https://console.cloud.google.com/apis/library/youtube.googleapis.com) key (**Credentials → Create credentials → API key**), click the Outlier Lab icon and paste it.
4. Reload YouTube. Then open **Home** from the popup and follow its checklist.

To update later, Outlier Lab tells you when a new version is out, and the update script in its folder (`scripts/update.cmd` on Windows) installs it in place, keeping your data. See [Getting started](docs/getting-started.md).

Full walkthrough: **[Getting started](docs/getting-started.md)**.

## Documentation

| | |
| --- | --- |
| **Guides** | [Audience lab](docs/guides/audience-lab.md) · [Lab notebook](docs/guides/lab-notebook.md) · [Local AI](docs/guides/local-ai.md) · [Video downloads](docs/guides/video-downloads.md) · [Finding outliers](docs/guides/finding-outliers.md) · [Keyword explorer](docs/guides/keyword-explorer.md) · [Video web](docs/guides/video-web.md) · [Channels, Radar & gaps](docs/guides/channels.md) · [Idea board & projects](docs/guides/idea-board.md) · [Scripts, hooks & titles](docs/guides/scripts-and-titles.md) · [My channel](docs/guides/my-channel.md) · [AI assistant](docs/guides/ai-assistant.md) · [Data & storage](docs/guides/data-and-storage.md) |
| **Reference** | [How the numbers are calculated](docs/reference/metrics.md) · [API quota & caching](docs/reference/quota.md) · [Privacy](docs/reference/privacy.md) · [Troubleshooting](docs/reference/troubleshooting.md) |
| **Developers** | [Architecture](docs/development/architecture.md) · [Testing & contributing](docs/development/testing.md) |

The core idea in one line: **outlier score = video views ÷ median views of the channel's 30 most recent videos of the same format** (long-form and Shorts separately). See [metrics](docs/reference/metrics.md) for every formula.

## Development

No build step and no dependencies: plain ES modules loaded straight from `src/`.

```
npm test      # 140 tests: math, the background against a fake YouTube API, AI providers (cloud and local), the Audience lab, storage, UI helpers
```

After editing, click the extension's reload icon in `chrome://extensions`, then reload YouTube tabs. See [Architecture](docs/development/architecture.md) and [Releasing](docs/development/releasing.md) (push a `vX.Y.Z` tag and GitHub Actions publishes the release zip). Changes are listed in the [changelog](CHANGELOG.md).

## Support

If Outlier Lab helps you, you can support its development. The link appears in the popup and Settings once `SUPPORT_URL` is set in `src/lib/support.js`. It stays hidden while that's empty.
