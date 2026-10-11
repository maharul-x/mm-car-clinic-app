// Theme preference for this device: 'dark' (default), 'light' or 'system'.
// index.html applies it before the page paints so there's no flash; this module changes it.

const KEY = 'mm.theme';
const media = window.matchMedia('(prefers-color-scheme: light)');

export const THEMES = [['dark', 'Dark'], ['light', 'Light'], ['system', 'Match device']];

export function getTheme() {
  try {
    const t = localStorage.getItem(KEY);
    return THEMES.some(([k]) => k === t) ? t : 'dark';
  } catch {
    return 'dark';
  }
}

function resolved(pref) {
  return pref === 'system' ? (media.matches ? 'light' : 'dark') : pref;
}

export function applyTheme(pref = getTheme()) {
  const mode = resolved(pref);
  document.documentElement.dataset.theme = mode;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', mode === 'light' ? '#fafafa' : '#09090b');
  const btn = document.getElementById('theme-toggle');
  if (btn) {
    btn.dataset.mode = mode;
    btn.setAttribute('aria-label', `Theme: ${THEMES.find(([k]) => k === pref)[1]}. Click to change.`);
    btn.querySelector('span').textContent = THEMES.find(([k]) => k === pref)[1];
  }
}

export function setTheme(pref) {
  try { localStorage.setItem(KEY, pref); } catch { /* still applies for this visit */ }
  applyTheme(pref);
}

/** Dark → Light → Match device → Dark */
export function cycleTheme() {
  const order = THEMES.map(([k]) => k);
  setTheme(order[(order.indexOf(getTheme()) + 1) % order.length]);
}

media.addEventListener('change', () => { if (getTheme() === 'system') applyTheme(); });
