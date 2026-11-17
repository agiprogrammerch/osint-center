/* ══════════════════════════════════════════════════════════════
   OFFLINE MAP — locally downloaded tile pyramid (e.g. Istanbul)
   The downloader (download_istanbul_map.py) writes maps/<name>/{z}/{x}/{y}.png
   plus a manifest.json with the bbox and zoom range. This module turns that
   into a Leaflet basemap, clamps the view to the covered area while it is
   active, and falls back to Carto dark when the tiles are missing.
   ══════════════════════════════════════════════════════════════ */
import { S } from '../state.js';
import { MAP_MAX_ZOOM } from '../config.js';
import { h } from '../utils.js';

const MANIFESTS = [
  { path: 'maps/istanbul/manifest.json', url: 'maps/istanbul/{z}/{x}/{y}.png', label: 'ISTANBUL OFFLINE' },
];

export const MAP_FOLDER = 'maps';

/** Fetch every manifest and return the ones that actually have tiles on disk. */
export async function discoverOfflineMaps() {
  const found = [];
  for (const m of MANIFESTS) {
    try {
      const r = await fetch(m.path + '?_t=' + Date.now());
      if (!r.ok) continue;
      const man = await r.json();
      const hasTiles = await probeTile(m.url, man.minZoom, man.bbox);
      if (hasTiles) found.push({ ...m, manifest: man });
    } catch (_) { /* not downloaded yet */ }
  }
  S.offlineMaps = found;
  return found;
}

/** Ask for the centre tile of the lowest zoom — if it exists the pyramid does. */
async function probeTile(url, zoom, bbox) {
  if (!bbox) return true;
  try {
    const lat = (bbox[0] + bbox[2]) / 2;
    const lng = (bbox[1] + bbox[3]) / 2;
    const n = 2 ** zoom;
    const x = Math.floor((lng + 180) / 360 * n);
    const r = Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI / 180) / 2));
    const y = Math.floor((1 - r / Math.PI) / 2 * n);
    const path = url.replace('{z}', zoom).replace('{x}', x).replace('{y}', y);
    const res = await fetch(path, { method: 'HEAD' });
    return res.ok;
  } catch (_) { return false; }
}

export function offlineLayerOf(entry) {
  const man = entry.manifest || {};
  const bbox = man.bbox;
  const bounds = bbox ? L.latLngBounds([bbox[0], bbox[1]], [bbox[2], bbox[3]]).pad(0.04) : null;
  const layer = L.tileLayer(entry.url, {
    minZoom: man.minZoom ?? 3,
    maxZoom: man.maxZoom ?? 16,
    maxNativeZoom: man.maxZoom ?? 16,
    bounds: bounds ?? undefined,
    attribution: false,
    updateWhenIdle: false,
    keepBuffer: 3,
    errorTileUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  });
  // light tile sources (OSM/Topo) get inverted for the dark CRT look
  if (man.filter === 'dark') layer.on('add', () => applyTileFilterTo('dark'));
  return layer;
}

function applyTileFilterTo(mode) {
  const pane = S.map && S.map.getPane('tilePane');
  if (!pane) return;
  pane.style.filter = mode === 'dark'
    ? 'invert(1) hue-rotate(180deg) brightness(.86) contrast(1.05) saturate(.75)'
    : 'none';
}

/** Clamp/unclamp the map while an offline basemap is active. */
export function applyOfflineBounds(entry, on) {
  const man = entry?.manifest || {};
  const bbox = man.bbox;
  if (on && bbox) {
    S.map.setMaxBounds(L.latLngBounds([bbox[0], bbox[1]], [bbox[2], bbox[3]]).pad(0.04));
    // Never drop below the map's own minZoom (2): the marker-cluster groups
    // pre-generate their distance grids for minZoom..maxZoom, and a lower
    // level later on makes _addLayer() index a grid that does not exist.
    S.map.setMinZoom(Math.max(2, man.minZoom ?? 3));
    S.map.setMaxZoom(Math.min(man.maxZoom ?? 19, MAP_MAX_ZOOM));
  } else {
    S.map.setMaxBounds(null);
    S.map.setMinZoom(2);
    S.map.setMaxZoom(MAP_MAX_ZOOM);      // back to the map's real ceiling
  }
}

/** Human summary for the status line / event log. */
export function offlineLabel(entry) {
  if (!entry) return 'OFFLINE';
  return (entry.label || entry.manifest?.name || 'OFFLINE MAP').toUpperCase();
}

export function offlineDetail(entry) {
  const m = entry?.manifest || {};
  if (!m.bbox) return '';
  const [s, w, n, e] = m.bbox;
  return `offline: z${m.minZoom}–z${m.maxZoom} · ${s.toFixed(2)}–${n.toFixed(2)}N ${w.toFixed(2)}–${e.toFixed(2)}E`
    + (m.tiles ? ` · ${Number(m.tiles).toLocaleString('en-US')} tiles` : '');
}
