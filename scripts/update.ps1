# Updates an unpacked Outlier Lab install to the latest GitHub release (Windows).
#   Double-click scripts\update.cmd inside the extension folder, or:
#   powershell -ExecutionPolicy Bypass -File scripts\update.ps1 C:\path\to\outlier-lab
# Downloads the release zip only when it's newer than the folder's version,
# then replaces the folder's files. Your data lives in Chrome, not in the
# folder, so it stays. The extension reloads itself within a few minutes,
# once no Outlier Lab page is open (or click reload in chrome://extensions).
# Works in Windows PowerShell 5.1 and PowerShell 7 (also on macOS/Linux).
param([string]$Folder = (Join-Path $PSScriptRoot '..'))
$ErrorActionPreference = 'Stop'
$Folder = (Resolve-Path $Folder).Path
$manifestPath = Join-Path $Folder 'manifest.json'
if (-not (Test-Path $manifestPath)) { throw "No manifest.json in $Folder. Is that the extension folder?" }
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

$current = (Get-Content -Raw $manifestPath | ConvertFrom-Json).version
$release = Invoke-RestMethod -Uri 'https://api.github.com/repos/spiritpaper/outlier-lab/releases/latest' -Headers @{ 'User-Agent' = 'outlier-lab-updater' }
$latest = $release.tag_name -replace '^v', ''
# The extension zip (outlier-lab-v…, or youtube-toolkit-v… before the rename), not a companion archive.
$asset = $release.assets | Where-Object { $_.name -match '^(outlier-lab|youtube-toolkit)-v.*\.zip$' } | Select-Object -First 1
if (-not $latest -or -not $asset) { throw "Couldn't read the latest release from GitHub." }

if ([version]$latest -le [version]$current) {
  Write-Host "Up to date ($current)."
  exit 0
}

$tmp = Join-Path ([IO.Path]::GetTempPath()) ("yt-toolkit-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
  $zip = Join-Path $tmp 'release.zip'
  Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zip -UseBasicParsing -Headers @{ 'User-Agent' = 'outlier-lab-updater' }
  $new = Join-Path $tmp 'new'
  Expand-Archive -Path $zip -DestinationPath $new
  if (-not (Test-Path (Join-Path $new 'manifest.json'))) { throw "The download doesn't look like the extension; nothing changed." }
  # Replace the folder's contents with the release (removing files it no longer has).
  Get-ChildItem -Path $Folder -Force | Remove-Item -Recurse -Force
  Copy-Item -Path (Join-Path $new '*') -Destination $Folder -Recurse -Force
  Write-Host "Updated $current -> $latest. The extension reloads itself shortly."
} finally {
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
