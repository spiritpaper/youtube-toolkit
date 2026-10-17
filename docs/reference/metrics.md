# How the numbers are calculated

Every number in Outlier Lab comes from public YouTube data (or, for **My channel**, your own analytics) through simple, documented math. Formulas live in `src/lib/` (mostly `stats.js`) and are covered by tests.

## Outlier score

> **outlier score = video views ÷ median views of the channel's 30 most recent videos of the same format**

- **Format**: long-form and Shorts are scored separately, using YouTube's per-format upload playlists (`UULF…` long-form, `UUSH…` Shorts). If a channel has neither, the full uploads playlist is used and videos of 3 minutes or less count as Shorts.
- **Settled videos only**: videos younger than 3 days are left out of the baseline (they haven't collected their views yet), unless fewer than 5 older videos exist. Upcoming premieres are ignored.
- **Median, not average**, so one viral hit doesn't distort the baseline.
- Tiers: under 0.5x underperforming · 0.5–2x typical · 2–5x outlier · 5–10x strong outlier · 10x+ breakout (the 2x / 5x / 10x tiers outlier tools commonly use).

Related numbers:

| Number | Formula |
| --- | --- |
| Score vs average | views ÷ mean views of the same 30 videos |
| Channel percentile | share of the channel's recent same-format videos (excluding this one) with fewer views; ties count half. Shown as "Top 3%" / "Bottom 20%". |
| Views per day | views ÷ days since publishing (views per hour under 2 days) |
| Like rate / comment rate | likes ÷ views, comments ÷ views |
| Like rate vs channel | this video's like rate ÷ the median like rate of the channel's recent videos |
| Views ÷ subscribers | video views ÷ channel subscribers |

## Channel numbers

| Number | Formula |
| --- | --- |
| Median views | baseline median of the last 30 settled long-form videos (Shorts separately) |
| Uploads per week | number of recent uploads ÷ days from the oldest of them to today × 7 |
| Hit rate | share of the last 30 settled videos with ≥ 2x the channel's own median |
| Views per subscriber | median long-form views ÷ subscribers ("reach beyond the subscriber base") |
| Trend: momentum | median views of the most recent uploads ÷ median of the ones before. Uses videos at least 14 days old (3 if there are fewer than 8), up to 50; "recent" is a third of them, between 3 and 10 videos. **Growing** ≥ 1.25, **declining** ≤ 0.8, otherwise stable. |
| Trend: % per month | slope of a straight line fitted to log₁₀(views) against upload date, as 10^(slope × 30) − 1 |
| 30-day change (Following) | latest snapshot minus the oldest snapshot within the window |

Caveat: older videos have had longer to collect views, which nudges the trend toward "declining". The 14-day minimum age reduces this.

## Keyword opportunity

For a keyword's ~40 search results, each scored against its own channel:

> **opportunity = 100 × (0.4 × A + 0.2 × B + 0.2 × C + 0.2 × D)**

| | Signal | Full marks when |
| --- | --- | --- |
| A | share of results that are ≥ 2x outliers | 50% or more |
| B | share of results from channels under 50K subscribers | 50% or more |
| C | share of results from the last 6 months | 100% |
| D | median views of the last 12 months' results, as log₁₀(views) ÷ 6 | 1M+ views |

Also shown: small-channel outliers, demand (D's median views), competition (median subscribers), freshness (C).

**Related phrases** ("In outliers"): two- and three-word phrases, and single words appended to the keyword, that appear in at least two outlier titles (tags count half), excluding the keyword's own words and filler.

## Content gaps

From the 2x+ outliers among your followed channels' recent uploads:

1. **Topics**: every non-generic word (3+ letters) and two-word phrase in their titles.
2. **Candidates**: topics in 2+ outliers, or in one 5x+ breakout.
3. **Strength**: Σ log₂(outlier score) over the topic's outliers × (1 + 0.5 × (number of channels − 1)).
4. **Lift**: (share of outliers with the topic) ÷ (share of the channels' other recent uploads with it, +1 smoothing). Topics with lift under 1.3 are dropped: they're just the niche's everyday words.
5. **Score**: strength × min(lift, 4) × 1.5 for two-word topics.
6. Topics already in your own recent titles are removed, and topics whose videos are all listed under a stronger topic are merged away.

## Radar

- **Channels**: uploads from the last 14 days with ≥ 2x their channel's median.
- **Keywords**: new search results from the last 30 days with ≥ 2x their channel's median.
- Each video is reported once; videos that existed when you followed are never reported.

## Script analysis

**Hook signals** (first 30 seconds): echoes the title (≥ 30% of the title's words, loosely matched so "Japanese" counts for "Japan") · says what the video will deliver ("in this video", "by the end", "I'm going to…") · opens a loop or asks a question · raises stakes · talks to "you" · gets to the point (≤ 90 words).

**Attention devices** (matched per transcript line):

| Device | Examples it looks for |
| --- | --- |
| Open loop / tease | "later in this video", "by the end", "stick around", "coming up", "I'll show you" |
| Twist / turn | "but then", "however", "turns out", "the problem is", "that's when" |
| Question | a question mark, or a line starting "why / how / what / have you…" |
| Stakes / tension | money amounts, "mistake", "never", "scam", "regret", "lost", "danger" |
| Story beat | "so I", "I was", "that night", "I realized", "I decided" |
| Call to action / sponsor | "subscribe", "link below", "sponsored", "use my code" |

These are pattern matches that find *candidates*; the AI breakdown explains them properly.

| Number | Formula |
| --- | --- |
| Pace | total words ÷ minutes |
| Devices per minute | device count ÷ minutes (calls to action excluded from the total) |
| Drift zone (your draft) | a gap of 60+ seconds between attention devices |
| Re-hook checkpoint | a device within ±8% of the runtime of the 25%, 50% or 75% mark |
| Draft timing | each sentence starts at (words before it ÷ pace) minutes |

## Replay heatmap ("Most replayed")

YouTube's 100-bucket replay graph, read from the watch page. Values are relative to the video's own peak (1.0 = most replayed); this is **not** the creator's retention curve.

- **Peaks**: the 3 highest buckets at least 5 buckets apart, skipping the first 3 (autoplay inflates the start).
- **Hold ratio**: average intensity of the second half ÷ the first half (after the intro).

## Title lab checklist

Weighted checks (weight in brackets); the score is the weighted share passed:

fits on mobile ≤ 60 characters (2) · at least 20 characters (1) · keyword within the first 40 characters (1) · a number or amount (1) · curiosity or tension, or a question (2) · an emotional or high-stakes word (1) · a personal angle "I/you" (1) · at most one all-caps word (1) · shares less than half its words with the thumbnail text (1) · within YouTube's 100-character limit (3).

**Closest proven outliers**: word overlap (Jaccard) + 0.08 for each shared structure (number, money, question, first person, "you", comparison, time span, experiment, how-to, warning).

## Video web

- **Hub**: suggested from 2+ videos in the web (in-degree).
- **Two-way link**: A suggests B and B suggests A.
- **Topic cluster**: videos joined by suggestion links whose title + tag words overlap ≥ 15% (Jaccard); clusters of 3+.
- **Words in outliers**: words in 2+ of the web's outliers with lift ≥ 1.5 against its other videos.

## Comments

Top 100 comments by relevance. **Requests** ("make a video about…", "part 2", "can you try…", "you should do…") · **questions** (a "?" anywhere, or an opener like "how / why / any tips", excluding requests) · **pain points** ("I wish", "too long", "confusing", "doesn't work", "scam"…) · **moments** (timestamps quoted, merged within 10 seconds). Lists are sorted by likes.

## After publishing

Outlier score = views ÷ your channel's median for the same format, at each snapshot. The **48-hour** and **7-day** values are the first snapshots taken between 48–72 hours and 7–9 days after publishing; if the video was linked later, they stay "not captured" rather than showing a misleading number.

## CSV columns

**Saved outliers → Export CSV** (one row per outlier):

`video_id`, `title`, `url`, `channel`, `channel_id`, `format`, `duration_sec`, `published`, `saved`, `last_updated`, `available`, `age_days`, `views`, `likes`, `comments`, `views_per_day`, `like_rate`, `comment_rate`, `channel_subs`, `channel_total_views`, `channel_video_count`, `views_per_sub`, `channel_median_views`, `channel_avg_views`, `baseline_sample`, `outlier_score_vs_median`, `score_vs_average`, `above_channel_average`, `channel_percentile`, `channel_like_rate`, `like_rate_vs_channel`, `channel_trend`, `channel_momentum`, `channel_trend_pct_per_month`, `channel_recent_median`, `channel_prior_median`, `channel_uploads_per_week`, `snapshots`, `days_tracked`, `views_at_first_snapshot`, `views_gained_since_saved`, `views_per_day_since_saved`, `view_growth_since_saved`, `subs_change_since_saved`, `found_via_keyword`, `found_via_path`, `replay_peaks`, `replay_hold_ratio`, `has_transcript`, `tags`, `notes`, `ai_breakdown`

Rates are fractions (0.05 = 5%).

**Export history** (one row per outlier per day): `video_id`, `title`, `channel`, `format`, `date`, `timestamp`, `days_since_published`, `views`, `likes`, `comments`, `channel_subs`, `channel_median_views`, `outlier_score`.
