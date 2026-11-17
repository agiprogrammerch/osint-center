/* ══════════════════════════════════════════════════════════════
   AIRCRAFT ENRICHMENT — free, key-less lookups + offline decoding
   • hexdb.io      → registration, manufacturer, model, owner (DB)
   • api.adsb.lol  → registration + ICAO type code (live receivers)
   Both are optional: OpenSky alone still shows everything else.
   ══════════════════════════════════════════════════════════════ */
import { getJSON } from '../utils.js';
import { S } from '../state.js';

const CACHE_KEY = 'voidmatrix_acmeta';
const MAX_BYTES = 1_500_000;
const TTL = 30 * 86400000;      // cache a hit for 30 days
const MISS_TTL = 2 * 3600000;   // "not in any database" — retry in 2h
const ERR_TTL = 10 * 60000;     // rate-limited / failed — retry in 10m
const MIN_GAP = 700;            // ms between lookups (adsb.lol asks for ~1/s)

let cache = loadCache();
const queue = [];
let working = false;
let lastRequest = 0;

/** Listeners are notified when metadata for an aircraft arrives. */
const listeners = new Set();
export function onAircraftMeta(fn) { listeners.add(fn); }

function loadCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}') || {}; } catch (_) { return {}; }
}
function persist() {
  try {
    const now = Date.now();
    const trimmed = {};
    for (const [k, v] of Object.entries(cache)) {
      const ttl = v.meta ? TTL : (v.permanent === false ? ERR_TTL : MISS_TTL);
      if (v.fetchedAt && now - v.fetchedAt < ttl) trimmed[k] = v;
    }
    const str = JSON.stringify(trimmed);
    if (str.length <= MAX_BYTES) localStorage.setItem(CACHE_KEY, str);
  } catch (_) { /* storage full or disabled */ }
}

/** Cached metadata for an aircraft (null when unknown or not fetched yet). */
export function describe(icao24) {
  if (!icao24) return null;
  const hit = cache[icao24];
  if (!hit) return null;
  const ttl = hit.meta ? TTL : (hit.permanent === false ? ERR_TTL : MISS_TTL);
  if (Date.now() - hit.fetchedAt > ttl) return null;
  return hit.meta ? { ...hit.meta, fetchedAt: hit.fetchedAt } : null;
}

/** Queue an aircraft for enrichment; resolves once its metadata is known. */
export function enrich(icao24) {
  if (!icao24) return Promise.resolve(null);
  if (describe(icao24)) return Promise.resolve(describe(icao24));
  return new Promise(resolve => { queue.push({ icao24, resolve }); work(); });
}

/** Prefetch a handful (military first — the interesting ones for OSINT). */
export function prefetch(list = []) {
  (list || []).forEach(a => { if (a?.icao && !describe(a.icao)) queue.push({ icao24: a.icao, resolve: () => {} }); });
  work();
}

/** Queue raw ICAO24 strings (used by the panel for its visible rows). */
export function enrichMany(icaos = []) {
  icaos.forEach(icao => { if (icao && !describe(icao)) queue.push({ icao24: icao, resolve: () => {} }); });
  work();
}

async function work() {
  if (working) return;
  working = true;
  while (queue.length) {
    const job = queue.shift();
    try { await lookup(job.icao24); } catch (_) { /* keep going */ }
    job.resolve(describe(job.icao24));
    listeners.forEach(fn => { try { fn(job.icao24); } catch (_) {} });
    persist();
    if (queue.length) await new Promise(r => setTimeout(r, MIN_GAP));
  }
  working = false;
}

const FOUND = (meta) => ({ meta });
const UNKNOWN = () => ({ miss: true, permanent: true });
const RETRY = () => ({ miss: true, permanent: false });

async function lookup(icao24) {
  lastRequest = Date.now();
  // Both sources in parallel: hexdb (registration DB) and adsb.lol (live
  // receivers). Either answering is enough; gaps are filled from the other.
  const [hex, air] = await Promise.all([fromHexdb(icao24), fromAdsblol(icao24)]);

  const meta = (hex.meta || air.meta)
    ? { ...(air.meta || {}), ...(hex.meta || {}), source: hex.meta ? 'hexdb.io' : 'adsb.lol' }
    : null;

  if (meta) {
    cache[icao24] = { meta, fetchedAt: Date.now() };
  } else {
    const permanent = hex.permanent !== false && air.permanent !== false;
    cache[icao24] = { miss: true, permanent, fetchedAt: Date.now() };
  }
}

async function fromAdsblol(icao24) {
  try {
    const data = await getJSON(`https://api.adsb.lol/v2/hex/${icao24}`, 8000);
    const ac = data?.ac?.[0];
    if (ac?.hex) {
      return FOUND({
        registration: ac.r || null,
        typeCode: ac.t || null,
        squawk: ac.squawk || null,
        source: 'adsb.lol',
      });
    }
    return UNKNOWN();
  } catch (_) { return RETRY(); }
}

