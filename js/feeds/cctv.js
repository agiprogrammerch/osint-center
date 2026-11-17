/* ══════════════════════════════════════════════════════════════
   FEED: CCTV — REAL LIVE VIDEO STREAMS
   Primary : Live-Environment-Streams GeoJSON index of ~6,800 ACTIVE
             public HLS (.m3u8) camera streams worldwide — free, no key.
             Everything is fetched through the local /proxy, which
             rewrites playlist URIs so hls.js can play every camera.
   Fallback: TfL JamCams (London) — live still snapshots (2s refresh)
             used only when the HLS index cannot be reached.
   ══════════════════════════════════════════════════════════════ */
import { S, registerMarker, clearMarkers } from '../state.js';
import { ENDPOINTS, REFRESH_MS, LIMITS, CCTV_PREFERRED } from '../config.js';
import { getJSON, getText, mkIcon, mkPop } from '../utils.js';
import { logEv } from '../ui/eventLog.js';
import { refreshPanel } from '../ui/panels/registry.js';

const prop = (place, key) => {
  const p = place.additionalProperties?.find(x => x.key === key);
  return p ? p.value : null;
};

/* ── tiny stable hash so a camera keeps its id across reloads ── */
function stableId(url) {
  let h = 0x811c9dc5;
  for (let i = 0; i < url.length; i++) {
    h ^= url.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return 'hls' + h.toString(36);
}

function shortName(name) {
  let s = String(name || '').trim();
  if (s.length > 52) s = s.slice(0, 50) + '…';
  return s || 'UNNAMED CAMERA';
}

/* ── HLS index -> camera records ── */
function hlsToCams(features) {
  const seen = new Set();
  const cams = [];
  for (const f of features || []) {
    const p = f.properties || {};
    const g = f.geometry;
    if (!g || !Array.isArray(g.coordinates)) continue;
    if (p.status !== 'active' || p.url_type !== 'hls') continue;
    const url = String(p.url || '').trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const lon = g.coordinates[0], lat = g.coordinates[1];
    if (!(lat >= -90 && lat <= 90) || !(lon >= -180 && lon <= 180)) continue;
    cams.push({
      id: stableId(url),
      name: shortName(p.name),
      lat, lon,
      stream: url,
      live: true,                       // true = real HLS video, false = stills
      image: null,
      video: null,
      country: p.country_code || '--',
      family: p.source_family || 'unknown',
      quality: p.coordinates_quality || 'city',
      verified: p.last_verified || null,
      env: p.environment || 'traffic',
      attribution: p.attribution || p.source_family || 'public CCTV',
      source: 'LIVE HLS · ' + (p.attribution || p.source_family || 'public CCTV'),
      checked: null,                    // null = unknown, true = playable, false = dead
    });
  }
  return cams;
}

/** Spread the pick across buckets (country / network) so the panel is not
 *  1,600 Caltrans cams in a row. */
function diversePick(cams, n, keyOf) {
  const buckets = new Map();
  for (const c of cams) {
    const k = keyOf(c);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(c);
  }
  const ranked = [...buckets.values()].map(bucket => {
    bucket.sort((a, b) =>
      (b.quality === 'exact') - (a.quality === 'exact') ||
      String(b.verified || '').localeCompare(String(a.verified || '')) ||
      a.name.localeCompare(b.name));
    return bucket;
  });
  // widest buckets first, and the start rotates each round, so the result
  // interleaves networks (Caltrans / MnDOT / Bandung / Bangkok…) instead of
  // listing one network exhaustively before the next.
  ranked.sort((a, b) => b.length - a.length);
  const out = [];
  let round = 0;
  while (out.length < n) {
    const offset = round % ranked.length;
    let added = false;
    for (let i = 0; i < ranked.length; i++) {
      const bucket = ranked[(i + offset) % ranked.length];
      const c = bucket[round];
      if (c) { out.push(c); added = true; if (out.length >= n) break; }
    }
    if (!added) break;
    round++;
  }
  return out;
}

const byCountry = c => c.country || '--';
const byNetwork = c => (c.country || '--') + '|' + (c.family || c.attribution || 'unknown');

/* ── TfL JamCams (London) fallback: live stills ── */
function pickTflCameras(places, n) {
  const scored = places.map(p => {
    const name = (p.commonName || '').toLowerCase();
    const idx = CCTV_PREFERRED.findIndex(k => name.includes(k.toLowerCase()));
    return { p, score: idx === -1 ? 999 : idx };
  });
  scored.sort((a, b) => a.score - b.score || (a.p.commonName || '').localeCompare(b.p.commonName || ''));
  return scored.slice(0, n).map(({ p }) => ({
    id: p.id,
    name: p.commonName || p.id,
    lat: p.lat, lon: p.lon,
    stream: null,
    live: false,
    image: prop(p, 'imageUrl'),
    video: null,
    country: 'GB',
    family: 'tfl',
    quality: 'exact',
    verified: null,
    env: 'traffic',
    attribution: 'TfL JamCams (London)',
    source: 'TfL JamCams · live snapshot',
    checked: null,
  }));
}

/* ── background play-test: only advertise cameras that actually play ── */
let probeToken = 0;
function probeCams(list) {
  if (!list.length) return;
  const token = ++probeToken;
  const CONC = 4;
  let i = 0;
  const run = async () => {
    while (i < list.length) {
      if (probeToken !== token) return;
      const cam = list[i++];
      if (!cam.live) continue;
      try {
        const txt = await getText(cam.stream, 9000);
        cam.checked = !!(txt && txt.includes('#EXTM3U'));
      } catch (_) {
        cam.checked = false;
      }
    }
  };
  for (let k = 0; k < CONC; k++) run();
  const wait = setInterval(() => {
    if (probeToken !== token || i >= list.length) {
      clearInterval(wait);
      if (probeToken === token) {
        const ok = list.filter(c => c.checked).length;
        const bad = list.filter(c => c.checked === false).length;
        if (bad > list.length * 0.4) {
          logEv('CAM', 'CCTV play-test: ' + ok + ' live / ' + bad + ' offline of ' + list.length);
        }
        refreshPanel('cctv');
      }
    }
  }, 1500);
}

/* ── localStorage cache so the panel is populated instantly on boot ── */
const CACHE_KEY = 'void.cctv.hls.v2';
function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.cameras)) return null;
    const age = Date.now() - (data.at || 0);
    if (age > 24 * 3600 * 1000) return null;
    return data;
  } catch (_) { return null; }
}
/** Render the last known camera set before the network answers. */
export function hydrateCachedCCTV() {
  if (S.cctvFeeds.length) return false;
  const data = readCache();
  if (!data) return false;
  const cams = data.cameras
    .filter(c => c && c.live && c.stream && isFinite(c.lat) && isFinite(c.lon))
    .map(c => ({ ...c, image: null, family: c.family || 'cached', env: c.env || 'traffic', checked: null, source: 'LIVE HLS · ' + (c.attribution || 'public CCTV') }));
  if (!cams.length) return false;
  S.cctvFeeds = cams;
  S.cctvTotal = data.total || cams.length;
  drawMarkers(cams);
  refreshPanel('cctv');
  return true;
}

