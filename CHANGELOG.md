# Changelog

All notable changes to YT Toolkit. Each release's section becomes its GitHub Release notes.

## [Unreleased]

### Fixed
- **AI answers render properly**: tables, nested lists, code blocks, quotes, links, strikethrough and numbered lists that continue after a paragraph now display as formatted text instead of raw Markdown, with the same styling on every page.

### Added
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
