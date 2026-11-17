import { S } from '../state.js';
/* ══════════════════════════════════════════════════════════════
   PANELS LAYOUT — collapse the side panels for a full-width map
   (useful on 1366x786 screens where 586px of chrome is a lot).
   ══════════════════════════════════════════════════════════════ */
const KEY = 'voidmatrix_panels';

export function initPanels() {
  apply(false);
  return {
    toggle,
    apply,
  };
}

/** Toggle the side panels; keeps the map sized afterwards. */
export function toggle() {
  const app = document.getElementById('app');
  const off = !app.classList.contains('panels-off');
  apply(off);
  return off;
}

export function apply(off) {
  const app = document.getElementById('app');
  if (!app) return;
  app.classList.toggle('panels-off', off);
  try { localStorage.setItem(KEY, JSON.stringify({ collapsed: off })); } catch (_) {}
  const btn = document.getElementById('panels-btn');
  if (btn) {
    btn.classList.toggle('on', off);
    btn.textContent = off ? '◨ PANELS' : '◧ PANELS';
    btn.title = off ? 'Show side panels (P)' : 'Hide side panels (P)';
  }
  // Leaflet must be told the container changed size.
  requestAnimationFrame(() => setTimeout(() => S.map?.invalidateSize(), 60));
}

/** Restore the saved preference (called from boot). */
export function restorePanels() {
  let off = false;
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null');
    off = !!(s && s.collapsed);
  } catch (_) { /* ignore */ }
  apply(off);
  return off;
}
