/* ══════════════════════════════════════════════════════════════
   FEED: AIR TRAFFIC — OpenSky Network (live) → simulation (fallback)
   ══════════════════════════════════════════════════════════════ */
import { S, registerMarker, clearMarkers } from '../state.js';
import { ENDPOINTS, REFRESH_MS, LIMITS, OPENSKY_OAUTH, OPENSKY_TOKEN_URL, hasOpenSkyKeys } from '../config.js';
import { getJSON, sampleArr, num, mkIcon, mkPop, setStat, upSrcBadge, postViaProxy } from '../utils.js';
import { isMil, AIRPORTS, AIRLINES, MIL_CALLS } from '../data/statics.js';
import { logEv } from '../ui/eventLog.js';
import { refreshPanel } from '../ui/panels/registry.js';
import { describe, operatorOf, modelOf, onAircraftMeta, prefetch } from './aircraftMeta.js';

/* ── OpenSky OAuth (optional; free account) ── */
let oauthToken = null;
let oauthExpiry = 0;
let backoffMs = 0;

/** Returns a bearer token, or null when no credentials are configured. */
async function openSkyToken() {
  if (!hasOpenSkyKeys()) return null;
  if (oauthToken && Date.now() < oauthExpiry - 30000) return oauthToken;
  try {
    const res = await postViaProxy({
      url: OPENSKY_TOKEN_URL,
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: OPENSKY_OAUTH.clientId,
        client_secret: OPENSKY_OAUTH.clientSecret,
      }).toString(),
    });
    if (!res?.access_token) throw new Error('no access_token in response');
    oauthToken = res.access_token;
    oauthExpiry = Date.now() + (res.expires_in || 1800) * 1000;
    S.oauthActive = true;
    setStat('src-badge', 'SRC: OpenSky (OAuth)');
    logEv('AIR', 'OpenSky OAuth token acquired — authenticated feed active');
    return oauthToken;
  } catch (e) {
    logEv('AIR', 'OAuth token failed (' + e.message + ') — continuing anonymously');
    oauthToken = null;
    return null;
  }
}

/* ── source parsers ── */
const FLIGHT_SOURCES = [
  {
    name: 'OpenSky',
    url: () => ENDPOINTS.flights,
    parse(data) {
      if (!data || !Array.isArray(data.states)) return null;
      return data.states
        .filter(s => s[5] != null && s[6] != null && s[8] === false)   // lon, lat, not on ground
        .map(s => ({
          icao: (s[0] || '').trim(),
          call: (s[1] || '').trim(),
          country: (s[2] || '').trim(),          // country of registration
          lat: s[6], lon: s[5],
          alt: s[13] != null ? Math.round(s[13]) : (s[7] != null ? Math.round(s[7]) : null),
          geoAlt: s[7] != null ? Math.round(s[7]) : null,
          hdg: s[10] != null ? Math.round(s[10]) : null,
          vel: s[9] != null ? Math.round(s[9] * 1.94384) : null,
          vs: s[11] != null ? Math.round(s[11] * 196.85) : null,   // vertical rate, ft/min
          squawk: s[14] && s[14] !== '0000' ? String(s[14]) : null,
          timePos: s[3] || null,                 // last position report (epoch s)
          lastContact: s[4] || null,
        }));
    },
  },
];

