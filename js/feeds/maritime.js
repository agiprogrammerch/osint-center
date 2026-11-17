/* ══════════════════════════════════════════════════════════════
   FEED: MARITIME — real AIS vessel positions (Digitraffic, Baltic Sea)
   Free, key-less, CC-BY open data. Per vessel:
     name, MMSI, IMO, callsign, flag country (from the MMSI MID),
     type (ITU ship type), dimensions (LOA x beam, from AIS reference points),
     speed (SOG), course/heading, navigation status, destination, ETA,
     draught, position age.
   Military and law-enforcement vessels are detected from the AIS ship type
   (35/55) plus name/callsign patterns and get their own marker + filter.
   ══════════════════════════════════════════════════════════════ */
import { S, registerMarker, clearMarkers } from '../state.js';
import { ENDPOINTS, REFRESH_MS, LIMITS } from '../config.js';
import { getJSON, mkIcon, mkPop, setStat, num, timeSince } from '../utils.js';
import { SH_ZONES, SH_COLOR } from '../data/statics.js';
import { flagCountry } from '../data/msidMid.js';
import { logEv } from '../ui/eventLog.js';
import { refreshPanel } from '../ui/panels/registry.js';

const AIS_MAX_AGE_MS = 45 * 60 * 1000;
const ZONE_RADIUS_DEG = 3;

/* ── ITU/IMO AIS ship types ── */
const SHIP_TYPES = {
  0:  { label: 'NOT AVAILABLE', icon: '❔', color: '#00ff41' },
  30: { label: 'FISHING',        icon: '🎣', color: '#ff4466' },
  31: { label: 'TOWING',         icon: '🔧', color: '#aaddff' },
  32: { label: 'TOWING (LONG)',  icon: '🔧', color: '#aaddff' },
  33: { label: 'DREDGING',       icon: '🔧', color: '#aaddff' },
  34: { label: 'DIVING OPS',     icon: '🔧', color: '#aaddff' },
  35: { label: 'MILITARY OPS',   icon: '🚨', color: '#ff2244', military: true },
  36: { label: 'SAILING',        icon: '⛵', color: '#00ff41' },
  37: { label: 'PLEASURE CRAFT', icon: '⛵', color: '#00ff41' },
  40: { label: 'HIGH-SPEED',     icon: '⚡', color: '#ffdd00' },
  50: { label: 'PILOT VESSEL',   icon: '🧭', color: '#ffdd00' },
  51: { label: 'SEARCH & RESCUE',icon: '🛟', color: '#ffaa00' },
  52: { label: 'TUG',            icon: '🚢', color: '#aaddff' },
  53: { label: 'PORT TENDER',    icon: '🧭', color: '#ffdd00' },
  54: { label: 'ANTI-POLLUTION', icon: '🧭', color: '#ffdd00' },
  55: { label: 'LAW ENFORCEMENT',icon: '🚔', color: '#ff2244', military: true },
  58: { label: 'MEDICAL',        icon: '🛟', color: '#ffaa00' },
  60: { label: 'PASSENGER',      icon: '🛳', color: '#00eeff' },
  70: { label: 'CARGO',          icon: '📦', color: '#ffaa00' },
  80: { label: 'TANKER',         icon: '🛢', color: '#ff8800' },
  90: { label: 'OTHER',          icon: '🚢', color: '#00ff41' },
};
const typeRange = (t) =>
  SHIP_TYPES[t] || (t >= 20 && t <= 29 ? SHIP_TYPES[0]
    : t >= 36 && t <= 39 ? SHIP_TYPES[37]
    : t >= 40 && t <= 49 ? SHIP_TYPES[40]
    : t >= 50 && t <= 59 ? SHIP_TYPES[50]
    : t >= 60 && t <= 69 ? SHIP_TYPES[60]
    : t >= 70 && t <= 79 ? SHIP_TYPES[70]
    : t >= 80 && t <= 89 ? SHIP_TYPES[80]
    : SHIP_TYPES[90]);

/** Military / government vessels: AIS ship type 35/55, or obvious naming. */
const MIL_NAME_RE = /(NATO|WARSHIP|HNLMS|^HMS\b|^USS\b|^HMCS\b|KDM|HDMS|^ORP\b|HSWMS|NAVY|COAST ?GUARD|COASTGUARD|GUARDIA COSTIERA|KUSTVAKT|RAJAVARTIO|BORDER GUARD|PATROL|CUSTOMS|DOUANES|GENDARMERIE|^FNS\b|UNCN|EUNAVFOR|^SFN\b|TCG|^BNS\b|^NRP\b|^SPS\b|^ITS\b|MINELAYER|MINESWEEP|CORVETTE|FRIGATE|DESTROYER|SUBMARINE|^U\d{3}$|^P\d{3}$|^M\d{3}$|^ROU\b|^BND\b)/i;
const isMilitary = (v) => !!(typeRange(v.shipType).military || (v.name && MIL_NAME_RE.test(v.name)));

