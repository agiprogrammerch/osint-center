/* ══════════════════════════════════════════════════════════════
   LEGEND — layer visibility toggles + zoom-to-layer
   Thin wrapper over the map layer manager.
   ══════════════════════════════════════════════════════════════ */
import { S } from '../state.js';
import { LAYERS, getLayers, toggleLayer, zoomToLayer } from '../map/layers.js';
import { saveState } from './session.js';

export { getLayers, LAYERS };

export function toggleLyr(el) {
  const k = el.dataset.l;
  toggleLayer(k, !S.vis[k]);
  el.classList.toggle('off', !S.vis[k]);
  updateLayerBadge();
  saveState();
}

/** Double-click a legend chip to fly to that layer's data. */
export function zoomLegendLayer(el) {
  zoomToLayer(el.dataset.l);
}

export function updateLayerBadge() {
  const n = Object.values(S.vis).filter(Boolean).length;
  const el = document.getElementById('lyr-badge');
  if (el) el.textContent = n + ' LAYERS';
}
