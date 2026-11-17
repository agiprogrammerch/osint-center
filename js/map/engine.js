/* ══════════════════════════════════════════════════════════════
   MAP ENGINE — Leaflet map, basemaps (online + offline), panes
   All basemaps are FREE and need NO API key:
     OSM          tile.openstreetmap.org   (light, full detail)
     OSM DARK     same tiles + an invert filter (keeps the CRT look)
     TOPO         tile.opentopomap.org     (terrain)
     SATELLITE    Esri World Imagery       (header button)
   Carto was dropped — it now serves an "API KEY REQUIRED" tile instead
   of a map, which painted its watermark over the whole viewport.
   ══════════════════════════════════════════════════════════════ */
import { S } from '../state.js';
import { MAP_MAX_ZOOM } from '../config.js';
import { discoverOfflineMaps, offlineLayerOf, applyOfflineBounds, offlineLabel, offlineDetail } from './offlineMap.js';

// OpenStreetMap tiles. The German mirror is the default because the official
// servers 403-block bulk/aggressive use ("Access blocked" placeholder tile).
const OSM_MIRROR = 'https://tile.openstreetmap.de/{z}/{x}/{y}.png';
const OSM_MAIN   = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

export const BASEMAPS = [
  { key: 'osm-dark', label: 'OSM DARK', url: OSM_MIRROR, maxZoom: 19, filter: 'dark' },
  { key: 'osm',      label: 'OSM',      url: OSM_MIRROR, maxZoom: 19, filter: 'light' },
  { key: 'topo',     label: 'TOPO',     url: 'https://a.tile.opentopomap.org/{z}/{x}/{y}.png', maxZoom: 17, filter: 'light' },
];

const ESRI_SAT = {
  url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  maxZoom: 23, opacity: 1,
};

let baseLayer = null;
let offlineEntry = null;      // currently active offline map, when any
let preSatBasemap = null;     // basemap that was active before satellite view
let preOfflineBasemap = null; // basemap that was active before the offline map

function createPanes(map) {
  [['gratPane', 203], ['nightPane', 205]].forEach(([name, z]) => {
    if (!map.getPane(name)) map.createPane(name).style.zIndex = String(z);
  });
}

export function createMap() {
  if (S.map) return S.map;

  S.map = L.map('map', {
    center: [20, 10], zoom: 3, minZoom: 2, maxZoom: MAP_MAX_ZOOM,
    zoomSnap: 1, wheelDebounceTime: 24,
    preferCanvas: true, zoomControl: false, attributionControl: false,
    worldCopyJump: true, fadeAnimation: true,
  });

  S.basemap = S.basemap || BASEMAPS[0].key;
  baseLayer = makeBaseLayer(BASEMAPS[0]).addTo(S.map);
  S.satLayer = L.tileLayer(ESRI_SAT.url, { maxZoom: ESRI_SAT.maxZoom, opacity: ESRI_SAT.opacity });
  createPanes(S.map);
  return S.map;
}

/** Build a basemap/offline tile layer and apply its colour filter. */
function makeBaseLayer(def, manifest) {
  const layer = def.url
    ? L.tileLayer(def.url, { maxZoom: def.maxZoom ?? 19, noWrap: false, keepBuffer: 2, updateWhenIdle: false })
    : offlineLayerOf(def);
  const filter = manifest ? manifest.filter : def.filter;
  layer.on('add', () => applyTileFilter(filter));
  applyTileFilter(filter);
  return layer;
}

/** Invert the tiles for a dark basemap (tiles only — markers stay readable). */
function applyTileFilter(mode) {
  const pane = S.map && S.map.getPane('tilePane');
  if (!pane) return;
  pane.style.filter = mode === 'dark'
    ? 'invert(1) hue-rotate(180deg) brightness(.86) contrast(1.05) saturate(.75)'
    : 'none';
}

/** Look for locally downloaded maps (called at boot, before controls). */
export async function initOfflineBasemaps() {
  const maps = await discoverOfflineMaps();
  S.offlineMaps = maps;
  return maps;
}

export function toggleSat() {
  const btn = document.getElementById('sat-btn');
  if (S.satOn) {
    S.map.removeLayer(S.satLayer); S.satOn = false;
    S.basemap = preSatBasemap || BASEMAPS[0].key;
    preSatBasemap = null;
    if (btn) { btn.classList.remove('on'); btn.textContent = '🛰 SAT VIEW'; }
    logEv('World Imagery satellite view deactivated');
  } else {
    preSatBasemap = S.basemap;
    S.satLayer.addTo(S.map); S.satOn = true;
    S.basemap = 'satellite';
    if (btn) { btn.classList.add('on'); btn.textContent = '🛰 SAT: ON'; }
    logEv('Esri World Imagery satellite view activated (z' + ESRI_SAT.maxZoom + ')');
  }
}

