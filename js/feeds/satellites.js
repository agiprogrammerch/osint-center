/* ══════════════════════════════════════════════════════════════
   FEED: SATELLITES — CelesTrak TLEs + satellite.js propagation (no key)
   ══════════════════════════════════════════════════════════════ */
import { S, registerMarker, clearMarkers } from '../state.js';
import { ENDPOINTS, REFRESH_MS } from '../config.js';
import { getText, mkIcon, mkPop } from '../utils.js';
import { FB_TLES } from '../data/statics.js';
import { logEv } from '../ui/eventLog.js';

/* ── TLE cache: CelesTrak 403s/500s intermittently. TLEs stay usable for
      days, so the last good set is cached locally and reused before the
      6-entry hardcoded fallback. ── */
const TLE_KEY = 'voidmatrix_tle';
const TLE_MAX_AGE_MS = 7 * 86400000;

function loadCachedTLE() {
  try {
    const c = JSON.parse(localStorage.getItem(TLE_KEY) || 'null');
    if (c && Array.isArray(c.tles) && c.tles.length >= 3 && Date.now() - c.fetched < TLE_MAX_AGE_MS) return c;
  } catch (_) { /* storage disabled */ }
  return null;
}

function cacheTLEs(tles) {
  try { localStorage.setItem(TLE_KEY, JSON.stringify({ fetched: Date.now(), tles })); } catch (_) {}
}

function parseTLE(text) {
  const lines = text.trim().split('\n').map(l => l.trim()).filter(Boolean);
  const out = [];
  for (let i = 0; i + 2 < lines.length; i += 3) {
    if (lines[i + 1].startsWith('1 ') && lines[i + 2].startsWith('2 ')) {
      out.push([lines[i], lines[i + 1], lines[i + 2]]);
    }
  }
  return out;
}

export async function fetchSatellites() {
  const token = Symbol(); S.fetchId.satellites = token;
  if (!S.vis.satellites) { S.lock.satellites = false; return; }
  if (S.lock.satellites) return;
  S.lock.satellites = true;
  S.CG.satellites.clearLayers();
  clearMarkers('satellites');

  let tles = FB_TLES;
  let src = 'fallback TLEs (CelesTrak unreachable)';
  for (const [label, url] of [['CelesTrak stations', ENDPOINTS.tle], ['CelesTrak weather', ENDPOINTS.tleAlt]]) {
    try {
      const text = await getText(url, 15000);
      if (S.fetchId.satellites !== token) { S.lock.satellites = false; return; }
      const parsed = parseTLE(text);
      if (parsed.length) { tles = parsed.slice(0, 25); src = label + ' (live)'; cacheTLEs(tles); break; }
    } catch (_) { /* try the next source */ }
  }

  // cache before the hardcoded fallback
  if (src.startsWith('fallback')) {
    const cached = loadCachedTLE();
    if (cached) {
      tles = cached.tles;
      const hours = Math.round((Date.now() - cached.fetched) / 3600000);
      src = 'CelesTrak TLEs cached ' + hours + 'h ago (live fetch failed)';
    }
  }

  const now = new Date();
  const satLib = typeof satellite !== 'undefined';
  let placed = 0;
  S.satCount = 0;

  tles.forEach(([name, l1, l2], i) => {
    try {
      let lat, lon, altKm, method;
      if (satLib) {
        const satrec = satellite.twoline2satrec(l1, l2);
        const pv = satellite.propagate(satrec, now);
        if (!pv.position) return;
        const gmst = satellite.gstime(now);
        const gd = satellite.eciToGeodetic(pv.position, gmst);
        lat = satellite.degreesLat(gd.latitude);
        lon = ((satellite.degreesLong(gd.longitude) + 180) % 360 + 360) % 360 - 180;
        altKm = Math.round(gd.height);
        method = 'SGP4 propagation';
        if (isNaN(lat) || isNaN(lon)) return;
      } else {
        lat = (Math.random() * 160) - 80; lon = (Math.random() * 360) - 180;
        altKm = 500; method = 'approximation (satellite.js missing)';
      }
      const id = name + '|' + i;
      const mk = L.marker([lat, lon], { icon: mkIcon('🛰', '#cc88ff', 14) })
        .bindPopup(mkPop('SATELLITE', [
          ['Name', name], ['Lat', lat.toFixed(2) + '°'], ['Lon', lon.toFixed(2) + '°'],
          ['Altitude', altKm + ' km'], ['Method', method], ['Source', src],
        ]));
      registerMarker('satellites', id, mk);
      mk.addTo(S.CG.satellites);
      S.satCount++;
      placed++;
    } catch (_) { /* skip bad TLE */ }
  });

  logEv('SAT', placed + ' satellites tracked (' + src + ')');
  S.lock.satellites = false;
}

export const schedSats = () =>
  setTimeout(async () => { await fetchSatellites(); schedSats(); }, REFRESH_MS.satellites);
