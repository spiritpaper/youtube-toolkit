// App shell: one sidebar for every extension page, grouped by what you're
// doing (Discover · Channels · Create · You). Pages call mountShell() first.

import { SUPPORT_URL, SUPPORT_LABEL } from './support.js';

const ICONS = {
  home: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  web: '<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="7" r="2.5"/><circle cx="12" cy="18" r="2.5"/><path d="M8 7l8 0M7 8l4 8M17 9l-4 7"/>',
  radar: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><path d="M12 12l6-6"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17.5" cy="9" r="2.5"/><path d="M16 14.5a5 5 0 0 1 6 5"/>',
  compare: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  gap: '<rect x="3" y="4" width="7" height="16" rx="1.5"/><rect x="14" y="4" width="7" height="7" rx="1.5"/><path d="M14 16h7" stroke-dasharray="2 2"/>',
  board: '<rect x="3" y="4" width="5" height="16" rx="1.5"/><rect x="10" y="4" width="5" height="11" rx="1.5"/><rect x="17" y="4" width="4" height="7" rx="1.5"/>',
  star: '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>',
  title: '<path d="M4 6h16M4 12h10M4 18h7"/>',
  script: '<path d="M7 3h8l4 4v14H7z"/><path d="M15 3v4h4M10 12h6M10 16h6"/>',
  me: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  heart: '<path d="M12 20s-7-4.4-9.3-9A5 5 0 0 1 12 6a5 5 0 0 1 9.3 5C19 15.6 12 20 12 20z"/>',
};

const icon = (name) =>
  `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

// id, label, icon, page path (relative to src/), section
export const NAV = [
  { id: 'home', label: 'Home', icon: 'home', href: 'home/home.html' },
  { section: 'Discover' },
  { id: 'explore', label: 'Keyword explorer', icon: 'search', href: 'explore/explore.html' },
  { id: 'web', label: 'Video web', icon: 'web', href: 'web/web.html' },
  { id: 'radar', label: 'Radar', icon: 'radar', href: 'studio/studio.html#radar', badge: 'radar' },
  { section: 'Channels' },
  { id: 'following', label: 'Following', icon: 'users', href: 'channels/channels.html' },
  { id: 'compare', label: 'Compare', icon: 'compare', href: 'studio/studio.html#compare' },
  { id: 'gaps', label: 'Content gaps', icon: 'gap', href: 'studio/studio.html#gaps' },
  { section: 'Create' },
  { id: 'board', label: 'Idea board', icon: 'board', href: 'board/board.html' },
  { id: 'ideas', label: 'Saved outliers', icon: 'star', href: 'ideas/ideas.html' },
  { id: 'titles', label: 'Title lab', icon: 'title', href: 'studio/studio.html#titles' },
  { id: 'script', label: 'Script lab', icon: 'script', href: 'script/script.html' },
  { section: 'You' },
  { id: 'mine', label: 'My channel', icon: 'me', href: 'studio/studio.html#mine' },
  { id: 'settings', label: 'Settings', icon: 'gear', href: 'options/options.html' },
];

const root = () => chrome.runtime.getURL('src/');

function link(item, active) {
  const a = document.createElement('a');
  a.href = root() + item.href;
  a.className = `nav-item${item.id === active ? ' on' : ''}`;
  a.dataset.id = item.id;
  if (item.id === active) a.setAttribute('aria-current', 'page');
  a.innerHTML = icon(item.icon);
  const label = document.createElement('span');
  label.textContent = item.label;
  a.append(label);
  if (item.badge) {
    const b = document.createElement('span');
    b.className = 'nav-badge';
    b.dataset.badge = item.badge;
    a.append(b);
  }
  return a;
}

async function refreshBadges(nav) {
  const { radar = [], quota } = await chrome.storage.local.get(['radar', 'quota']);
  const unread = radar.filter((r) => !r.read).length;
  for (const b of nav.querySelectorAll('[data-badge=radar]')) b.textContent = unread ? String(unread) : '';
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  const used = quota?.day === today ? quota.used : 0;
  const meter = nav.querySelector('.nav-quota');
  if (meter) {
    meter.querySelector('.nav-quota-text').textContent = `${used.toLocaleString()} / 10,000 API units today`;
    meter.querySelector('.nav-quota-bar > div').style.width = `${Math.min(100, used / 100)}%`;
  }
}

/**
 * Adds the sidebar to the page and marks `active` (a NAV id). On pages with
 * hash sub-sections (the studio), `active` follows the hash.
 */
export function mountShell(active) {
  document.body.classList.add('shell');
  const nav = document.createElement('nav');
  nav.className = 'app-nav';
  nav.setAttribute('aria-label', 'YT Toolkit');

  const brand = document.createElement('a');
  brand.className = 'nav-brand';
  brand.href = root() + 'home/home.html';
  const img = document.createElement('img');
  img.src = chrome.runtime.getURL('icons/icon32.png');
  img.alt = '';
  brand.append(img, document.createTextNode('YT Toolkit'));
  nav.append(brand);

  for (const item of NAV) {
    if (item.section) {
      const h = document.createElement('div');
      h.className = 'nav-section';
      h.textContent = item.section;
      nav.append(h);
    } else nav.append(link(item, active));
  }

  const foot = document.createElement('div');
  foot.className = 'nav-foot';
  foot.innerHTML = '<div class="nav-quota"><div class="nav-quota-text"></div><div class="nav-quota-bar"><div></div></div></div>';
  if (SUPPORT_URL) {
    const s = document.createElement('a');
    s.className = 'nav-item nav-support';
    s.href = SUPPORT_URL;
    s.target = '_blank';
    s.rel = 'noopener';
    s.innerHTML = icon('heart');
    s.append(document.createTextNode(SUPPORT_LABEL));
    foot.append(s);
  }
  nav.append(foot);

  const toggle = document.createElement('button');
  toggle.className = 'nav-toggle';
  toggle.setAttribute('aria-label', 'Menu');
  toggle.innerHTML = icon('menu');
  toggle.addEventListener('click', () => document.body.classList.toggle('nav-open'));
  const scrim = document.createElement('div');
  scrim.className = 'nav-scrim';
  scrim.addEventListener('click', () => document.body.classList.remove('nav-open'));

  document.body.prepend(nav, toggle, scrim);
  refreshBadges(nav);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.radar || changes.quota)) refreshBadges(nav);
  });
  return {
    setActive(id) {
      for (const a of nav.querySelectorAll('.nav-item[data-id]')) {
        a.classList.toggle('on', a.dataset.id === id);
        if (a.dataset.id === id) a.setAttribute('aria-current', 'page');
        else a.removeAttribute('aria-current');
      }
    },
  };
}