/* ── AIS packed ETA: 20-bit (month, day, hour, minute) ── */
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function decodeEta(v) {
  if (!v || v <= 0 || v >= (1 << 20)) return null;
  const minute = v % 60;
  const hour = Math.floor(v / 60) % 24;
  const day = Math.floor(v / (60 * 24)) % 31;
  const month = Math.floor(v / (60 * 24 * 31)) % 12;
  if (!month || !day || hour > 23 || minute > 59) return null;
  const now = new Date();
  let year = now.getUTCFullYear();
  const d = new Date(Date.UTC(year, month - 1, day, hour, minute));
  if (d.getTime() < now.getTime()) d.setUTCFullYear(++year);
  const hh = String(d.getUTCHours()).padStart(2, '0'), mm = String(d.getUTCMinutes()).padStart(2, '0');
  return d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear() + ' ' + hh + ':' + mm + ' UTC';
}

/** UN/LOCODE destination prefixes (ISO 3166-1 alpha-2) -> country. */
const LOCODE_CC = { EE:'Estonia', FI:'Finland', SE:'Sweden', RU:'Russian Federation',
  NO:'Norway', DK:'Denmark', DE:'Germany', NL:'Netherlands', BE:'Belgium', GB:'United Kingdom',
  PL:'Poland', LV:'Latvia', LT:'Lithuania', FR:'France', ES:'Spain', IT:'Italy', PT:'Portugal',
  CN:'China', US:'United States', TR:'Türkiye', GR:'Greece', EG:'Egypt', IN:'India', KR:'South Korea',
  JP:'Japan', BR:'Brazil', SA:'Saudi Arabia', AE:'United Arab Emirates', MA:'Morocco', HR:'Croatia' };
function destCountry(dest) {
  if (!dest) return null;
  const m = String(dest).trim().toUpperCase().match(/^([A-Z]{2})[ _-]/);
  return m ? (LOCODE_CC[m[1]] || null) : null;
}

const NAV_STAT = { 0: 'UNDER WAY (ENGINE)', 1: 'AT ANCHOR', 2: 'NOT UNDER COMMAND',
  3: 'RESTRICTED MANOEUVRABILITY', 4: 'CONSTRAINED BY DRAUGHT', 5: 'MOORED', 6: 'AGROUND',
  7: 'ENGAGED IN FISHING', 8: 'UNDER SAIL', 9: 'RESERVED (HSC)', 11: 'TOWING ASTERN',
  12: 'PUSHING AHEAD', 13: 'RESERVED', 14: 'AIS-SART', 15: 'NOT DEFINED' };

/* ── simulation fallback (only when the AIS API is unreachable) ── */
function advanceVessel(v, dt) {
  const R = 6371000, speedMs = v.speed * 0.514444, dist = speedMs * dt, r = Math.PI / 180;
  const lat1 = v.lat * r, lon1 = v.lon * r, brng = v.heading * r;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(dist / R) + Math.cos(lat1) * Math.sin(dist / R) * Math.cos(brng));
  const lon2 = lon1 + Math.atan2(Math.sin(brng) * Math.sin(dist / R) * Math.cos(lat1),
                                 Math.cos(dist / R) - Math.sin(lat1) * Math.sin(lat2));
  v.lat = lat2 / r; v.lon = lon2 / r; v.lastUpdate = Date.now();
}
function seedSimVessels() {
  if (S.simVessels?.length) return S.simVessels;
  const now = Date.now();
  const list = [];
  SH_ZONES.forEach(z => {
    const count = Math.min(6, Math.floor(z.v / 45));
    for (let i = 0; i < count; i++) {
      list.push({
        id: 'sim_' + z.n.replace(/\W+/g, '') + '_' + i, mmsi: null, simulated: true, zone: z.n,
        lat: z.lat + (Math.random() - .5) * 0.10, lon: z.lon + (Math.random() - .5) * 0.10,
        speed: 6 + Math.random() * 14, heading: Math.random() * 360,
        sog: 6 + Math.random() * 14, cog: Math.random() * 360,
        lastUpdate: now, shipType: 0, type: typeRange(0),
      });
    }
  });
  S.simVessels = list;
  return list;
}

