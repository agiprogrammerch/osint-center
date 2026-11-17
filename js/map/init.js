/* ══════════════════════════════════════════════════════════════
   MAP INIT — façade that wires engine + layers + perf + controls
   ══════════════════════════════════════════════════════════════ */
import { S } from '../state.js';
import { createMap, toggleSat, cycleBasemap, initOfflineBasemaps } from './engine.js';
import { buildLayers } from './layers.js';
import { startPerfGuard } from './perf.js';
import { installControls } from './controls.js';
import { initCoords } from './coords.js';
import { initGeoSearch } from './geoSearch.js';


export function initMap() {
  // Re-login after logout reuses everything that already exists.
  if (S.map) {
    S.map.invalidateSize();
    startPerfGuard(S.map);     // stopPerfGuard() runs on logout, so restart it
    return S.map;
  }

  const map = createMap();
  buildLayers(map);
  startPerfGuard(map);
  installControls(map);
  initCoords(map);
  initGeoSearch(map);
  return map;
}

export { toggleSat, cycleBasemap, initOfflineBasemaps };
