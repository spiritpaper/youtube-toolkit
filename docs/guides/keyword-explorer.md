# Keyword explorer (rabbit holes)

Dig from a broad topic into specific sub-topics, one level at a time, and see where outliers cluster. The path you take is saved as a tree, so you can climb back up and follow another branch.

Open it from the sidebar (**Discover → Keyword explorer**), from Home, or from **Explore topic** in the video panel.

## Dig in

1. Type a broad keyword, e.g. `budget travel`, and click **Dig in**. Autocomplete suggests real YouTube searches as you type.
2. The explorer reads YouTube's own search results ("relevance" and "most viewed this year", about 40 videos, for free) and scores every video against its own channel.
3. You see:
   - **Opportunity (0–100)**: how promising the keyword is ([formula](../reference/metrics.md#keyword-opportunity))
   - **Outliers ≥ 2x**: how many results beat their channel by 2x or more
   - **Small-channel outliers**: outliers from channels under 50K subscribers (the idea worked, not the fame)
   - **Demand**: median views of the last year's results
   - **Competition**: median subscribers of the channels ranking
   - **Freshness**: share of results from the last 6 months

## Go deeper

Under **Dig deeper** you get three kinds of next steps:

- **Searches**: YouTube autocomplete for this keyword
- **In outliers**: phrases and words that keep appearing in this keyword's outlier titles
- **AI angles** (optional): sub-niches and angles the AI spots in the outliers

Click one to explore it as a child of the current keyword. Already-explored chips show ✓. You can also type any keyword in **Or type a keyword to dig into…**, or click **Dig** on a result to explore that video's topic.

## Climb back up

- The **trail** at the top (`budget travel › budget travel japan › japan rail pass`) takes you back up any level.
- The **Rabbit holes** tree on the left shows every keyword you've explored, with its opportunity score. Click any node to return to it; ✕ deletes it and everything below.

## Work with the results

- Filter presets: **All**, **Outliers ≥ 2x**, **Small-channel hunt** (≥2x, 100K+ views, ≤25K subs, last 3 months), **Channels < 50K subs**, **Last 6 months**; filter by format; sort by outlier score, views per day, views or date.
- **☆ Save** keeps a video in Saved outliers and remembers the keyword path that led to it.
- **Web** opens the video's [video web](video-web.md).
- **★ Star** marks good keywords; add **notes** per keyword.
- **🔔 Alert me** checks the keyword daily and puts new outliers on your Radar ([keyword alerts](channels.md#keyword-alerts)).
- **Export CSV** (left panel) exports every keyword with its metrics; **Export results CSV** exports one keyword's videos.

## Cost

Searching is free. Scoring costs about 1 API unit plus ~5 units for each channel whose data isn't already cached (12 hours), so a first dig into a new topic is often 100–200 units of your 10,000/day. Digging deeper into related keywords is cheaper, because many channels repeat. If YouTube's search page can't be read (for example a cookie-consent page in some regions), the explorer falls back to the official search API, which costs 100 units.

Rabbit holes not touched for 180 days are deleted automatically (change this under **Settings → Storage & data**).
