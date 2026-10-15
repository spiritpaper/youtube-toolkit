# My channel (Google sign-in)

Sign in with Google to see your **own** analytics: retention curves, watch time, average % viewed, subscribers, traffic sources and (where available) thumbnail click-through rate. The extension only asks for **read-only** access.

## One-time setup (about 5 minutes)

Use the same Google Cloud project as your YouTube API key.

1. Enable the [YouTube Analytics API](https://console.cloud.google.com/apis/library/youtubeanalytics.googleapis.com).
2. Open [Google Auth Platform](https://console.cloud.google.com/auth/overview):
   - set an app name and your email
   - choose **External**
   - under **Audience**, add your own Google account as a **test user**
3. Open [Clients](https://console.cloud.google.com/auth/clients) → **Create client** → **Web application**. Under **Authorized redirect URIs**, add the address shown on the **My channel** page. It looks like `https://<extension-id>.chromiumapp.org/`, and there's a **Copy** button.
4. Copy the **Client ID**, paste it on the My channel page, and click **Save & sign in with Google**.
5. Google warns the app is unverified, because it's your own app. Click **Continue**.

If you move the extension folder, its ID and redirect address change: add the new address to the client.

## What you get

**My channel** (sidebar → You):

- headline numbers for the last 7, 28 or 90 days, each compared with the previous period: views, watch time, average view duration, average % viewed, net subscribers, likes
- a daily views chart
- **Audience retention**: tick up to 3 videos to overlay their retention curves (values above 100% mean rewatches). A second chart shows each moment compared with YouTube videos of similar length (0.5 = typical, 1.0 = best). A summary gives how many viewers remain at 10%, 50% and 90%, the steepest drop, rewatched moments and traffic sources.
- **Top videos**: views, watch time, average % viewed, average duration, subscribers gained, thumbnail impressions and CTR (when available), and the same public **outlier score** used for every other channel

Signing in also:

- adds your row to **Compare** and the "you vs competitors" summary
- removes topics you've already covered from **Content gaps**
- adds your real retention, watch time and CTR to a project's **After publishing** section
- maps your retention drop-offs onto your script in the **Script analyzer**

## Honest channel review (AI)

**Review my channel with AI** (on My channel) writes a review of your channel built only on your own analytics for the selected period (7, 28 or 90 days):

- totals against the previous period, and how daily views moved
- every top video: views, watch time, % viewed, subscribers gained, outlier score against your own median, and impressions and click-through rate where the API provides them
- retention of your most-viewed long-form videos: how many viewers are left at 10%, 50% and 90%, the steepest drop and rewatched moments as timestamps, and **what you said at the drop** if you've saved that video's transcript (Transcript → Save transcript in the panel on YouTube)
- traffic sources, and your channel profile next to the channels you follow

The AI is told not to hold back. You get a verdict, then every problem, worst first, each with **What**, **Where** (video and timestamp, or metric), **Evidence** (the numbers), **Fix** and **Check** (which number should move if the fix works), followed by what's working, three experiments for your next uploads, and what the data can't tell. It may only use the data it was given; general YouTube advice is labeled as a rule of thumb.

Open **The data this review was based on** under a review to see exactly what the AI saw. The last 12 reviews are kept (and backed up), so you can compare them over time from **Past reviews**.

## Notes

- YouTube Analytics data lags by about 2 days.
- It uses the Analytics API's own quota, not your 10,000 Data API units.
- Thumbnail impressions and CTR aren't in Google's documented metric list; the extension requests them and shows them only if your account's API returns them.
- Sign-in tokens last an hour, live only in memory and renew silently while you're signed in to Google in the browser. **Sign out** revokes the token and deletes cached analytics.
- This uses Google's browser sign-in flow for extensions (`chrome.identity.launchWebAuthFlow`), which Google documents as a legacy method. If Google retires it, sign-in will need an update; nothing else is affected.