/* ── live fetch ── */
export async function fetchFlights() {
  const runToken = Symbol(); S.fetchId.flights = runToken;
  if (S.lock.flights) return;
  S.lock.flights = true;

  let result = null;
  try {
    const src = FLIGHT_SOURCES[0];
    const accessToken = await openSkyToken();
    const headers = accessToken ? { Authorization: 'Bearer ' + accessToken } : undefined;
    const data = await getJSON(src.url(), 12000, headers);
    if (S.fetchId.flights === runToken) {
      const parsed = data ? src.parse(data) : null;
      if (parsed && parsed.length) result = { parsed, name: src.name };
    }
  } catch (_) { result = null; }

  if (S.fetchId.flights !== runToken) { S.lock.flights = false; return; }

  if (result) {
    if (S.simActive) stopFlightSimulation();
    S.liveRetryCount = 0;
    backoffMs = 0;
    S.flightSource = S.oauthActive ? result.name + ' (OAuth)' : result.name;
    upSrcBadge(S.flightSource);

    const sampled = sampleArr(result.parsed, LIMITS.flightMarkers);
    const { civ, mil } = applyFlightBatch(sampled, result.name);
    S.flightData = civ;
    S.militaryFlightData = mil;
    setStat('s-fl', num(result.parsed.length));
    logEv('AIR', `${result.name}: ${num(result.parsed.length)} airborne (${mil.length} mil, ${civ.length} civ)`);
    refreshPanel('flights');

  } else {
    S.liveRetryCount++;
    // Exponential backoff: OpenSky's free tier answers 429 when crowded, so
    // retry at 45s → 90s → 180s → 300s (cap) instead of hammering it.
    const delay = Math.min(300000, 45000 * Math.pow(2, Math.min(S.liveRetryCount - 1, 4)));
    const haveLive = !S.simActive && (S.flightData.length + S.militaryFlightData.length) > 0;

    if (!S.simActive && !haveLive && S.liveRetryCount >= 2) {
      startFlightSimulation();
    } else {
      upSrcBadge(S.simActive ? 'SIMULATED' : 'RETRYING');
      logEv('AIR', haveLive
        ? 'Live refresh failed (rate limit?) — keeping last real positions, retrying in ' + Math.round(delay / 1000) + 's'
        : S.simActive ? 'Live data still unavailable — retrying in ' + Math.round(delay / 1000) + 's'
                      : 'Live flight data unavailable — retrying shortly');
      setTimeout(() => { if (!S.lock.flights) fetchFlights(); }, delay);
    }
  }
  S.lock.flights = false;
}

/** Draws a batch of live aircraft and rebuilds the marker registry. */
function applyFlightBatch(list, sourceName) {
  S.CG.flights.clearLayers();
  S.CG.military.clearLayers();
  S.LG.routes.clearLayers();
  clearMarkers('flights'); clearMarkers('military');

  const civ = [], mil = [];
  list.forEach((ac, i) => {
    if (ac.lat == null || ac.lon == null) return;
    const military = isMil(ac.call, ac.icao);
    const id = ac.icao || (ac.call || 'AC') + '#' + i;
    const rec = { ...ac, id, mil: military };
    const mk = L.marker([ac.lat, ac.lon], {
      icon: mkIcon(military ? '🎯' : '✈', military ? '#ff8800' : '#00ff41', military ? 13 : 11),
    }).bindPopup(() => aircraftPopup(rec, sourceName));
    registerMarker(military ? 'military' : 'flights', id, mk);
    (military ? mil : civ).push(rec);
    (military ? S.CG.military : S.CG.flights).addLayer(mk);
  });

  // Enrich the interesting ones (military first) — everything else loads on demand.
  const prime = [...mil, ...civ].slice(0, 30);
  prefetch(prime);
  return { civ, mil };
}

/** Keep an open popup in sync with enrichment that arrives after it opened. */
function watchPopupEnrichment() {
  onAircraftMeta((icao) => {
    const mk = S.markers.flights?.get(icao) || S.markers.military?.get(icao);
    if (mk && typeof mk.isPopupOpen === 'function' && mk.isPopupOpen()) {
      const rec = [...S.flightData, ...S.militaryFlightData].find(a => a.icao === icao);
      if (rec) mk.setPopupContent(aircraftPopup(rec, S.flightSource));
    }
  });
}
watchPopupEnrichment();

const fmtAlt = (m) => `${num(m)} m (${num(Math.round(m / 0.3048))} ft)`;

const vsArrow = (vs) => vs == null ? null : (vs > 150 ? '↑ ' : vs < -150 ? '↓ ' : '→ ') + num(Math.abs(vs)) + ' ft/min';
const ageOf = (epochSec) => {
  if (!epochSec) return null;
  const s = Math.max(0, Math.floor(Date.now() / 1000 - epochSec));
  return s < 60 ? s + 's ago' : Math.floor(s / 60) + 'm ago';
};

