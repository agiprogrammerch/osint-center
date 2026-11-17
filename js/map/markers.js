/* ══════════════════════════════════════════════════════════════
   MARKER REGISTRY — lets right-panel rows focus their map marker
   ══════════════════════════════════════════════════════════════ */
import { S } from '../state.js';

/** Map of layer keys -> Leaflet layer groups (cluster groups included). */
function layerFor(feedKey) {
  return { flights: S.CG.flights, military: S.CG.military, ships: [S.CG.ships, S.LG.ships],
           cyber: S.CG.cyber, attacks: S.CG.cyber, satellites: S.CG.satellites, cctv: S.CG.cctv,
           quakes: S.LG.quakes, fires: S.LG.fires, conflicts: S.LG.conflicts,
           routes: S.LG.routes }[feedKey] || null;
}

/**
 * Focus a registered marker: zoom out enough to un-cluster, then open its popup.
 * Falls back to a plain flyTo if the marker was dropped from the map.
 */
export function focusMarker(feedKey, id) {
  const marker = S.markers[feedKey]?.get(id);
  const pos = marker ? (marker.getLatLng ? marker.getLatLng() : null) : null;
  if (!marker || !pos) return false;

  const groups = [layerFor(feedKey)].flat().filter(Boolean);
  const inCluster = groups.some(g => typeof g.zoomToShowLayer === 'function' && g.hasLayer(marker));

  if (inCluster) {
    groups.find(g => g.hasLayer(marker)).zoomToShowLayer(marker, () => marker.openPopup());
  } else {
    S.map.flyTo(pos, Math.max(S.map.getZoom(), 6), { duration: 0.6 });
    marker.openPopup();
  }
  return true;
}

