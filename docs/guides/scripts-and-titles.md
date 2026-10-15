# Scripts, hooks and titles

Study how outlier videos are written, and test your own titles.

## Transcripts

On any YouTube video, click **Transcript** in the YT Toolkit panel. Then:

- **Download .txt**: timestamped transcript
- **Save transcript**: keeps it with the saved outlier (saves the outlier too)
- **Analyze script**: saves both and opens the Script analyzer

How it works: YouTube doesn't let other code download captions, so the extension keeps a copy of the caption file the video player itself downloads. If the player hasn't loaded captions yet, the extension switches CC on for a moment and back off. As a last resort it opens YouTube's transcript panel and reads it. Creator-written captions are preferred over auto-generated ones. Videos without captions can't be transcribed.

## Script analyzer

Open it with **Analyze script**, or from a saved outlier that has a transcript (**Analyze script**). Without AI it shows:

| Section | What it tells you |
| --- | --- |
| **Hook** | The first 30 seconds, and which hook signals it uses: echoes the title, states what the video delivers, opens a loop or asks a question, raises stakes, talks to "you", gets to the point fast. These are common tactics, not rules: calm guides can open without them. |
| **Pace** | Words per minute (about 150 is conversational) |
| **Attention devices** | A timeline with one lane per device: teases/open loops, twists, questions, stakes, story beats, calls to action. Hover for the quote, click to jump to that moment. |
| **Most replayed** | What was said at the heatmap's peaks. A peak with no speech is usually a visual moment. |
| **Where viewers left** | For your own videos (signed in): what was said at the biggest drops in your retention curve |
| **Keywords spoken** | Most-used terms, when each is first said, and how often the title's words are spoken |
| **Structure** | The video in sections: pace, devices and replay intensity per section |
| **Transcript** | Full text, with attention devices highlighted |

**Break down the script with AI** explains the hook, the story beats (with timestamps), every attention tactic (with quotes), the language and keywords, whether the video delivers on its title, why viewers replayed or left, and a reusable beat sheet. **Outline my version** turns that structure into a hook, beat sheet and re-hook lines for your topic, which you can **Save as a project**.

## My notes

Every analyzed script has a **My notes** card near the top: your own observations, each pinned to a moment in the video.

- Type a time (`3:42`, `1:02:03` or seconds) and the note, then **Add note** (or Ctrl+Enter).
- **+ note** next to any transcript line (shown on hover) fills in that line's time.
- Click a note to edit it or change its time; click its time to open the video at that moment. Notes support Markdown (**bold**, lists, links).
- **Download** saves them as a Markdown list with timestamped links.

Notes added from the [panel on YouTube](finding-outliers.md#the-video-panel) show up here instantly, and vice versa. The Script lab start page lists every video you've taken notes on, including ones you haven't analyzed yet. Notes are included in backups and are only deleted by **Delete everything**.

## Hook library

**Script lab** (sidebar) opens the hook library: the first 30 seconds of every saved outlier with a transcript, strongest outliers first, with the hook signals each uses. **Export hooks** downloads them as text. The [Hook rewriter](idea-board.md#script-and-script-check) uses this library as its models, so the more transcripts you save, the better it gets.

## Title lab

**Create → Title lab.** Type a few draft titles (one per line), plus optionally your target keyword and your thumbnail text. Each draft gets:

- a **packaging checklist** score: fits on mobile (about 60 characters), long enough, keyword near the start, a specific number, curiosity or tension, an emotional/high-stakes word, a personal angle, not too many CAPS, doesn't repeat the thumbnail text, under YouTube's 100-character limit. The score is guidance from common packaging advice, **not** a CTR prediction.
- a **preview** as a phone home-feed card (2 lines) and a one-line search result
- the **closest proven outliers**: titles from your saved outliers and your followed channels' outliers with the same structure (number, money, first person, time span, experiment, warning…)

**Improve with AI** ranks your drafts and writes 6 stronger versions under 60 characters, borrowing from the proven outliers, plus the one title it would publish and the thumbnail text to pair with it. From a project, **Test in Title lab →** fills the drafts in for you.

## Audience questions

What viewers ask, request and struggle with, from a video's top comments. Open it with **Comments** in the video panel or on a saved outlier, or **Audience questions** in the Script analyzer, or paste a link on the page.

The top 100 comments (by relevance) are read for 1 API unit and **saved permanently**, so opening it again is free (**Refresh** re-reads them). They're sorted into:

- **Video requests**: "make a video about…", "part 2", "can you try…" (ready-made ideas)
- **Questions**: unanswered questions are gaps you can fill
- **Pain points**: frustrations and confusion
- **Moments people mention**: timestamps viewers quote (click to jump), grouped when close together
- **Words viewers use**

**Turn into video ideas (AI)** summarises what the audience wants next, their pain points and what they loved, with 6 video ideas that answer them, which you can **Save as a project**.