/** Full detail popup for one aircraft; re-read every time so enrichment shows up. */
export function aircraftPopup(ac, sourceName) {
  const meta = describe(ac.icao);
  const operator = operatorOf(ac.call);
  const model = modelOf(meta);
  const rows = [];
  if (meta?.registration) rows.push(['Registration', meta.registration]);
  rows.push(['Callsign', ac.call || 'UNKNOWN']);
  if (operator) rows.push(['Operator', operator]);
  if (model) rows.push(['Model', model]);
  if (meta?.manufacturer) rows.push(['Manufacturer', meta.manufacturer]);
  if (meta?.owner && meta.owner !== operator) rows.push(['Owner', meta.owner]);
  if (ac.country) rows.push(['Country', ac.country]);
  rows.push(['ICAO24', ac.icao || 'N/A']);
  if (meta?.typeCode) rows.push(['Type code', meta.typeCode]);
  rows.push(['Altitude', ac.alt ? fmtAlt(ac.alt) : 'N/A']);
  if (ac.geoAlt && Math.abs(ac.geoAlt - ac.alt) > 100) rows.push(['Geo altitude', fmtAlt(ac.geoAlt)]);
  if (ac.vs != null) { const v = vsArrow(ac.vs); if (v) rows.push(['Vertical rate', v]); }
  rows.push(['Ground speed', ac.vel != null ? ac.vel + ' kn' : 'N/A']);
  if (ac.hdg != null) rows.push(['Heading', ac.hdg + '°']);
  if (ac.squawk) rows.push(['Squawk', ac.squawk]);
  const age = ageOf(ac.timePos);
  if (age) rows.push(['Position age', age]);
  if (meta?.source) rows.push(['Aircraft data', meta.source + (ac.country && !meta.registration ? ' (no registration known)' : '')]);
  rows.push(['Source', sourceName]);
  if (!meta && ac.icao) rows.push(['', 'fetching aircraft details…']);

  const title = (meta?.registration ? meta.registration + ' · ' : '')
    + (ac.call || 'UNKNOWN')
    + (ac.mil ? '  ⟫ MILITARY' : '');
  return mkPop(title, rows);
}

/* ══════════════════════════════════════════════════════════════
   SIMULATION — labelled fallback when live ADS-B is unavailable
   ══════════════════════════════════════════════════════════════ */
const rndAp = () => AIRPORTS[Math.floor(Math.random() * AIRPORTS.length)];
const rndAl = () => AIRLINES[Math.floor(Math.random() * AIRLINES.length)];
const rndMil = () => MIL_CALLS[Math.floor(Math.random() * MIL_CALLS.length)];

function bearing(la1, lo1, la2, lo2) {
  const r = Math.PI / 180, d = (lo2 - lo1) * r;
  const y = Math.sin(d) * Math.cos(la2 * r);
  const x = Math.cos(la1 * r) * Math.sin(la2 * r) - Math.sin(la1 * r) * Math.cos(la2 * r) * Math.cos(d);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}
/** Point at fraction `f` along the great circle from (la1,lo1) to (la2,lo2).
 *  Spherical linear interpolation (slerp): handles identical endpoints,
 *  antimeridian crossings and any hemisphere mix correctly. */