async function fromHexdb(icao24) {
  try {
    const data = await getJSON(`https://hexdb.io/api/v1/aircraft/${icao24}`, 8000);
    if (data?.Registration) {
      return FOUND({
        registration: data.Registration,
        typeCode: data.ICAOTypeCode || null,
        model: data.Type || null,
        manufacturer: data.Manufacturer || null,
        owner: data.RegisteredOwners || null,
        source: 'hexdb.io',
      });
    }
    return UNKNOWN();
  } catch (_) { return RETRY(); }
}

/* ── offline decoding of what OpenSky itself gives us ── */
const AIRLINES = {
  THY: 'Turkish Airlines', DLH: 'Lufthansa', BAW: 'British Airways', AFR: 'Air France',
  KLM: 'KLM Royal Dutch', UAL: 'United Airlines', DAL: 'Delta Air Lines', AAL: 'American Airlines',
  SWR: 'Swiss Int. Air Lines', AUA: 'Austrian Airlines', LOT: 'LOT Polish', IBE: 'Iberia',
  TAP: 'TAP Air Portugal', SAS: 'Scandinavian', FIN: 'Finnair', NAX: 'Norwegian Air Shuttle',
  EZY: 'easyJet', RYR: 'Ryanair', WZZ: 'Wizz Air', VLG: 'Vueling', EJU: 'easyJet Europe',
  SIA: 'Singapore Airlines', QFA: 'Qantas', CPA: 'Cathay Pacific', ANA: 'All Nippon Airways',
  JAL: 'Japan Airlines', KAL: 'Korean Air', CCA: 'Air China', CES: 'China Eastern',
  CSN: 'China Southern', UAE: 'Emirates', ETD: 'Etihad Airways', QTR: 'Qatar Airways',
  SAS: 'Scandinavian', ROT: 'Tarom', HVN: 'Vietnam Airlines', MAS: 'Malaysia Airlines',
  GIA: 'Garuda Indonesia', PIA: 'Pakistan Int. Airlines', SVA: 'Saudia', MSR: 'EgyptAir',
  ETH: 'Ethiopian Airlines', SAA: 'South African Airways', RAM: 'Royal Air Maroc',
  AMX: 'Aeroméxico', CMP: 'Copa Airlines', AVP: 'Avianca', GLO: 'GOL', AZU: 'Azul',
  ARG: 'Aerolíneas Argentinas', LAN: 'LATAM', ONE: 'Oceanic', AIC: 'Air India',
  IG: 'Air India Express', ELY: 'El Al', TLV: 'CAL Cargo', FDX: 'FedEx Express',
  UPS: 'UPS Airlines', GTI: 'Atlas Air', CLX: 'Cargolux', BOX: 'Aerologic',
  ABX: 'ABX Air', NCA: 'Nippon Cargo', GEC: 'Lufthansa Cargo', CKS: 'Kalitta Air',
  ADB: 'Antonov Airlines', RCH: 'USAF Air Mobility Command', LAGR: 'USAF Air Mobility Command',
  JAKE: 'USAF Air Mobility Command', REACH: 'USAF Air Mobility Command', SPAR: 'USAF Special Ops',
  SAM: 'USAF Special Ops', VENUS: 'USAF Special Ops', IRON: 'USAF', GHOST: 'USAF',
  ATLAS: 'USAF', COBRA: 'USAF Special Ops', NAVY: 'US Navy', ARMY: 'US Army',
  EVAC: 'Aeromedical Evacuation', RFF: 'Finnish Air Force', BAF: 'Belgian Air Force',
  GAF: 'German Air Force', RRF: 'French Air Force (Rafale)', CTM: 'French Air Force',
  ASY: 'Royal Australian Air Force', CFG: 'German Air Force', MMV: 'NATO',
  RFR: 'Royal Air Force', SHF: 'RAF Shawbury', TCC: 'USATC',
};

/** Operator name from an ICAO callsign prefix (e.g. "DLH458" -> "Lufthansa"). */
export function operatorOf(callsign) {
  if (!callsign) return null;
  const cs = callsign.trim().toUpperCase();
  for (const len of [4, 3]) {
    if (cs.length >= len + 1 && AIRLINES[cs.slice(0, len)]) return AIRLINES[cs.slice(0, len)];
  }
  return null;
}

