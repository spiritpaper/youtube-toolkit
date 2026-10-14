// "Most replayed" heatmap as an SVG area chart, for extension pages.
// (src/content/shared.js has the same drawing for the YouTube page.)

const NS = 'http://www.w3.org/2000/svg';

export function heatmapSvg(points, { width = 280, height = 40, peaks = [] } = {}) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('class', 'heatmap');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Most replayed moments');
  const last = points[points.length - 1];
  const total = last.start + last.duration;
  const x = (t) => (t / total) * width;
  const y = (v) => height - 2 - v * (height - 4);
  const path = document.createElementNS(NS, 'path');
  path.setAttribute(
    'd',
    `M0,${height} ${points.map((p) => `L${x(p.start + p.duration / 2).toFixed(1)},${y(p.intensity).toFixed(1)}`).join(' ')} L${width},${height} Z`,
  );
  svg.append(path);
  for (const p of peaks) {
    const line = document.createElementNS(NS, 'line');
    for (const [k, v] of Object.entries({ x1: x(p.start), x2: x(p.start), y1: 0, y2: height })) line.setAttribute(k, v);
    svg.append(line);
  }
  return svg;
}
