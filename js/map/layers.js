/* ══════════════════════════════════════════════════════════════
   LAYER MANAGER — single registry for every map layer
   Creates the S.CG / S.LG groups the feeds already use, and adds
   visibility, zoom-to-data and clustering policy on top.
   ══════════════════════════════════════════════════════════════ */
import { S } from '../state.js';
import { logEv } from '../ui/eventLog.js';

/** cluster: uses markercluster · plain: a layer group · aux: not user-toggleable */
export const LAYERS = {
  flights:    { label: 'FLIGHTS',    kind: 'cluster', base: 35, groups: ['flights'],              cap: 500 },
  military:   { label: 'MILITARY',   kind: 'cluster', base: 50, groups: ['military'],             cap: 500 },
  ships:      { label: 'SHIPS',      kind: 'cluster', base: 55, groups: ['ships', 'shipZones'],   cap: 60 },
  conflicts:  { label: 'CONFLICTS',  kind: 'plain',                    groups: ['conflicts'],     cap: 200 },
  quakes:     { label: 'QUAKES',     kind: 'plain',                    groups: ['quakes'],        cap: 300 },
  fires:      { label: 'FIRES',      kind: 'plain',                    groups: ['fires'],         cap: 120 },
  cyber:      { label: 'CYBER',      kind: 'cluster', base: 45, groups: ['cyber'],                cap: 150 },
  satellites: { label: 'SATELLITES', kind: 'cluster', base: 80, groups: ['satellites'],          cap: 25 },
  cctv:       { label: 'CCTV',       kind: 'cluster', base: 40, groups: ['cctv'],                cap: 20 },
  routes:     { label: 'ROUTES',     kind: 'aux',                      groups: ['routes'],       cap: 0 },
};

/** State key for each layer group (keeps S.CG / S.LG names used by feeds). */
const GROUP_OWNER = {
  flights: 'CG', military: 'CG', ships: 'CG', cyber: 'CG', satellites: 'CG', cctv: 'CG',
  conflicts: 'LG', quakes: 'LG', fires: 'LG', shipZones: 'LG', routes: 'LG',
};

const CLUSTER_OPTS = {
  chunkedLoading: true,            // add markers in chunks — much smoother
  spiderfyOnMaxZoom: true,
  showCoverageOnHover: false,
  zoomToBoundsOnClick: true,
  removeOutsideVisibleBounds: false,
};

let built = false;

/** Builds every layer group exactly where the feeds expect them. */
export function buildLayers(map) {
  if (built) { S.map.invalidateSize(); return; }
  built = true;

  Object.entries(LAYERS).forEach(([key, def]) => {
    def.groups.forEach(g => {
      if (def.kind === 'cluster' && g !== 'shipZones' && g !== 'routes') {
        (S.CG[g] = S.CG[g] || L.markerClusterGroup({ ...CLUSTER_OPTS, maxClusterRadius: def.base }))
          .addTo(map);
      } else {
        (S.LG[g] = S.LG[g] || L.layerGroup()).addTo(map);
      }
    });
  });

  applyClusterPolicy();
}

/** Leaflet layers for a layer key. */
export function getLayers(k) {
  const def = LAYERS[k];
  if (!def) return [];
  const out = [];
  def.groups.forEach(g => {
    const layer = GROUP_OWNER[g] === 'CG' ? S.CG[g] : S.LG[g];
    if (layer) out.push(layer);
  });
  return out;
}

/** Visibility toggle (legend + session restore). */
export function toggleLayer(key, on) {
  const def = LAYERS[key];
  if (!def) return;
  S.vis[key] = on;
  getLayers(key).forEach(lyr => on ? lyr.addTo(S.map) : S.map.removeLayer(lyr));

  // route lines follow the flight layers
  if (key === 'flights' || key === 'military') {
    if (!S.vis.flights && !S.vis.military) S.map.removeLayer(S.LG.routes);
    else S.map.addLayer(S.LG.routes);
  }
}

/** Cluster radius by zoom + measured frame time (see perf.js). */
export function applyClusterPolicy(zoom = S.map?.getZoom() ?? 3) {
  const boost = S.perf?.boost || 1;
  Object.entries(LAYERS).forEach(([key, def]) => {
    if (def.kind !== 'cluster') return;
    // zoomed out -> cluster hard; zoomed in -> let markers breathe
    const zoomFactor = zoom <= 4 ? 1.8 : zoom <= 6 ? 1.3 : zoom <= 8 ? 1.0 : 0.55;
    const radius = Math.round(def.base * zoomFactor * boost);
    def.groups.forEach(g => {
      const grp = S.CG[g];
      if (!grp || typeof grp.refreshClusters !== 'function') return;
      grp.options.maxClusterRadius = radius;
      try { grp.refreshClusters(); } catch (_) { /* cluster not rendered yet */ }
    });
  });
}

/** Fly to the extent of a layer's markers (falls back to stored records). */
export function zoomToLayer(key) {
  const def = LAYERS[key];
  if (!def) return false;

  const pts = [];
  (S.markers[key] || new Map()).forEach(m => {
    if (m.getLatLng) pts.push(m.getLatLng());
  });
  if (!pts.length) {
    // fall back to the feed's own records
    const recs = { quakes: S.quakeData, fires: S.fireData, cyber: S.cyberData,
                   cctv: S.cctvFeeds, ships: S.vesselObjects }[key];
    (recs || []).forEach(r => { if (r.lat != null && r.lon != null) pts.push(L.latLng(r.lat, r.lon)); });
  }
  if (!pts.length) {
    logEv('SYS', 'No data to zoom to for ' + def.label);
    return false;
  }
  const b = L.latLngBounds(pts);
  S.map.flyToBounds(b, { padding: [40, 40], maxZoom: 9, duration: 0.7 });
  logEv('SYS', 'Zoomed to ' + def.label + ' (' + pts.length + ' objects)');
  return true;
}


export function resetView() {
  S.map.flyTo([20, 10], 3, { duration: 0.6 });
}
