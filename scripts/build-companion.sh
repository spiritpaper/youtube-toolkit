#!/bin/sh
# Builds the companion app for every platform into dist/companion/.
#   sh scripts/build-companion.sh [version]     (default: the manifest version)
# Each archive holds the program and a short README. Needs Go and zip.
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
version="${1:-$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$root/manifest.json" | head -1)}"
version="${version#v}"
out="$root/dist/companion"
rm -rf "$out"
mkdir -p "$out"
for target in windows/amd64/windows-x64 windows/arm64/windows-arm64 darwin/arm64/macos-arm64 darwin/amd64/macos-x64 linux/amd64/linux-x64 linux/arm64/linux-arm64; do
  goos=${target%%/*}; rest=${target#*/}; goarch=${rest%%/*}; label=${rest#*/}
  stage=$(mktemp -d)
  bin=outlier-lab-companion
  [ "$goos" = windows ] && bin="$bin.exe"
  (cd "$root/companion" && CGO_ENABLED=0 GOOS=$goos GOARCH=$goarch go build -trimpath -ldflags "-s -w -X main.Version=$version" -o "$stage/$bin" .)
  cp "$root/companion/README.txt" "$stage/README.txt"
  if [ "$goos" = linux ]; then
    tar -C "$stage" -czf "$out/outlier-lab-companion-$label.tar.gz" .
  else
    (cd "$stage" && zip -q -X "$out/outlier-lab-companion-$label.zip" "$bin" README.txt)
  fi
  rm -rf "$stage"
done
ls "$out"
