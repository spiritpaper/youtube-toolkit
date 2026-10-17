Outlier Lab companion: video downloads add-on
============================================

This small app lets the Outlier Lab browser extension save videos and clips.
It's optional: the extension works without it.

Install
  1. In Outlier Lab, open Downloads (or Settings > Video downloads) and copy
     the extension ID.
  2. Run this program:
       Windows  double-click outlier-lab-companion.exe
                (if Windows says "Windows protected your PC", click
                More info > Run anyway: the app isn't code-signed)
       Mac      in Terminal: ./outlier-lab-companion
                (first time: right-click it in Finder > Open, because the
                app isn't notarized by Apple)
       Linux    in a terminal: ./outlier-lab-companion
  3. Paste the ID when asked. It registers itself with Chrome (and Edge,
     Brave or Chromium if installed) and downloads the official downloader.
  4. Back in Outlier Lab, click "Check again".

Optional: install ffmpeg for 1080p video and clips
  Windows: winget install Gyan.FFmpeg    Mac: brew install ffmpeg
  Linux:   sudo apt install ffmpeg

Only download videos you own or have permission to use.

Other commands:  update (get the latest downloader), uninstall, version
Full guide: https://github.com/spiritpaper/outlier-lab/blob/main/docs/guides/video-downloads.md
