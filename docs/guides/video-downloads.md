# Video downloads (optional add-on)

Save a video, its audio, or just a clip of it: your own uploads (to cut Shorts from them, say), Creative Commons footage, or anything else you have permission to use. Downloads work for YouTube and most other video sites, including X.

This is an **opt-in add-on**. The extension itself never downloads anything; a small companion app you install separately does. If you don't install it, nothing changes.

> **Only download videos you own or have permission to use.** YouTube, X and most platforms only allow downloading where they offer it themselves, or when you have the rights (your own uploads, Creative Commons or public-domain footage, or the creator's permission). You're responsible for what you download.

## Set it up (about 2 minutes)

1. In Outlier Lab, open **Downloads** in the sidebar and click **Turn on downloads**. Chrome asks to let Outlier Lab "communicate with cooperating native applications": that's the companion.
2. Download the companion for your computer from the [latest release](https://github.com/spiritpaper/outlier-lab/releases/latest) (the Downloads page links the right file):

   | System | File |
   | --- | --- |
   | Windows | `outlier-lab-companion-windows-x64.zip` (or `-windows-arm64`) |
   | Mac with Apple silicon | `outlier-lab-companion-macos-arm64.zip` |
   | Intel Mac | `outlier-lab-companion-macos-x64.zip` |
   | Linux | `outlier-lab-companion-linux-x64.tar.gz` (or `-linux-arm64`) |

3. Unzip it and run it:
   - **Windows:** double-click `outlier-lab-companion.exe`. The app isn't code-signed, so Windows may say "Windows protected your PC": click **More info → Run anyway**.
   - **Mac:** the app isn't notarized, so the first time, right-click it in Finder → **Open**, or run `./outlier-lab-companion` in Terminal.
   - **Linux:** run `./outlier-lab-companion` in a terminal.
4. When it asks, paste the **extension ID** shown on the Downloads page. It registers itself with Chrome (and Edge, Brave or Chromium if you have them), then downloads the official downloader and checks it against its published checksum.
5. Back on the Downloads page, click **Check again**. You'll see **Ready**.

**Optional: ffmpeg** gives you up to 1080p (separate video and audio streams joined together) and clips. Without it, downloads use the best quality available as a single file, and clips aren't possible.

- Windows: `winget install Gyan.FFmpeg`
- Mac: `brew install ffmpeg`
- Linux: `sudo apt install ffmpeg` (or your distribution's package manager)

## Use it

- **Downloads page:** paste any link, choose **Video** or **Audio only**, and optionally a clip (start and end, like `1:05` to `1:40`). Progress, **Cancel**, **Show in folder** and **Retry** are in the list below.
- **On YouTube:** the Outlier Lab panel has a **Download** button once downloads are on.
- **Script lab → Shorts from this video:** each suggested Short has **Download clip**, which saves exactly that stretch.

Files go to `Downloads/Outlier Lab` in your home folder (change it with `outlier-lab-companion install --downloads <folder>`). Clips are named with their time range, so they never overwrite the full video.

## Safety

The companion is deliberately small, and it keeps the downloader on a short leash:

- **Only Outlier Lab can use it.** Chrome only lets the extension IDs you registered talk to it.
- **Only http(s) links are accepted.** The link always goes last, after `--`, so it can't be read as an option.
- **A fixed set of options.** It never runs commands after a download, never uses cookies, logins, password helpers or external downloaders, and ignores any downloader config files on your computer (`--ignore-config`). These are the areas of the downloader's past security advisories.
- **Safe file names, one folder.** File names are restricted to safe characters, and everything is saved to one folder. "Show in folder" only opens files inside it.
- **The official downloader, checked.** It's fetched from its official releases and installed only if its SHA-256 checksum matches. **Update the downloader** on the Downloads page (or `outlier-lab-companion update`) gets the latest version. Keep it current: video sites change often, and updates fix security issues too.
- **Nothing leaves your computer** except the download itself. Your downloads list stays in the extension's storage.

## Commands

| Command | What it does |
| --- | --- |
| `outlier-lab-companion` | Set up (asks for the extension ID) |
| `outlier-lab-companion install --extension-id <id>` | Set up without questions; repeat `--extension-id` for several copies of Outlier Lab |
| `outlier-lab-companion update` | Get the latest downloader |
| `outlier-lab-companion uninstall` | Unregister and remove the app (your downloads stay) |
| `outlier-lab-companion version` | Show the version |

## Troubleshooting

- **"The companion app isn't installed (or not for this copy of Outlier Lab)":** run the companion again and paste the ID shown on the Downloads page. The ID changes if you load the extension from a different folder.
- **A download fails right away:** click **Update the downloader**; sites change and the downloader keeps up. Some videos (private, members-only, age-restricted) can't be downloaded without logging in, which the companion deliberately doesn't do.
- **No 1080p, or "downloading a clip needs ffmpeg":** install ffmpeg (above).

## Credits

Downloads are done by [**yt-dlp**](https://github.com/yt-dlp/yt-dlp), the open-source video downloader by the yt-dlp contributors (released into the public domain under the Unlicense). Merging and clipping use [**FFmpeg**](https://ffmpeg.org/) when it's installed. Thank you to both projects.
