/* ══════════════════════════════════════════════════════════════
   SESSION — persist map view, layer visibility, overlays in localStorage
   ══════════════════════════════════════════════════════════════ */
import { S } from '../state.js';
import { getLayers, LAYERS } from './legend.js';
import { toggleSat, cycleBasemap, restoreBasemap } from '../map/engine.js';
import { toggleGraticule, toggleNight } from '../map/overlays.js';
import { toggleCoordMode } from '../map/coords.js';

const KEY = 'voidmatrix_v3';

export function saveState() {
  if (!S.map) return;
  const c = S.map.getCenter();
  try {
    localStorage.setItem(KEY, JSON.stringify({
      lat: c.lat, lng: c.lng, zoom: S.map.getZoom(),
      vis: S.vis, satOn: S.satOn, basemap: S.basemap,
      gratOn: S.gratOn, nightOn: S.nightOn, coordMode: S.coordMode,
      tab: S.activeTab,
    }));
  } catch (_) { /* storage disabled — non-fatal */ }
}

export function restoreState() {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(KEY) || 'null');
  } catch (_) { /* corrupt state — ignore */ }
  if (!saved || saved.lat === undefined) return;

  try {
    S.map.setView([saved.lat, saved.lng], saved.zoom, { animate: false });
    S.vis = { ...S.vis, ...(saved.vis || {}) };
    Object.keys(LAYERS).forEach(k => {
      if (k === 'routes') return;
      const on = S.vis[k] !== false;
      const el = document.querySelector('.leg[data-l="' + k + '"]');
      if (el) el.classList.toggle('off', !on);
      getLayers(k).forEach(lyr => on ? lyr.addTo(S.map) : S.map.removeLayer(lyr));
    });

    try {
      if (saved.basemap) restoreBasemap(saved.basemap);
      else if (saved.satOn) toggleSat();
      if (!!saved.gratOn !== !!S.gratOn) toggleGraticule();
      if (!!saved.nightOn !== !!S.nightOn) toggleNight();
      if (saved.coordMode && saved.coordMode !== S.coordMode) toggleCoordMode();
    } catch (e) {
      // never let a partial restore kill the rest of the saved session
      console.warn('session restore (view/overlays) failed:', e && e.message);
    }
    if (saved.tab) S.activeTab = saved.tab;
  } catch (e) {
    console.warn('session restore failed:', e && e.message);
  }
}