/** Cycle: OSM DARK -> OSM -> TOPO -> offline maps (if any) -> back. */
export function cycleBasemap() {
  if (S.satOn) toggleSat();            // leave satellite first, then cycle
  if (offlineEntry) { disableOffline(); return; }

  const offline = S.offlineMaps || [];
  const idx = BASEMAPS.findIndex(b => b.key === S.basemap);
  if (idx === BASEMAPS.length - 1 && offline.length) return enableOffline(offline[0]);

  const next = BASEMAPS[idx + 1] || BASEMAPS[0];
  S.basemap = next.key;
  S.map.removeLayer(baseLayer);
  baseLayer = makeBaseLayer(next).addTo(S.map);
  refreshBaseLabel();
  logEv('Basemap: ' + next.label);
}

function refreshBaseLabel() {
  const b = document.getElementById('vm-base');
  if (b) b.title = 'Basemap style (B): ' + basemapLabel();
}

function enableOffline(entry) {
  if (offlineEntry) return;
  if (!preOfflineBasemap) preOfflineBasemap = S.basemap;
  offlineEntry = entry;
  S.basemap = 'offline:' + (entry.manifest?.name || entry.label);
  S.map.removeLayer(baseLayer);
  baseLayer = makeBaseLayer(entry, entry.manifest).addTo(S.map);
  applyOfflineBounds(entry, true);

  const b = entry.manifest?.bbox;
  if (b) {
    const z = Math.min(entry.manifest.maxZoom ?? 19, Math.max(entry.manifest.minZoom + 2, 12));
    S.map.flyTo([(b[0] + b[2]) / 2, (b[1] + b[3]) / 2], z, { duration: 0.8 });
  }
  refreshBaseLabel();
  logEv('Offline map ' + offlineLabel(entry) + ' loaded — ' + offlineDetail(entry));
}

function disableOffline() {
  if (!offlineEntry) return;
  S.map.removeLayer(baseLayer);
  offlineEntry = null;
  const restore = preOfflineBasemap || 'osm-dark';
  preOfflineBasemap = null;
  const style = BASEMAPS.find(b => b.key === restore) || BASEMAPS[0];
  S.basemap = style.key;
  baseLayer = makeBaseLayer(style).addTo(S.map);
  applyOfflineBounds(null, false);
  refreshBaseLabel();
  logEv('Offline map disabled — back to ' + style.label);
}

export function basemapLabel() {
  if (S.satOn) return 'ESRI SAT';
  if (offlineEntry) return offlineLabel(offlineEntry);
  const b = BASEMAPS.find(x => x.key === S.basemap) || BASEMAPS[0];
  return b.label;
}

/** Called when a saved session restores a basemap key. */
export function restoreBasemap(key) {
  if (S.satOn && key !== 'satellite') toggleSat();          // satellite is exclusive
  if (key === 'satellite') { if (!S.satOn) toggleSat(); return; }
  if (key && key.startsWith('offline:')) {
    const name = key.slice(8).toLowerCase();
    const entry = (S.offlineMaps || []).find(e => (e.manifest?.name || e.label || '').toLowerCase().includes(name));
    if (entry) {
      if (offlineEntry) { offlineEntry = null; S.map.removeLayer(baseLayer); }
      enableOffline(entry);
      return;
    }
  }
  const found = BASEMAPS.find(b => b.key === key);
  if (found) {
    if (offlineEntry) { offlineEntry = null; applyOfflineBounds(null, false); }
    S.map.removeLayer(baseLayer);
    S.basemap = found.key;
    baseLayer = makeBaseLayer(found).addTo(S.map);
  } else if (key === 'dark') {                                // legacy key from older sessions
    S.map.removeLayer(baseLayer);
    S.basemap = BASEMAPS[0].key;
    baseLayer = makeBaseLayer(BASEMAPS[0]).addTo(S.map);
  }
  // Silently ignore unknown keys (like 'osm-official' from old sessions)
}

export const isOfflineActive = () => !!offlineEntry;
export const currentOffline = () => offlineEntry;

function logEv(msg) {
  import('../ui/eventLog.js').then(m => m.logEv('SYS', msg));
}
