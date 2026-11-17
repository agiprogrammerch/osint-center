/* ══════════════════════════════════════════════════════════════
   CONFIG — endpoints, refresh cadence, tuning knobs
   All sources are FREE and need NO API key.
   ══════════════════════════════════════════════════════════════ */

/** Local proxy served by serve.py (primary transport for every cross-origin call). */
export const PROXY_PATH = '/proxy?url=';

/**
 * Fallback public proxies. Every well-known free proxy was tested and is
 * currently dead/unstable (allorigins 520, codetabs 522, corsproxy 401,
 * thingproxy/cors.sh unreachable) — so the local proxy is the only one used.
 * Add entries here only if you find a reliable one.
 */
export const FALLBACK_PROXIES = [];

export const ENDPOINTS = {
  // ADS-B via OpenSky Network (anonymous access, no key; ~400 req/day cap)
  flights:    'https://opensky-network.org/api/states/all',
  // USGS real-time earthquakes (GeoJSON, no key, CORS-enabled)
  quakes:     'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson',
  // NASA EONET open natural-event feed (no key)
  eonet:      (cat, limit = 30) =>
                `https://eonet.gsfc.nasa.gov/api/v3/events?category=${cat}&status=open&limit=${limit}`,
  eonetAll:   'https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=250',
  // abuse.ch Feodo Tracker botnet C2 blocklist (no key)
  cyber:      'https://feodotracker.abuse.ch/downloads/ipblocklist.json',
  // SANS Internet Storm Center / DShield — real attack telemetry, no key.
  //   sources/attacks -> origin IPs with event counts and first/last seen
  //   topports        -> which services are under attack right now (+target counts)
  iscSources:  (n, date) => `https://isc.sans.edu/api/sources/attacks/${n}/${date}?json`,
  iscTopPorts: (n, date) => `https://isc.sans.edu/api/topports/records/${n}/${date}?json`,
  // free batch geolocation (up to 100 IPs per request) to place origins on the map
  geoBatch:    'http://ip-api.com/batch',
  // CelesTrak TLE elements (no key). CelesTrak 500s intermittently, so the
  // satellite feed falls back to the "weather" group and then to local TLEs.
  tle:        'https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=tle',
  tleAlt:     'https://celestrak.org/NORAD/elements/gp.php?GROUP=weather&FORMAT=tle',
  // TfL JamCams — London live traffic cameras, free public API, no key
  cctv:       'https://api.tfl.gov.uk/Place/Type/JamCam',
  // Live-Environment-Streams — free, key-less GeoJSON index of ~6,800 ACTIVE
  // public HLS (.m3u8) camera streams worldwide (US DOT networks, Indonesian
  // ATCS, Norway, Spain, Taiwan…). Served through the local /proxy, which
  // rewrites playlist URIs so hls.js can play every one of them.
  cctvHls:    'https://raw.githubusercontent.com/willytop8/Live-Environment-Streams/main/streams.geojson',
  // Digitraffic (Finnish Transport Infrastructure Agency) — free, key-less,
  // CC-BY open AIS: live vessel positions + static vessel metadata
  ais:        'https://meri.digitraffic.fi/api/ais/v1/locations',
  aisMeta:    'https://meri.digitraffic.fi/api/ais/v1/vessels',
};

/** Free, key-less RSS/Atom feeds (parsed locally via the proxy). */
export const RSS_FEEDS = [
  { name: 'BBC WORLD',    url: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
  { name: 'AL JAZEERA',   url: 'https://www.aljazeera.com/xml/rss/all.xml' },
  { name: 'THE GUARDIAN', url: 'https://www.theguardian.com/world/rss' },
  { name: 'DW',           url: 'https://rss.dw.com/xml/rss-en-world' },
  { name: 'NPR',          url: 'https://feeds.npr.org/1004/rss.xml' },
];

/**
 * OPTIONAL — OpenSky OAuth (free account, no payment).
 * Register at https://opensky-network.org/ and paste the credentials here to
 * unlock ~4,000 requests/day (instead of ~400) and a 2-minute refresh.
 * Leave both empty and the app runs anonymously, exactly as before.
 */
export const OPENSKY_OAUTH = {
  clientId: '',
  clientSecret: '',
};

export const OPENSKY_TOKEN_URL =
  'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';

export function hasOpenSkyKeys() {
  return !!(OPENSKY_OAUTH.clientId && OPENSKY_OAUTH.clientSecret);
}

/** Refresh cadence (ms). Flights stay slow out of respect for OpenSky's free tier. */
export const FLIGHT_REFRESH = {
  anonymous: 300000,   // 5 min — OpenSky anonymous cap ≈ 400 req/day
  oauth:     120000,   // 2 min — with a FREE OpenSky account (~4,000 req/day)
};

export const REFRESH_MS = {
  flights:    hasOpenSkyKeys() ? FLIGHT_REFRESH.oauth : FLIGHT_REFRESH.anonymous,
  quakes:     300000,   // 5 min
  fires:      600000,   // 10 min
  cyber:      900000,   // 15 min
  news:       150000,   // 2.5 min
  satellites: 300000,   // 5 min
  ships:      300000,   // 5 min (simulated positions)
  cctv:       1800000,  // 30 min (the HLS stream index is ≈6MB)
};

export const LIMITS = {
  flightMarkers: 500,      // markers drawn on the map (of ~12k state vectors)
  cyberMarkers:  150,
  attackMarkers: 60,
  cctvList:      60,       // curated cameras shown in the panel
  cctvMarkers:   800,      // live-camera markers drawn worldwide
  cctvProbe:     60,       // cameras play-tested in the background
  cctvMinZoom:   5,
  shipMarkers:   900,      // AIS positions kept on the map
};

export const DIRECT_TIMEOUT = 12000;  // ms — direct fetch attempt

/**
 * Highest zoom the Leaflet map itself allows. Tile layers still declare their
 * own maxZoom (OSM 19, Topo 17, satellite 23): past a layer's own limit its
 * last zoom is upscaled, while satellite imagery keeps real detail to z23.
 * This lives here (not in map/engine.js) so map modules can share it without
 * an import cycle.
 */
export const MAP_MAX_ZOOM = 23;
export const PROXY_TIMEOUT  = 30000;  // ms — via local proxy

/**
 * Hosts verified to send Access-Control-Allow-Origin. Only these are tried
 * directly (fast + no console noise); everything else goes through the proxy.
 */
export const CORS_HOSTS = new Set([
  'earthquake.usgs.gov',
  'eonet.gsfc.nasa.gov',
]);

/** Curated London landmarks to seed the CCTV panel (matched against TfL names). */
export const CCTV_PREFERRED = [
  'Piccadilly Circus', 'Trafalgar Square', 'Oxford Circus', 'Bank', 'Kensington',
  'Heathrow', 'Tower', 'Westminster', 'Baker', 'Camden', 'Shoreditch', 'Canary',
  'Battersea', 'Hammersmith', 'Stratford', 'Vauxhall', 'Elephant', 'Aldgate',
];