/** Remember total stream count for the cached snapshot. */
function writeCache(cams, total) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      at: Date.now(),
      total: total || cams.length,
      cameras: cams.map(c => ({
        id: c.id, name: c.name, lat: c.lat, lon: c.lon, stream: c.stream, live: c.live,
        country: c.country, quality: c.quality, verified: c.verified, attribution: c.attribution,
      })),
    }));
  } catch (_) { /* quota — ignore */ }
}

function drawMarkers(cams) {
  cams.forEach(cam => {
    if (!isFinite(cam.lat) || !isFinite(cam.lon)) return;   // never feed Leaflet NaN
    const live = !!cam.live;
    const mk = L.marker([cam.lat, cam.lon], { icon: mkIcon('📹', live ? '#ff2244' : '#ffaa00', 16) })
      .bindPopup(mkPop(live ? 'LIVE CAMERA' : 'CCTV CAMERA', [
        ['Name', cam.name], ['Coords', cam.lat.toFixed(4) + ', ' + cam.lon.toFixed(4)],
        ['Feed', live ? 'LIVE HLS video stream' : 'Live still (2s refresh)'],
        ['Country', cam.country],
        ['Stream', cam.stream ? String(cam.stream).slice(0, 46) : 'TfL JamCams still'],
        ['Source', cam.source || 'public CCTV'],
      ]));
    registerMarker('cctv', cam.id, mk);
    mk.addTo(S.CG.cctv);
  });
}

export async function fetchCCTV() {
  const token = Symbol(); S.fetchId.cctv = token;
  if (!S.vis.cctv) { S.lock.cctv = false; return; }
  if (S.lock.cctv) return;
  S.lock.cctv = true;
  S.CG.cctv?.clearLayers();
  clearMarkers('cctv');

  let mode = 'hls';
  if (!S.cctvFeeds.length) hydrateCachedCCTV();
  try {
    const geo = await getJSON(ENDPOINTS.cctvHls, 60000);
    if (S.fetchId.cctv !== token) { S.lock.cctv = false; return; }
    if (!geo || !Array.isArray(geo.features)) throw new Error('bad payload');

    const all = hlsToCams(geo.features);
    if (!all.length) throw new Error('no active HLS stream');

    // panel keeps the round-robin order: every country/network is interleaved
    const panelCams = diversePick(all, LIMITS.cctvList, byNetwork);
    const mapCams = diversePick(all, LIMITS.cctvMarkers, byCountry);

    S.cctvFeeds = panelCams;
    S.cctvTotal = all.length;
    drawMarkers(mapCams);
    writeCache(panelCams, all.length);
  } catch (e) {
    // HLS index unreachable → fall back to TfL JamCams stills so the panel
    // is never empty.
    mode = 'tfl';
    try {
      const places = await getJSON(ENDPOINTS.cctv, 25000);
      if (S.fetchId.cctv !== token) { S.lock.cctv = false; return; }
      if (!Array.isArray(places)) throw new Error('bad payload');
      const usable = places.filter(p => p.lat != null && p.lon != null && prop(p, 'available') === 'true' && prop(p, 'imageUrl'));
      S.cctvTotal = usable.length;
      S.cctvFeeds = pickTflCameras(usable, LIMITS.cctvList);
      drawMarkers(S.cctvFeeds);
    } catch (e2) {
      S.cctvTotal = 0;
      S.cctvFeeds = [];
      logEv('CAM', 'CCTV unavailable (' + (e2 && e2.message ? e2.message : e2) + ') — check the local server');
    }
  }

  if (mode === 'hls') {
    logEv('CAM', 'CCTV: ' + S.cctvFeeds.length + ' LIVE HLS streams curated, ' +
      S.cctvTotal + ' active cameras worldwide (map: ' + LIMITS.cctvMarkers + ')');
    probeCams(S.cctvFeeds.slice(0, LIMITS.cctvProbe));   // detached play-test
  } else {
    logEv('CAM', 'CCTV fallback: ' + S.cctvFeeds.length + ' TfL cameras (2s snapshots) — HLS index unreachable');
  }
  refreshPanel('cctv');
  S.lock.cctv = false;
}

export const schedCCTV = () =>
  setTimeout(async () => { await fetchCCTV(); schedCCTV(); }, REFRESH_MS.cctv);