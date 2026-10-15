# Privacy

YT Toolkit has **no server**. Nothing about you is collected by the extension's author.

## What's stored, and where

Everything is stored in your browser's extension storage (`chrome.storage.local`) on your computer:

- your YouTube API key and AI keys
- saved outliers, their history, transcripts and heatmaps
- followed channels, keyword alerts, the radar feed
- rabbit holes, video webs, saved comments
- Idea board projects (including uploaded thumbnails) and AI results
- a temporary cache of API responses

Google sign-in tokens are kept **only in memory** (`chrome.storage.session`) and expire after an hour. Signing out revokes the token and deletes cached analytics.

Backups you download contain your data (including your AI provider choice and channel description) but **never** your API keys or sign-in tokens.

## What's sent where

| Destination | When | What |
| --- | --- | --- |
| `www.googleapis.com` (YouTube Data API) | Most features | Video, channel and playlist IDs and your API key |
| `www.youtube.com` | Keyword search, heatmaps, video webs | Normal page requests, as if you'd opened the page (with your YouTube cookies, so results match what you'd see) |
| `suggestqueries.google.com` | Keyword autocomplete | The keyword |
| `i.ytimg.com` | AI breakdowns and thumbnail critiques | Fetches public thumbnails to pass to your AI provider |
| `youtubeanalytics.googleapis.com`, `accounts.google.com`, `oauth2.googleapis.com` | Only if you sign in | Read-only analytics requests for your own channel |
| Your AI provider (Gemini, OpenAI, Anthropic or OpenRouter) | Only when you click an AI button | The prompt: titles, stats, and where relevant transcripts, comments, your script, thumbnails and your channel description |

On YouTube pages, the extension reads the page you're viewing to add badges and the panel. A small script in the page keeps a copy of the caption file the video player downloads, so transcripts work; nothing else in the page is touched or sent anywhere.

## AI providers

AI requests go directly from your browser to the provider you connected, under that provider's terms. On Gemini's free tier, Google may use prompts to improve its products. Avoid sending anything you consider private (for example unpublished scripts) if that matters to you; use a paid tier or a provider whose terms you prefer.

## Permissions

| Permission | Why |
| --- | --- |
| `storage`, `unlimitedStorage` | Save your data locally |
| `alarms` | Daily tracking and the radar |
| `identity` | Google sign-in (only if you use it) |
| YouTube and Google API hosts | Read public YouTube data and, if signed in, your analytics |
| AI provider hosts (optional) | Requested only when you connect that provider |
