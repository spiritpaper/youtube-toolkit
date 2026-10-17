# Releasing

Releases are built by GitHub Actions when you push a version tag. Each release gets the extension zip and notes taken from `CHANGELOG.md`.

## The flow

1. **Bump the version** in both `manifest.json` and `package.json` (they must match).
2. **Add a changelog section** at the top of `CHANGELOG.md`:
   ```
   ## [0.7.0] - 2026-11-01
   ### Added
   - …
   ```
3. **Check locally**:
   ```
   npm run check-version     # manifest, package.json and changelog agree
   npm test
   npm run package           # builds dist/outlier-lab-v0.7.0.zip from HEAD
   ```
   Load the zip (unzipped) in Chrome and try it.
4. **Commit, tag and push**:
   ```
   git commit -am "Release 0.7.0"
   git tag -a v0.7.0 -m "Outlier Lab 0.7.0"
   git push origin main
   git push origin v0.7.0
   ```
5. The **Release** workflow (`.github/workflows/release.yml`):
   1. checks the tag matches the manifest, `package.json` and the changelog
   2. runs the tests
   3. builds the zip
   4. publishes a GitHub Release named "Outlier Lab v0.7.0" with the zip attached and the changelog section as notes

   If any check fails, nothing is published. Fix it, delete the tag (`git push origin :v0.7.0`, `git tag -d v0.7.0`), and tag again.

The **CI** workflow (`.github/workflows/ci.yml`) runs on every push and pull request: syntax check, version check and tests.

## What's in the zip

`scripts/package.sh` uses `git archive`, so the zip contains exactly the committed files of that version, minus everything marked `export-ignore` in `.gitattributes` (tests, scripts, CI files, `package.json`). `manifest.json` sits at the zip's root, so the same file works for:

- **Users**: unzip into a folder, then `chrome://extensions` → Developer mode → **Load unpacked**.
- **Chrome Web Store**: upload the zip as-is.

You can build any version's zip from its tag: `sh scripts/package.sh v0.6.0`.

## Versioning

`MAJOR.MINOR.PATCH`: bump MINOR for new features, PATCH for fixes. Chrome compares `manifest.json` versions to decide whether an installed copy is older, so never reuse or lower a version.

## Working on the next version

Unreleased work lives on a branch (for example `feature/creator-checklists`) and is merged into `main` when it's ready to ship. Only push the branches you mean to make public: `git push origin main` pushes `main` only.
