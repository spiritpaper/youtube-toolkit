// Version helpers for updates. Chrome versions are 1–4 dot-separated numbers.

/** -1, 0 or 1, comparing "0.7.0" with "v0.7.1" (a leading v is ignored). */
export function compareVersions(a, b) {
  const parts = (v) => String(v ?? '').replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  const x = parts(a);
  const y = parts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

/** What identifies the files on disk: build.json's commit if present, else the manifest version. */
export const stampOf = (build, manifest) => (build?.commit ? `${build.version ?? manifest?.version}@${build.commit}` : `${manifest?.version ?? '?'}`);
