#!/bin/sh
# Builds the installable extension zip from a git ref (default: HEAD).
#   sh scripts/package.sh            -> dist/youtube-toolkit-v<version>.zip from HEAD
#   sh scripts/package.sh v0.6.0     -> the same, from the v0.6.0 tag
# The zip has manifest.json at its root, so it can be uploaded to the Chrome
# Web Store as-is, or unzipped into a folder and loaded with "Load unpacked".
# Files marked export-ignore in .gitattributes (tests, CI, scripts) are left out.
set -eu
ref="${1:-HEAD}"
version=$(git show "$ref:manifest.json" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).version))")
mkdir -p dist
out="dist/youtube-toolkit-v$version.zip"
git archive --format=zip -o "$out" "$ref"
echo "$out"
