// A face for each avatar: deterministic from its id and name, drawn as SVG
// (no images, nothing fetched).

function hash(s) {
  let x = 2166136261;
  for (let i = 0; i < s.length; i++) x = Math.imul(x ^ s.charCodeAt(i), 16777619);
  return x >>> 0;
}
export function face(a) {
  const n = hash(`${a.id}${a.name}`);
  const hues = [12, 28, 45, 150, 175, 200, 220, 265, 300, 335];
  const bg = `hsl(${hues[n % hues.length]} 55% 72%)`;
  const skin = ['#f5d0b5', '#e8b48f', '#c98e66', '#a06a45', '#7a4b2e', '#5a3622'][(n >>> 4) % 6];
  const hair = ['#2b1d16', '#4a3020', '#8a5a2b', '#c49a5a', '#1d1d1d', '#9a9a9a', '#b5452c'][(n >>> 8) % 7];
  const style = (n >>> 12) % 3;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 64 64');
  svg.setAttribute('aria-hidden', 'true');
  const hairPath = [
    'M14 30c0-14 9-21 18-21s18 7 18 21c-3-6-8-9-18-9s-15 3-18 9z',
    'M12 34c-1-17 9-25 20-25s21 8 20 25c-2-9-6-13-11-14-3 3-9 4-18 3-5 2-9 5-11 11z',
    'M15 28c1-12 8-18 17-18s16 6 17 18c-5-4-11-6-17-6s-12 2-17 6z M13 30h4v14h-4z M47 30h4v14h-4z',
  ][style];
  svg.innerHTML = `<rect width="64" height="64" fill="${bg}"/><path d="M14 64c2-11 9-16 18-16s16 5 18 16z" fill="${hair}" opacity=".85"/><circle cx="32" cy="32" r="14" fill="${skin}"/><path d="${hairPath}" fill="${hair}"/><circle cx="27" cy="33" r="1.6" fill="#222"/><circle cx="37" cy="33" r="1.6" fill="#222"/><path d="M28 39q4 3 8 0" stroke="#222" stroke-width="1.4" fill="none" stroke-linecap="round"/>`;
  return svg;
}
