YT Toolkit companion: video downloads add-on
============================================

This small app lets the YT Toolkit browser extension save videos and clips.
It's optional: the extension works without it.

Install
  1. In YT Toolkit, open Downloads (or Settings > Video downloads) and copy
     the extension ID.
  2. Run this program:
       Windows  double-click yt-toolkit-companion.exe
                (if Windows says "Windows protected your PC", click
                More info > Run anyway: the app isn't code-signed)
       Mac      in Terminal: ./yt-toolkit-companion
                (first time: right-click it in Finder > Open, because the
                app isn't notarized by Apple)
       Linux    in a terminal: ./yt-toolkit-companion
  3. Paste the ID when asked. It registers itself with Chrome (and Edge,
     Brave or Chromium if installed) and downloads the official downloader.
  4. Back in YT Toolkit, click "Check again".

Optional: install ffmpeg for 1080p video and clips
  Windows: winget install Gyan.FFmpeg    Mac: brew install ffmpeg
  Linux:   sudo apt install ffmpeg

Only download videos you own or have permission to use.

Other commands:  update (get the latest downloader), uninstall, version
Full guide: https://github.com/spiritpaper/youtube-toolkit/blob/main/docs/guides/video-downloads.md
