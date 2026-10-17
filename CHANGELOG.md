# Changelog

All notable changes to YT Toolkit. Each release's section becomes its GitHub Release notes.

## [Unreleased]

### Added
- **Title A/B, thumbnails and steadier numbers in test screenings**: compare up to 4 titles on the same audience in one call (who'd click each, whose favorite it is, who each one wins over), include the thumbnail in the feed next to competitors' real thumbnails, and run a screening twice to see how steady its numbers are. A "What to expect" guide sits next to every screening.
- **Test screenings**: run a project's title, opening and script past an avatar group. Each viewer decides whether to click in a realistic feed, whether to stay past the opening, and how they feel beat by beat, until they leave or reach the end (and what they'd comment). The report shows weighted click, retention and finish estimates, an attention curve, where and why viewers left, every viewer's reactions, and ranked changes. Viewers are anchored to real (or typical) watch times so the results stay honest.
- **Audience lab**: groups of avatars, realistic fictional viewers built from your real analytics (age, countries, devices, subscribers, how people find you), your top videos and recent comments, or from your channel description or a channel you follow. Lock, edit, add by hand, and regenerate the rest. Each avatar shows the data it reflects.

## [0.7.2] - 2026-10-17

### Added
- **Video downloads (optional add-on)**: a small companion app for Windows, Mac and Linux, attached to each release, lets YT Toolkit save videos, audio or just a clip: from a new Downloads page (any supported site, including X), a Download button in the YouTube panel, or **Download clip** on each suggested Short. It runs the downloader with a fixed, minimal set of options, verifies it before installing, and only talks to your copy of YT Toolkit. Nothing changes unless you turn it on. See the Video downloads guide.

## [0.7.1] - 2026-10-17

### Added
- **Updates without reinstalling**: Settings and Home show when a newer release is out, and the extension reloads itself when its files change, waiting until no YT Toolkit page is open, so updating keeps all your data.
- **Updaters for every system**, included in the zip: double-click `scripts\update.cmd` on Windows, or run `sh scripts/update.sh .` on macOS and Linux, inside the extension's folder.

## [0.7.0] - 2026-10-14

### Fixed
- **Phone layout**: the menu button no longer covers page titles.
- **Saving no longer stops after one failed write**: an error such as following a 16th keyword or editing a just-deleted project used to block every later save to the same data until Chrome restarted the extension.
- **AI answers render properly**: tables, nested lists, code blocks, quotes, links, strikethrough and numbered lists that continue after a paragraph now display as formatted text instead of raw Markdown, with the same styling on every page.

### Changed
- **Clearer empty and loading states**: empty pages (Saved outliers, Script lab, Compare, Radar) explain what to do and link to where it happens; every wait shows a spinner, Following shows placeholder cards while it loads, and AI actions on a project show progress next to the button.

### Added
- **Quick search** (Ctrl+K or / on any page) across projects, saved outliers, followed channels, your notes, rabbit holes, video webs and pages, opening each result in place.
- **Idea board filter and sorting**: filter cards by text, sort columns five ways (remembered), and a **Needs attention** view of cards untouched for two weeks.
- **Shorts from a long video** in the Script analyzer: candidate 25–58 second clips around the most replayed moments and the script's twists, and an AI plan for 3–5 Shorts (clip times, first-second hook, cuts, captions, loop ending). For other creators' videos it suggests your own take instead of a reupload.
- **Honest channel review (AI)** on My channel: built only on your analytics (totals, top videos, retention drop-offs with what you said there, traffic sources, followed channels), it lists every problem worst first with what, where, evidence, fix and the number to check. Reviews are saved with the data they used.
- **Your own notes on any video**: timestamped notes in the Script lab (with "+ note" on every transcript line) and an **Add note at 3:42** button in the panel on YouTube that uses the player's current time. Click a note's time to jump there; notes sync between both places, can be downloaded, and are backed up.
- **Archive for published videos**: 30 days after a video goes live it leaves the board for an Archive view with its final numbers (views, outlier score, 48-hour and 7-day results), search and sorting. Archive or restore by hand from the project page or the archive; the delay is set in Settings → Idea board.
- **Fuller backups**: followed channels now carry their last-known stats and uploads, plus your AI settings (without keys) and Google client ID. Restoring shows what the file holds first, then merges projects, followed channels (combining their growth history), the radar, keyword alerts and AI results item by item instead of skipping what you already have. Settings shows when you last backed up.
- **Following keeps working without quota**: if a channel can't be refreshed, its last-known numbers are shown with a note instead of an error.
- **Edit / Preview** switch on the project Outline and Shot list, so AI drafts read as formatted text and stay editable. The view you pick is remembered, and **Print** on the shot list prints the formatted version.

## [0.6.1] - 2026-10-13

### Added
- **Support the developer** link in the sidebar, popup and Settings, pointing to https://spiritpaper.github.io/#support.

## [0.6.0] - 2026-10-13

First public release.

### Added
- **Outlier scores on YouTube**: a badge on every thumbnail (views ÷ the channel's median, long-form and Shorts scored separately), a performance panel next to videos (stats, channel trend, "Most replayed" heatmap, transcript, follow, comments, video web) and a channel analysis.
- **Saved outliers** with a full stats snapshot, daily tracking history, notes, tags, AI breakdowns, CSV exports and outlier remix.
- **Keyword explorer**: rabbit holes from a broad keyword into sub-topics, with an opportunity score, small-channel hunt preset, keyword alerts and CSV export.
- **Video web**: a map of the videos YouTube suggests around any video, with hubs, topic clusters and AI ideas.
- **Following, Compare, Radar and Content gaps**: track channels you learn from or compete with, compare them with yours, get daily alerts for new outliers, and find topics competitors win with that you haven't covered.
- **Idea board**: your own videos from idea to published, each with a workspace for inspiration, titles, outline, script check, hook rewriter, re-hook planner, shot list, thumbnail mock-up and critique, and 30-day tracking after publishing.
- **Script analyzer, Hook library, Title lab and Audience questions**.
- **My channel** (optional Google sign-in): your retention curves, watch time and comparison with competitors.
- **Optional AI** with your own key: Gemini, OpenAI, Claude or OpenRouter.
- **Storage management**: usage, cleanup, automatic retention, backup and restore.
- Documentation in `docs/`.
