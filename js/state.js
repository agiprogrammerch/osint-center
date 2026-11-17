/* ══════════════════════════════════════════════════════════════
   STATE — single shared application state object
   ══════════════════════════════════════════════════════════════ */
export const S = {
  // layer groups (created in map/layers.js)
  CG: {},   // marker-cluster groups: flights, military, ships, cyber, satellites, cctv
  LG: {},   // plain layer groups:    conflicts, quakes, fires, ships, routes

  // layer visibility
  vis: {
    flights: true, military: true, ships: true, conflicts: true,
    quakes: true, fires: true, cyber: true, satellites: true, cctv: true,
  },

  // per-feed in-flight locks + staleness tokens
  lock: {}, fetchId: {},

  // counters / badges
  evN: 0, alerts: 0,
  activeTab: 'overview',
  tickerItems: [],

  // data
  flightData: [], militaryFlightData: [], flightSource: '--', liveRetryCount: 0,
  quakeData: [], fireData: [], fireSource: '--',
  vesselObjects: [], simVessels: [], shipSource: '--', aisBounds: null,
  cyberData: [], cyberSource: '--',
  attackData: [], portData: [], attackSource: '--',
  news: [],
  cctvFeeds: [], cctvTotal: 0,
  satCount: 0,

  // marker registry: feedKey -> (recordId -> Leaflet marker)
  markers: {},

  // flight simulation
  simActive: false, simulatedFlights: [], simInterval: null, lastSimUpdate: 0,

  // proxy health
  proxyOk: null,   // null = unknown, true/false after first probe

  // flight feed auth
  oauthActive: false,

  // map runtime state (see js/map/*)
  map: null, satLayer: null, satOn: false, basemap: 'osm-dark',
  coordMode: 'dd', gratOn: false, nightOn: false, crosshairOn: false,
  activeMapLayer: 'flights',
  perf: { running: false, raf: null, moving: false, fps: 0, frameMs: 0, boost: 1, applied: 1 },
};

/** Register (or replace) a marker under a feed key so panels can focus it. */
export function registerMarker(feedKey, id, marker) {
  if (!id) return;
  (S.markers[feedKey] ||= new Map()).set(id, marker);
}

/** Drop all registered markers for a feed (called before re-render). */
export function clearMarkers(feedKey) {
  S.markers[feedKey]?.clear();
}