/** ICAO aircraft type code -> friendly model name. */
const TYPES = {
  A19N: 'Airbus A319neo', A20N: 'Airbus A320neo', A21N: 'Airbus A321neo',
  A310: 'Airbus A310', A318: 'Airbus A318', A319: 'Airbus A319', A320: 'Airbus A320',
  A321: 'Airbus A321', A332: 'Airbus A330-200', A333: 'Airbus A330-300',
  A338: 'Airbus A330-800neo', A339: 'Airbus A330-900neo', A342: 'Airbus A340-200',
  A343: 'Airbus A340-300', A345: 'Airbus A340-500', A346: 'Airbus A340-600',
  A359: 'Airbus A350-900', A35K: 'Airbus A350-1000', A388: 'Airbus A380-800',
  B36: 'Boeing 737-600', B37: 'Boeing 737-700', B38M: 'Boeing 737 MAX 8',
  B39M: 'Boeing 737 MAX 9', B3XM: 'Boeing 737 MAX 10', B461: 'Boeing 747-400',
  B462: 'Boeing 747-200F', B463: 'Boeing 747-300', B736: 'Boeing 737-600',
  B737: 'Boeing 737-700', B738: 'Boeing 737-800', B739: 'Boeing 737-900',
  B741: 'Boeing 747-100', B742: 'Boeing 747-200', B743: 'Boeing 747-300',
  B744: 'Boeing 747-400', B748: 'Boeing 747-8', B74S: 'Boeing 747SP',
  B752: 'Boeing 757-200', B753: 'Boeing 757-300', B762: 'Boeing 767-200',
  B763: 'Boeing 767-300', B764: 'Boeing 767-400ER', B772: 'Boeing 777-200',
  B773: 'Boeing 777-300', B77L: 'Boeing 777-200LR', B77W: 'Boeing 777-300ER',
  B778: 'Boeing 777-8', B779: 'Boeing 777-9', B788: 'Boeing 787-8',
  B789: 'Boeing 787-9', B78X: 'Boeing 787-10', BCS1: 'Airbus A220-100',
  BCS3: 'Airbus A220-300', MD11: 'McDonnell Douglas MD-11', MD82: 'MD-82',
  MD83: 'MD-83', MD90: 'MD-90', DC10: 'Douglas DC-10', CRJ7: 'Bombardier CRJ-700',
  CRJ9: 'Bombardier CRJ-900', CRJX: 'Bombardier CRJ-1000', E75L: 'Embraer 175 (LR)',
  E75S: 'Embraer 175 (STD)', E190: 'Embraer 190', E195: 'Embraer 195',
  E290: 'Embraer 190-E2', E295: 'Embraer 195-E2', PC12: 'Pilatus PC-12',
  PC24: 'Pilatus PC-24', C172: 'Cessna 172', C182: 'Cessna 182', C208: 'Cessna 208 Caravan',
  C25B: 'Cessna Citation CJ4', C56X: 'Cessna Citation Excel', C650: 'Cessna Citation III',
  CL60: 'Bombardier Challenger 604', GL7T: 'Bombardier Global 7500',
  GLEX: 'Bombardier Global Express', LJ35: 'Learjet 35', LJ45: 'Learjet 45',
  H25B: 'British Aerospace 125-800', F2TH: 'Dassault Falcon 2000',
  FA50: 'Dassault Falcon 50', GLF5: 'Gulfstream G550', GLF6: 'Gulfstream G650',
  BE20: 'Beechcraft King Air 200', BE40: 'Beechjet 400', DH8A: 'De Havilland Dash 8-100',
  DH8B: 'De Havilland Dash 8-200', DH8C: 'De Havilland Dash 8-300',
  DH8D: 'De Havilland Dash 8-400', SF50: 'Cirrus SF50', TBM7: 'TBM-700',
  TBM8: 'TBM-850', TBM9: 'TBM-900', MU2: 'Mitsubishi MU-2', S22T: 'Cirrus SR22',
  A139: 'AgustaWestland AW139', EC35: 'Airbus H135', EC45: 'Airbus H145',
  R44: 'Robinson R44', R22: 'Robinson R22', S76: 'Sikorsky S-76', S92: 'Sikorsky S-92',
  AS32: 'Airbus H215', B06: 'Bell 206', B429: 'Bell 429', P180: 'Piaggio P.180',
  C130: 'Lockheed C-130 Hercules', C17: 'Boeing C-17 Globemaster III',
  C5M: 'Lockheed C-5M Galaxy', KC35: 'Boeing KC-135 Stratotanker',
  KC46: 'Boeing KC-46 Pegasus', E3TF: 'Boeing E-3 Sentry (AWACS)',
  E6B: 'Boeing E-6 Mercury', P8: 'Boeing P-8 Poseidon', P3: 'Lockheed P-3 Orion',
  A400: 'Airbus A400M Atlas', K35R: 'Boeing KC-135R', V22: 'Bell Boeing V-22 Osprey',
  GLID: 'Glider', BALL: 'Balloon', UH60: 'Sikorsky UH-60 Black Hawk',
  H60: 'Sikorsky H-60', A10: 'Fairchild A-10 Thunderbolt II', F15: 'McDonnell Douglas F-15 Eagle',
  F16: 'General Dynamics F-16 Fighting Falcon', F18: 'McDonnell Douglas F/A-18 Hornet',
  F35: 'Lockheed Martin F-35 Lightning II', FA18: 'F/A-18 Super Hornet',
  T33: 'Lockheed T-33', T38: 'Northrop T-38 Talon', T6: 'Beechcraft T-6 Texan II',
  HAWK: 'BAE Systems Hawk', E2: 'Northrop Grumman E-2 Hawkeye',
};

/** Registration number that OpenSky itself does not provide but hexdb/adsb.lol do. */
export function modelOf(meta) {
  if (!meta) return null;
  if (meta.model) return meta.model;
  if (meta.typeCode) return TYPES[meta.typeCode] || meta.typeCode;
  return null;
}
