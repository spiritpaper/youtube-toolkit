// Minimal SVG line chart with a crosshair tooltip, for extension pages.
// Follows the dataviz rules: 2px lines, hairline recessive grid, one y-axis,
// a legend whenever there are 2+ series, text in text colors (never the
// series color), and the tooltip lists every series at the hovered x.
//
// series: [{ name, color (CSS color/var), points: [{ x, y }] }]

const NS = 'http://www.w3.org/2000/svg';

function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function niceMax(v) {
  if (!(v > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v);
}

export function lineChart({
  series,
  height = 220,
  xFormat = String,
  yFormat = String,
  yMin = 0,
  yMax = null,
  xTicks = 5,
  yTicks = 4,
  refLine = null, // { y, label }
  label = 'Chart',
  area = false,
}) {
  const root = document.createElement('div');
  root.className = 'viz';
  const all = series.flatMap((s) => s.points);
  if (!all.length) {
    root.textContent = 'No data for this period.';
    return root;
  }
  // Drawn at the real pixel width (and redrawn on resize) so text stays 11px.
  let drawnWidth = 0;
  new ResizeObserver(() => {
    const w = Math.round(root.clientWidth);
    if (w && w !== drawnWidth) {
      drawnWidth = w;
      draw(w);
    }
  }).observe(root);

  function draw(width) {
    const pad = { l: 48, r: 12, t: 10, b: 26 };
    const xs = all.map((p) => p.x);
    const xMin = Math.min(...xs);
    const xMax = Math.max(...xs);
    const top = yMax ?? niceMax(Math.max(...all.map((p) => p.y), refLine?.y ?? 0));
    const ticks = typeof yTicks === 'function' ? yTicks(top) : yTicks;
    const X = (x) => pad.l + ((x - xMin) / (xMax - xMin || 1)) * (width - pad.l - pad.r);
    const Y = (y) => pad.t + (1 - (y - yMin) / (top - yMin || 1)) * (height - pad.t - pad.b);

    const svg = svgEl('svg', { viewBox: `0 0 ${width} ${height}`, width, height, role: 'img', 'aria-label': label, class: 'viz-svg' });

    // Grid + y labels
    for (let i = 0; i <= ticks; i++) {
      const v = yMin + ((top - yMin) * i) / ticks;
      svg.append(svgEl('line', { x1: pad.l, x2: width - pad.r, y1: Y(v), y2: Y(v), class: 'viz-grid' }));
      const t = svgEl('text', { x: pad.l - 6, y: Y(v) + 4, class: 'viz-axis', 'text-anchor': 'end' });
      t.textContent = yFormat(v);
      svg.append(t);
    }
    // x labels
    for (let i = 0; i < xTicks; i++) {
      const v = xMin + ((xMax - xMin) * i) / (xTicks - 1);
      const t = svgEl('text', { x: X(v), y: height - 6, class: 'viz-axis', 'text-anchor': i === 0 ? 'start' : i === xTicks - 1 ? 'end' : 'middle' });
      t.textContent = xFormat(v);
      svg.append(t);
    }
    if (refLine) {
      svg.append(svgEl('line', { x1: pad.l, x2: width - pad.r, y1: Y(refLine.y), y2: Y(refLine.y), class: 'viz-ref' }));
      const t = svgEl('text', { x: pad.l + 6, y: Y(refLine.y) - 5, class: 'viz-axis viz-ref-label', 'text-anchor': 'start' });
      t.textContent = refLine.label;
      svg.append(t);
    }

    for (const s of series) {
      if (!s.points.length) continue;
      const d = s.points.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join(' ');
      if (area && series.length === 1) {
        svg.append(svgEl('path', { d: `${d} L${X(s.points.at(-1).x)},${Y(yMin)} L${X(s.points[0].x)},${Y(yMin)} Z`, fill: s.color, class: 'viz-area' }));
      }
      svg.append(svgEl('path', { d, stroke: s.color, class: 'viz-line' }));
    }

    // Crosshair + tooltip
    const hair = svgEl('line', { y1: pad.t, y2: height - pad.b, class: 'viz-hair', visibility: 'hidden' });
    const dots = series.map((s) => {
      const c = svgEl('circle', { r: 4, fill: s.color, class: 'viz-dot', visibility: 'hidden' });
      svg.append(c);
      return c;
    });
    svg.append(hair);
    const tip = document.createElement('div');
    tip.className = 'viz-tip';
    tip.hidden = true;

    const nearest = (pts, x) => pts.reduce((b, p) => (Math.abs(p.x - x) < Math.abs(b.x - x) ? p : b), pts[0]);
    const overlay = svgEl('rect', { x: pad.l, y: pad.t, width: width - pad.l - pad.r, height: height - pad.t - pad.b, fill: 'transparent' });
    overlay.addEventListener('pointermove', (e) => {
      const box = svg.getBoundingClientRect();
      const px = ((e.clientX - box.left) / box.width) * width;
      const x = xMin + ((px - pad.l) / (width - pad.l - pad.r)) * (xMax - xMin);
      const ref = nearest(all, x);
      hair.setAttribute('x1', X(ref.x));
      hair.setAttribute('x2', X(ref.x));
      hair.setAttribute('visibility', 'visible');
      tip.replaceChildren();
      const head = document.createElement('div');
      head.className = 'viz-tip-head';
      head.textContent = xFormat(ref.x);
      tip.append(head);
      series.forEach((s, i) => {
        if (!s.points.length) return;
        const p = nearest(s.points, ref.x);
        dots[i].setAttribute('cx', X(p.x));
        dots[i].setAttribute('cy', Y(p.y));
        dots[i].setAttribute('visibility', 'visible');
        const row = document.createElement('div');
        row.className = 'viz-tip-row';
        const key = document.createElement('span');
        key.className = 'viz-key';
        key.style.background = s.color;
        const val = document.createElement('strong');
        val.textContent = yFormat(p.y);
        const name = document.createElement('span');
        name.textContent = series.length > 1 ? s.name : '';
        row.append(key, val, name);
        tip.append(row);
      });
      tip.hidden = false;
      const left = ((X(ref.x) / width) * box.width);
      tip.style.left = `${Math.min(left + 12, box.width - 180)}px`;
    });
    overlay.addEventListener('pointerleave', () => {
      tip.hidden = true;
      hair.setAttribute('visibility', 'hidden');
      for (const d of dots) d.setAttribute('visibility', 'hidden');
    });
    svg.append(overlay);

    root.replaceChildren(svg, tip);
    if (series.length > 1) {
      const legend = document.createElement('div');
      legend.className = 'viz-legend';
      for (const s of series) {
        const item = document.createElement('span');
        const key = document.createElement('span');
        key.className = 'viz-key line';
        key.style.background = s.color;
        item.append(key, document.createTextNode(s.name));
        legend.append(item);
      }
      root.append(legend);
    }
  }
  return root;
}