export async function fetchShips() {
  const token = Symbol(); S.fetchId.ships = token;
  if (!S.vis.ships) { S.lock.ships = false; return; }
  if (S.lock.ships) return;
  S.lock.ships = true;
  S.CG.ships.clearLayers();
  S.LG.shipZones.clearLayers();
  clearMarkers('ships');

  let vessels = [];
  let source = '';
  let simulated = false;

  try {
    const [locs, meta] = await Promise.all([
      getJSON(ENDPOINTS.ais, 20000),
      getJSON(ENDPOINTS.aisMeta, 20000),
    ]);
    if (S.fetchId.ships !== token) { S.lock.ships = false; return; }
    if (!Array.isArray(locs?.features)) throw new Error('bad AIS payload');

    const byMmsi = new Map((meta || []).map(v => [v.mmsi, v]));
    const now = Date.now();
    const seen = new Set();

    vessels = locs.features
      .filter(f => f.geometry?.type === 'Point' && f.properties?.mmsi)
      .map(f => {
        const p = f.properties;
        const [lon, lat] = f.geometry.coordinates;
        const m = byMmsi.get(p.mmsi) || {};
        const shipType = m.shipType ?? null;
        const len = (m.referencePointA ?? null) != null && (m.referencePointB ?? null) != null
          ? m.referencePointA + m.referencePointB : null;
        const beam = (m.referencePointC ?? null) != null && (m.referencePointD ?? null) != null
          ? m.referencePointC + m.referencePointD : null;
        const v = {
          id: 'mmsi:' + p.mmsi,
          mmsi: p.mmsi,
          name: (m.name || '').trim() || null,
          callsign: (m.callSign || '').trim() || null,
          imo: m.imo && m.imo > 0 ? m.imo : null,
          flag: flagCountry(p.mmsi),
          shipType,
          type: typeRange(shipType),
          lengthM: len, beamM: beam,
          lat, lon,
          sog: p.sog ?? null,
          cog: p.cog ?? null,
          heading: p.heading != null && p.heading !== 511 ? p.heading : null,
          navStat: p.navStat ?? null,
          destination: (m.destination || '').trim() || null,
          eta: m.eta || null,
          draught: m.draught != null ? m.draught / 10 : null,
          ts: p.timestampExternal || null,
          ageMs: p.timestampExternal ? now - p.timestampExternal : null,
        };
        v.military = isMilitary(v);
        return v;
      })
      .filter(v => v.lat != null && v.lon != null)
      .filter(v => v.ageMs == null || v.ageMs < AIS_MAX_AGE_MS)
      .filter(v => { if (seen.has(v.id)) return false; seen.add(v.id); return true; })
      .slice(0, LIMITS.shipMarkers);

    if (!vessels.length) throw new Error('no fresh AIS positions');
    source = 'Digitraffic AIS (Baltic) — live';
  } catch (e) {
    simulated = true;
    const sims = seedSimVessels();
    sims.forEach(v => advanceVessel(v, (Date.now() - (v.lastUpdate || Date.now())) / 1000));
    sims.forEach(v => { v.type = typeRange(0); v.military = false; });
    vessels = sims;
    source = 'SIMULATED — live AIS unreachable';
    logEv('NAV', 'Live AIS unavailable (' + (e && e.message ? e.message : e) + ') — falling back to simulated drift');
  }

  S.vesselObjects = vessels;
  S.shipSource = source;

  /* ── vessel markers ── */
  vessels.forEach(v => {
    const t = v.type;
    const icon = v.military ? '🚨' : t.icon;
    const color = v.military ? '#ff2244' : t.color;
    const speed = v.sog != null ? Math.round(v.sog * 10) / 10 : null;
    const course = v.heading ?? (v.cog != null ? Math.round(v.cog) : null);
    const mk = L.marker([v.lat, v.lon], { icon: mkIcon(icon, color, v.military ? 14 : 12) })
      .bindPopup(mkPop((v.name || 'UNKNOWN VESSEL') + (v.military ? ' ⟫ MILITARY' : ''), [
        ['Type', t.label + (v.shipType != null ? ' (AIS code ' + v.shipType + ')' : '')],
        v.military ? ['Category', 'MILITARY / GOVERNMENT'] : null,
        v.mmsi ? ['MMSI', v.mmsi] : null,
        v.flag ? ['Flag country (MMSI MID)', v.flag] : null,
        v.imo ? ['IMO', v.imo] : null,
        v.callsign ? ['Callsign', v.callsign] : null,
        v.lengthM ? ['Size', v.lengthM + ' m x ' + (v.beamM ?? '?') + ' m (LOA x beam)'] : null,
        v.draught ? ['Draught', v.draught.toFixed(1) + ' m'] : null,
        ['Speed', speed != null ? speed + ' kn (' + (speed * 1.852).toFixed(1) + ' km/h)' : 'n/a'],
        course != null ? ['Course / heading', course + '°' + (v.cog != null && v.heading != null ? ' (COG ' + Math.round(v.cog) + '°)' : '')] : null,
        v.navStat != null ? ['Navigation', NAV_STAT[v.navStat] || v.navStat] : null,
        v.destination ? ['Destination', v.destination + (destCountry(v.destination) ? ' — ' + destCountry(v.destination) : '')] : null,
        (() => { const eta = decodeEta(v.eta); return eta ? ['ETA (AIS)', eta] : null; })(),
        ['Position', v.lat.toFixed(4) + ', ' + v.lon.toFixed(4)],
        v.simulated ? ['Note', 'Simulated — no key-free AIS available']
                    : (v.ageMs != null ? ['Position age', timeSince(v.ts)] : null),
        ['Source', source],
      ].filter(Boolean)));
    registerMarker('ships', v.id, mk);
    mk.addTo(S.CG.ships);
  });

  /* ── AIS coverage box + chokepoints with real counts ── */
  const lats = vessels.map(v => v.lat), lngs = vessels.map(v => v.lon);
  const bbox = (!simulated && lats.length)
    ? { minLat: Math.min(...lats), maxLat: Math.max(...lats), minLng: Math.min(...lngs), maxLng: Math.max(...lngs) }
    : null;
  S.aisBounds = bbox;
  const inside = (z) => bbox && z.lat >= bbox.minLat && z.lat <= bbox.maxLat
                        && z.lon >= bbox.minLng && z.lon <= bbox.maxLng;

  if (bbox) {
    L.rectangle([[bbox.minLat, bbox.minLng], [bbox.maxLat, bbox.maxLng]], {
      color: '#00eeff', weight: 1, dashArray: '6,6', fill: false, interactive: true,
    }).bindPopup(mkPop('AIS FEED COVERAGE', [
      ['Provider', 'Digitraffic / Finnish Transport Infrastructure Agency'],
      ['Region', 'Baltic Sea & Gulf of Finland (free, key-less, CC-BY)'],
      ['Live vessels in box', vessels.length],
      ['Military / gov vessels', vessels.filter(v => v.military).length],
      ['Extent', bbox.minLat.toFixed(1) + '–' + bbox.maxLat.toFixed(1) + 'N, '
                + bbox.minLng.toFixed(1) + '–' + bbox.maxLng.toFixed(1) + 'E'],
    ])).addTo(S.LG.shipZones);
  }

  SH_ZONES.forEach(z => {
    const near = !simulated && inside(z)
      ? vessels.filter(v => Math.abs(v.lat - z.lat) < ZONE_RADIUS_DEG
                          && Math.abs(v.lon - z.lon) < ZONE_RADIUS_DEG).length
      : null;
    const col = SH_COLOR[z.r] || '#00eeff';
    L.circleMarker([z.lat, z.lon], {
      radius: Math.min(22, 6 + (near != null ? Math.min(near, 400) : z.v) / 20),
      color: col, fillColor: col, fillOpacity: .16, weight: 2,
    }).bindPopup(mkPop('SHIPPING ZONE', [
      ['Zone', z.n],
      ['Risk', z.r],
      near != null ? ['Vessels now (AIS, ±3°)', near] : ['~Vessels', '~' + z.v + ' typical traffic (outside AIS coverage)'],
      ['Source', simulated ? 'Simulated positions' : 'Digitraffic AIS — live'],
    ])).addTo(S.LG.shipZones);
  });

  const mil = vessels.filter(v => v.military).length;
  setStat('s-sh', num(vessels.length));
  logEv('NAV', 'Maritime: ' + num(vessels.length) + ' vessels from ' + source
    + (mil ? ' · ' + mil + ' military/gov' : '') + (simulated ? '' : ' (14 chokepoints with live counts)'));
  refreshPanel('overview');
  refreshPanel('ships');
  S.lock.ships = false;
}

export const schedShips = () =>
  setTimeout(async () => { await fetchShips(); schedShips(); }, REFRESH_MS.ships);