function interpolate(la1, lo1, la2, lo2, f) {
  const r = Math.PI / 180;
  const p1 = la1 * r, p2 = la2 * r, l1 = lo1 * r, l2 = lo2 * r;
  const dp = p2 - p1, dl = l2 - l1;
  const d = 2 * Math.asin(Math.sqrt(
    Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2));
  if (!d) return { lat: la1, lng: lo1 };                    // same point twice
  const A = Math.sin((1 - f) * d) / Math.sin(d);
  const B = Math.sin(f * d) / Math.sin(d);
  const x = A * Math.cos(p1) * Math.cos(l1) + B * Math.cos(p2) * Math.cos(l2);
  const y = A * Math.cos(p1) * Math.sin(l1) + B * Math.cos(p2) * Math.sin(l2);
  const z = A * Math.sin(p1) + B * Math.sin(p2);
  const lat = Math.atan2(z, Math.sqrt(x * x + y * y));
  const lng = Math.atan2(y, x);
  return { lat: lat / r, lng: ((lng / r + 540) % 360) - 180 };
}
function gcDist(la1, lo1, la2, lo2) {
  const r = Math.PI / 180, R = 6371000;
  const a = Math.sin((la2 - la1) * r / 2) ** 2 + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin((lo2 - lo1) * r / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function generateSimulatedFlights(count = 200) {
  const flights = [];
  for (let i = 0; i < count; i++) {
    const from = rndAp(); let to = rndAp();
    while (from[0] === to[0]) to = rndAp();
    const military = i < 20;
    flights.push({
      icao: military
        ? 'AE' + Math.floor(Math.random() * 65536).toString(16).toUpperCase().padStart(4, '0')
        : 'A' + Math.random().toString(16).slice(2, 8).toUpperCase(),
      call: military ? rndMil() + Math.floor(Math.random() * 90 + 10)
                     : rndAl() + Math.floor(Math.random() * 9000 + 1000),
      military,
      lat1: from[1], lng1: from[2], lat2: to[1], lng2: to[2],
      progress: Math.random(),
      alt: military ? 30000 + Math.random() * 10000 : 25000 + Math.random() * 15000,
      speed: 400 + Math.random() * 250,
      lat: 0, lon: 0, hdg: 0,
    });
  }
  return flights;
}

function tickSimulation(dt) {
  S.simulatedFlights.forEach(f => {
    const tt = gcDist(f.lat1, f.lng1, f.lat2, f.lng2) / (f.speed / 3.6);
    f.progress = (f.progress + dt / tt) % 1;
    const pos = interpolate(f.lat1, f.lng1, f.lat2, f.lng2, f.progress);
    f.lat = pos.lat; f.lon = pos.lng;
    f.hdg = bearing(pos.lat, pos.lng, f.lat2, f.lng2);
  });
}

export function startFlightSimulation() {
  if (S.simActive) return;
  stopFlightSimulation();
  S.simulatedFlights = generateSimulatedFlights(200);
  S.lastSimUpdate = Date.now();
  S.simActive = true;
  S.flightSource = 'SIMULATED';
  upSrcBadge('SIMULATED');

  S.simInterval = setInterval(() => {
    const now = Date.now();
    tickSimulation((now - S.lastSimUpdate) / 1000);
    S.lastSimUpdate = now;

    S.CG.flights.clearLayers();
    S.CG.military.clearLayers();
    S.LG.routes.clearLayers();
    clearMarkers('flights'); clearMarkers('military');

    const civ = [], mil = [];
    S.simulatedFlights.forEach(f => {
      const ac = { icao: f.icao, call: f.call, lat: f.lat, lon: f.lon, alt: Math.round(f.alt),
                   hdg: Math.round(f.hdg), vel: null, id: f.icao, mil: f.military };
      (f.military ? mil : civ).push(ac);
      const mk = L.marker([f.lat, f.lon], {
        icon: mkIcon(f.military ? '🎯' : '✈', f.military ? '#ff8800' : '#00ff41', f.military ? 13 : 11),
      }).bindPopup(mkPop(f.military ? '🎯 MILITARY (sim)' : '✈ CIVIL (sim)', [
        ['Callsign', f.call], ['ICAO24', f.icao], ['Altitude', fmtAlt(Math.round(f.alt))],
        ['Heading', Math.round(f.hdg) + '°'], ['Note', 'Simulated — live data unavailable'],
      ]));
      registerMarker(f.military ? 'military' : 'flights', f.icao, mk);
      (f.military ? S.CG.military : S.CG.flights).addLayer(mk);

      L.polyline([[f.lat1, f.lng1], [f.lat2, f.lng2]],
        { color: f.military ? '#ff8800' : '#00ff41', opacity: 0.2, weight: 1, dashArray: '5,5' })
        .addTo(S.LG.routes);
    });

    S.flightData = civ;
    S.militaryFlightData = mil;
    setStat('s-fl', num(civ.length + mil.length) + '*');
    refreshPanel('flights');
  }, 3000);

  logEv('AIR', 'Live sources unavailable — simulated flights active, retrying in background');
}

export function stopFlightSimulation() {
  if (S.simInterval) clearInterval(S.simInterval);
  S.simInterval = null; S.simActive = false; S.simulatedFlights = [];
}

export const schedFlights = () =>
  setTimeout(async () => { await fetchFlights(); schedFlights(); }, REFRESH_MS.flights);
