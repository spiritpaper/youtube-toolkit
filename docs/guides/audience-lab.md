# Audience lab

The Audience lab gives your channel a test audience: **avatars**, realistic but fictional viewers built from your real data. Use them to see how a video might land before you publish it.

## Avatars

Each avatar is one kind of viewer:
- **who they are:** age, place, job or life stage, interests, and how much they already know about your topic
- **why they watch:** what they want, what they believe, what frustrates them, what moves them, and what makes them click away
- **how they watch:** phone or TV, how they find you (search, home feed, subscriptions…), whether they're a subscriber, returning or new, and how they comment, with a line in their own voice
- **their share of your audience** (≈ 15% of viewers), so the group as a whole mirrors who really watches

Avatars are composites. They never copy a real commenter's name, handle or words. They're described without judgment: being bored, skeptical or annoyed by a video is a normal reaction, and that's exactly what a test audience is for.

## Build a group

**Audience lab** (sidebar) → **Build my audience** (or **+ New group**). Choose what it's built from:

| Source | What's used |
| --- | --- |
| **My channel** (recommended; sign in on [My channel](my-channel.md)) | Your last 90 days of analytics: age and gender split, top countries, devices, subscribers vs not (and how much each group watches), how people find your videos, plus your most viewed videos and up to 100 recent comments (1 API unit) |
| **My channel description** | What you wrote under **Settings → AI → Describe your channel** |
| **A channel I follow** | That channel's recent videos and comments: an audience you want to win over |
| **Start empty** | Nothing: add avatars by hand |

Choose how many avatars you want (8 by default, up to 20). More avatars give a fuller picture, but every test screening costs more AI tokens. Optionally, say who the group represents ("newcomers from search", "people who've never edited a video").

**The data these avatars are based on**, under the group, shows the exact sheet the AI saw. Each avatar's **Based on** line says which data it reflects.

## Shape the group

- **Lock** an avatar you like: **Regenerate unlocked** replaces the others and keeps it.
- **Edit** any avatar, or **Add an avatar** by hand (for example, a viewer you know well).
- Keep several groups, for example "My audience", "Newcomers from search", or "Fans of a channel I follow".

Groups are saved in the extension, included in backups, and shown under **Settings → Storage & data**.

## Test screenings

A test screening runs a video past one of your groups, viewer by viewer, the way real viewers meet it:

1. **The feed.** Each viewer sees your title among other titles (your strongest saved outliers and radar finds) and decides: click, maybe, or scroll past. You get their first thought and why.
2. **The opening.** Viewers who clicked watch the first ~30 seconds of your script and stay or leave, at a given second, and say why.
3. **The story.** Viewers who stayed watch the rest beat by beat (the script is split into beats of about a minute). For each beat, they give attention 0–10, an emotion, a thought in their own voice, and whether they leave. Viewers who reach the end say whether they'd like it, comment (with the comment), subscribe, share or watch another, and what they'd tell a friend.
4. **The editor's notes.** What works, what to change ranked by how much of the audience it affects (where, who, why, and the fix), and whether to keep the title, with alternatives.

**Run one** from a project's **Test screening** card (choose the group and which of the project's titles to test), or from **Audience lab → Test screenings**. A screening takes 3 AI calls. It tests the title, the opening and the script; with only an outline, the outline's lines stand in for the beats; with neither, only the title is tested.

### Options

- **Include the thumbnail** (needs a thumbnail uploaded on the project): the viewers see your thumbnail in the feed, next to the real thumbnails of the other videos, so they judge the whole package. The first AI call carries the images, so it costs more.
- **Run twice and combine:** two independent runs, averaged (5 AI calls instead of 3). Each number then shows how far apart the runs were ("±6 pts between runs"): small means steady, large means "don't decide on this alone".

## Compare titles (title A/B)

**Compare titles** on a project's Test screening card shows all its title options (the working title plus the ones in **Titles**, up to 4) to every viewer. That's one AI call, plus the thumbnail if you include it. Each viewer judges every title on its own, in a fresh random order every time, says whether they'd click and their first thought, then picks a favorite.

The comparison shows, for each title:
- how many would click (weighted, "maybe" counts half)
- whose favorite it is
- **wins over:** viewers who'd click this title but not every other one, the people a title brings in that the others lose

When the top titles are within 5 points, it says it's too close to call.

### The report

- **Would click, stay past the opening, watch on average, reach the end, would subscribe.** These are computed by the extension from the viewers' answers, weighted by each viewer's share of your audience. They're shown next to your channel's real numbers when you're signed in.
- **Through the video:** the attention curve and how many are still watching, with every beat's main feeling and who left where.
- **Every viewer:** their click, first thought, how far they got and why they left, their comment, and their beat-by-beat reactions.
- **Copy report** puts the raw results and the notes on your clipboard.

### What to expect

The same notes are on every Test screening card:

- **Best for comparing:** two titles, or a script before and after a rewrite, on the same audience. Also for finding where viewers drift and why.
- **Estimates, not view counts:** simulated viewers can't know how far YouTube will push a video.
- **Small groups vary:** every number shows how many viewers it rests on; run twice for steadier numbers, and re-test close calls.
- **It gets better the more you use it.** Every screening is saved. Once a video is published, the lab compares its forecast with what really happened and corrects the next screenings with it. Locking the avatars that ring true, and building groups from your own analytics, sharpens it too.

### Keeping it honest

Simulated viewers tend to be too kind. To counter that:
- Each viewer gets a **typical watch time**, from your channel's real subscriber and non-subscriber averages (signed in) or common YouTube rules of thumb (not signed in), adjusted for their device. Leaving around that point is treated as normal.
- Viewers watch rather than read, and the instructions say plainly that a group where everyone finishes is unrealistic.
- Reactions are reported without judging the viewer: boredom, doubt and irritation are data.

Even so, the numbers are best for **comparing**: two titles, or a script before and after a rewrite. Use them to see where it drags and what confuses, rather than to predict exact views. Stage 4 will compare each screening with how the video really did.
