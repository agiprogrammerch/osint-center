/* ══════════════════════════════════════════════════════════════
   OVERLAYS — graticule (lat/lon grid) and solar day/night terminator
   Real astronomy, no libraries:
     subsolar point  -> declination δ + equation of time
     terminator lat  -> atan2(-cos(H)·cos δ, sin δ), H = λ − λs
   ══════════════════════════════════════════════════════════════ */
import { S } from '../state.js';

const D2R = Math.PI / 180;

/* ── solar geometry ── */
function subsolar(date) {
  const jd = date.getTime() / 86400000 + 2440587.5;
  const n = jd - 2451545.0;
  const L = (280.460 + 0.9856474 * n) % 360;
  const g = (357.528 + 0.9856003 * n) % 360 * D2R;
  const lambda = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * D2R;
  const eps = (23.439 - 0.0000004 * n) * D2R;
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const B = (360 / 365) * (n - 81) * D2R;
  const eotMin = 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B);
  const utcH = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  const lon = 15 * (utcH - 12) + eotMin / 4;
  return { dec, lon: ((lon + 540) % 360) - 180 };
}

function terminatorLat(lng, dec, lonS) {
  const H = (lng - lonS) * D2R;
  return Math.atan2(-Math.cos(H) * Math.cos(dec), Math.sin(dec)) / D2R;
}

/** Normalise longitudes and split where the polyline jumps the antimeridian. */
function wrapPaths(points) {
  const paths = [];
  let cur = [];
  points.forEach(([lat, lng]) => {
    const w = ((lng + 180) % 360 + 360) % 360 - 180;
    if (cur.length) {
      const prev = cur[cur.length - 1][1];
      if (Math.abs(w - prev) > 180) { paths.push(cur); cur = []; }
    }
    cur.push([lat, w]);
  });
  if (cur.length) paths.push(cur);
  return paths;
}

/* ── graticule ── */
let gratGroup = null;

export function buildGraticule() {
  if (gratGroup) return gratGroup;
  gratGroup = L.layerGroup([], { pane: 'gratPane' });

  const lineStyle = { color: '#00ff41', weight: 0.4, opacity: 0.18, interactive: false, pane: 'gratPane' };

  for (let lat = -80; lat <= 80; lat += 10) {
    const pts = [];
    for (let lng = -180; lng <= 180; lng += 5) pts.push([lat, lng]);
    L.polyline(pts, { ...lineStyle, weight: lat === 0 ? 0.9 : 0.4, opacity: lat === 0 ? 0.32 : 0.18 })
      .addTo(gratGroup);
    L.marker([lat, -180], {
      pane: 'gratPane', interactive: false,
      icon: L.divIcon({ className: 'grat-lbl', html: `${Math.abs(lat)}°${lat >= 0 ? 'N' : 'S'}`, iconSize: [30, 10] }),
    }).addTo(gratGroup);
  }
  for (let lng = -180; lng <= 170; lng += 10) {
    const pts = [];
    for (let lat = -85; lat <= 85; lat += 5) pts.push([lat, lng]);
    L.polyline(pts, { ...lineStyle, weight: lng === 0 ? 0.9 : 0.4, opacity: lng === 0 ? 0.32 : 0.18 })
      .addTo(gratGroup);
    L.marker([-85, lng], {
      pane: 'gratPane', interactive: false,
      icon: L.divIcon({ className: 'grat-lbl grat-lbl-b', html: `${Math.abs(lng)}°${lng > 0 ? 'E' : lng < 0 ? 'W' : ''}`, iconSize: [30, 10] }),
    }).addTo(gratGroup);
  }
  return gratGroup;
}

/* ── day / night terminator ── */
let nightGroup = null;
let nightTimer = null;
const NIGHT_FILL = '#001028';
const NIGHT_LINE = '#4aa3ff';

function drawNight(date) {
  if (nightGroup) S.map.removeLayer(nightGroup);
  nightGroup = L.layerGroup([], { pane: 'nightPane' });

  const { dec, lon } = subsolar(date);
  const step = 2;

  // full 360° sweep of the terminator
  const circle = [];
  for (let lng = lon - 90; lng <= lon + 270; lng += step) {
    circle.push([terminatorLat(lng, dec, lon), lng]);
  }

  // boundary lines
  wrapPaths(circle).forEach(p =>
    L.polyline(p, { color: NIGHT_LINE, weight: 1, opacity: 0.75, dashArray: '4,4', interactive: false, pane: 'nightPane' })
      .addTo(nightGroup));

  // night cap: boundary + the pole that is currently in darkness. Wrapped
  // paths each get their own polygon so an antimeridian crossing still fills.
  const nightPole = dec > 0 ? [-90, lon] : [90, lon];
  wrapPaths([...circle, nightPole]).forEach(p => {
    if (p.length < 3) return;
    L.polygon(p, {
      color: NIGHT_LINE, weight: 0, fillColor: NIGHT_FILL, fillOpacity: 0.28,
      interactive: false, pane: 'nightPane',
    }).addTo(nightGroup);
  });

  // subsolar marker (the point where the sun is overhead)
  L.marker([dec / D2R, lon], {
    pane: 'nightPane', interactive: false,
    icon: L.divIcon({ className: 'subsolar', html: '☀', iconSize: [14, 14] }),
  }).addTo(nightGroup);

  S.map.addLayer(nightGroup);
  return { lat: dec / D2R, lon };
}

export function toggleNight() {
  S.nightOn = !S.nightOn;
  if (S.nightOn) {
    const p = drawNight(new Date());
    logEv('Solar terminator active — subsolar at ' + fmt(p.lat) + ', ' + fmt(p.lon));
    if (nightTimer) clearInterval(nightTimer);
    nightTimer = setInterval(() => { if (S.nightOn) drawNight(new Date()); }, 60000);
  } else {
    stopNight();
    logEv('Solar terminator deactivated');
  }
  return S.nightOn;
}

/** Stop the 1-minute terminator refresh and remove the overlay. */
export function stopNight() {
  if (nightTimer) clearInterval(nightTimer);
  nightTimer = null;
  if (nightGroup && S.map && S.map.hasLayer(nightGroup)) S.map.removeLayer(nightGroup);
}

export function toggleGraticule() {
  S.gratOn = !S.gratOn;
  const g = buildGraticule();
  if (S.gratOn) { S.map.addLayer(g); logEv('Graticule enabled (10° grid)'); }
  else { S.map.removeLayer(g); logEv('Graticule disabled'); }
  return S.gratOn;
}


const fmt = (v) => (Math.round(v * 100) / 100) + '°';
function logEv(m) { import('../ui/eventLog.js').then(x => x.logEv('SYS', m)); }
