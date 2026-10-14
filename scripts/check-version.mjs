// Fails if manifest.json, package.json and (optionally) a tag disagree.
// Usage: node scripts/check-version.mjs [vX.Y.Z]
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url))).version;
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).version;
const tag = process.argv[2];
const errors = [];
if (manifest !== pkg) errors.push(`manifest.json is ${manifest} but package.json is ${pkg}`);
if (tag && tag !== `v${manifest}`) errors.push(`tag ${tag} does not match manifest version v${manifest}`);
const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
if (!changelog.includes(`## [${manifest}]`)) errors.push(`CHANGELOG.md has no "## [${manifest}]" section`);
if (errors.length) {
  console.error(errors.map((e) => `✗ ${e}`).join('\n'));
  process.exit(1);
}
console.log(`✓ version ${manifest}${tag ? ` matches ${tag}` : ''}`);
