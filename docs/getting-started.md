# Getting started

About 10 minutes. You only need step 1 and 2 to use most features.

## 1. Install the extension

1. Download the latest `youtube-toolkit-v….zip` from [Releases](https://github.com/spiritpaper/youtube-toolkit/releases) and unzip it into a folder (or clone the repository). Keep that folder somewhere permanent: Chrome gives an unpacked extension an ID based on its folder, and moving the folder later gives it a new ID with empty storage. (Use **Settings → Storage & data → Download backup** before moving it.)
2. In Chrome, open `chrome://extensions`.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and choose that folder (the one containing `manifest.json`).
5. Pin the extension: click the puzzle icon in the toolbar and pin **YT Toolkit**.

Works in Chrome, Edge and Brave.

## 2. Add a YouTube Data API key (free)

The extension reads public YouTube data (views, subscribers, uploads) through Google's official API. Each user brings their own free key, which allows 10,000 "units" a day: plenty for normal use.

1. Open the [Google Cloud console](https://console.cloud.google.com/) and create a project (any name).
2. Open the [YouTube Data API v3](https://console.cloud.google.com/apis/library/youtube.googleapis.com) page and click **Enable**.
3. Go to [Credentials](https://console.cloud.google.com/apis/credentials) → **Create credentials** → **API key**. Copy the key.
4. Optional but recommended: click the key, and under **API restrictions** choose **Restrict key → YouTube Data API v3**.
5. Click the YT Toolkit icon in the toolbar, paste the key and click **Save**. The extension checks it with one request.
6. Reload any open YouTube tabs.

You'll now see outlier badges on YouTube thumbnails and a performance panel next to videos.

## 3. Optional: connect an AI provider

AI writes breakdowns, outlines, hooks and ideas. Everything else works without it.

1. Open **Settings** (sidebar, or the popup's Settings link).
2. Choose a provider: Google Gemini (has a free tier), OpenAI, Anthropic Claude, or OpenRouter.
3. Paste your key and click **Connect**. Chrome asks permission to contact that provider.
4. Describe your channel in one or two sentences ("Budget travel vlogs for Gen Z, 12K subs, solo creator filming on a phone"). AI uses this to tailor ideas to you.

See the [AI assistant guide](guides/ai-assistant.md).

## 4. Optional: sign in with Google for your own analytics

To see your own retention curves, watch time and click-through rate, and to compare yourself with other channels, follow the [My channel guide](guides/my-channel.md). It takes about 5 minutes in the same Google Cloud project.

## Updating

Updates never need a reinstall. Your data lives in Chrome, tied to the extension's folder, so keep using the same folder:

1. **Settings → Version & updates** (and a banner on Home) tells you when a new release is out.
2. Replace the folder's files with the new version: unzip the new release over the same folder, or on Linux/macOS run `sh scripts/update.sh .` inside it (it downloads the latest release only if it's newer).
3. That's it: the extension notices its files changed and reloads itself within about five minutes, as soon as no YT Toolkit page is open. (Or click the reload icon in `chrome://extensions`, and reload open YouTube tabs.)

Download a backup first if you like (**Settings → Storage & data**); an update doesn't touch your data, but a backup costs nothing.

## Where to go next

Open the **Home** page (popup → **Open YT Toolkit**). Its checklist walks you through the first steps:

1. **Follow** a few channels you want to learn from ([guide](guides/channels.md)).
2. **Dig into a keyword** in the explorer ([guide](guides/keyword-explorer.md)).
3. **Save outliers** you like with ☆ ([guide](guides/finding-outliers.md)).
4. **Start a project** on the Idea board from a saved outlier ([guide](guides/idea-board.md)).

**Tip:** press **Ctrl+K** (⌘K on a Mac) or **/** on any YT Toolkit page to search everything you've saved (projects, saved outliers, followed channels, your notes, rabbit holes, video webs) and jump straight to it. Use ↑ ↓ to pick and Enter to open.
