/* ══════════════════════════════════════════════════════════════
   STATIC DATA — curated zones, prefixes, geo centroids, TLE fallback
   ══════════════════════════════════════════════════════════════ */

/* ── conflict zones (static OSINT baseline) ── */
export const CF_ZONES = [
  { lat: 48.5, lon: 33.0, n: 'Ukraine Eastern Front',  cc: 'UA/RU', l: 'CRITICAL' },
  { lat: 50.0, lon: 36.5, n: 'Kharkiv Region',          cc: 'UA',    l: 'HIGH'     },
  { lat: 31.3, lon: 34.5, n: 'Gaza Strip',              cc: 'IL/PS', l: 'CRITICAL' },
  { lat: 31.9, lon: 35.2, n: 'West Bank',               cc: 'IL/PS', l: 'HIGH'     },
  { lat: 33.5, lon: 36.3, n: 'Syria Active Zones',      cc: 'SY',    l: 'HIGH'     },
  { lat: 15.0, lon: 39.5, n: 'Horn of Africa',          cc: 'ET/ER', l: 'HIGH'     },
  { lat: 15.6, lon: 32.5, n: 'Sudan — Khartoum',        cc: 'SD',    l: 'CRITICAL' },
  { lat: 13.5, lon: 23.5, n: 'Sudan — Darfur',          cc: 'SD',    l: 'CRITICAL' },
  { lat: 14.5, lon: 44.0, n: 'Yemen Conflict',          cc: 'YE',    l: 'HIGH'     },
  { lat: 16.0, lon: -3.5, n: 'Mali Sahel',              cc: 'ML',    l: 'MEDIUM'   },
  { lat: 13.0, lon: 14.5, n: 'Lake Chad Basin',         cc: 'NG/CM', l: 'MEDIUM'   },
  { lat: 21.5, lon: 96.5, n: 'Myanmar Civil War',       cc: 'MM',    l: 'HIGH'     },
  { lat: -4.5, lon: 28.5, n: 'DRC East',                cc: 'CD',    l: 'HIGH'     },
  { lat: 35.0, lon: 47.5, n: 'Iraq — Kurdistan',        cc: 'IQ',    l: 'MEDIUM'   },
  { lat: 32.0, lon: 53.0, n: 'Iran Post-Op Monitor',    cc: 'IR',    l: 'MONITOR'  },
  { lat: 34.5, lon: 69.2, n: 'Afghanistan',             cc: 'AF',    l: 'HIGH'     },
  { lat: 5.0,  lon: 31.5, n: 'South Sudan',             cc: 'SS',    l: 'HIGH'     },
];
export const CF_COLOR = { CRITICAL: '#ff0033', HIGH: '#ff4466', MEDIUM: '#ff8800', MONITOR: '#ffdd00' };
export const CF_SIZE  = { CRITICAL: 13, HIGH: 9, MEDIUM: 7, MONITOR: 5 };

/* ── maritime zones (static) ── */
export const SH_ZONES = [
  { lat: 27.5, lon: 56.5,  n: 'Strait of Hormuz',       v: 220, r: 'ELEVATED' },
  { lat: 12.5, lon: 43.5,  n: 'Bab el-Mandeb',          v: 85,  r: 'HIGH'     },
  { lat: 1.2,  lon: 103.8, n: 'Strait of Malacca',       v: 380, r: 'NORMAL'   },
  { lat: 51.5, lon: 1.2,   n: 'English Channel',         v: 290, r: 'NORMAL'   },
  { lat: 31.0, lon: 32.5,  n: 'Suez Canal',             v: 62,  r: 'NORMAL'   },
  { lat: 9.0,  lon: -79.5, n: 'Panama Canal',            v: 48,  r: 'NORMAL'   },
  { lat: 35.5, lon: 5.4,   n: 'Strait of Gibraltar',    v: 175, r: 'NORMAL'   },
  { lat: 22.0, lon: 114.2, n: 'South China Sea',         v: 320, r: 'ELEVATED' },
  { lat: 39.0, lon: 140.0, n: 'Sea of Japan',            v: 190, r: 'MONITOR'  },
  { lat: 43.0, lon: 32.0,  n: 'Black Sea',              v: 35,  r: 'ELEVATED' },
  { lat: 35.0, lon: 18.0,  n: 'Central Mediterranean',  v: 125, r: 'NORMAL'   },
  { lat: 14.0, lon: 43.0,  n: 'Red Sea — Northern',     v: 68,  r: 'HIGH'     },
  { lat: 60.0, lon: 4.5,   n: 'Norwegian Sea',           v: 42,  r: 'NORMAL'   },
  { lat: 37.0, lon: 23.5,  n: 'Aegean Sea',             v: 145, r: 'MONITOR'  },
];
export const SH_COLOR = { HIGH: '#ff2244', ELEVATED: '#ff8800', MONITOR: '#ffdd00', NORMAL: '#00eeff' };

/* ── military aircraft detection ── */
export const MIL_PFX = ['RCH', 'LAGR', 'JAKE', 'REACH', 'SPAR', 'SAM', 'VENUS', 'IRON', 'KING',
  'GHOST', 'ATLAS', 'COBRA', 'EAGLE', 'HAWK', 'BARON', 'BOXER', 'BISON', 'DUKE', 'NAVY',
  'ARMY', 'USAF', 'USCG', 'EVAC', 'MEDEVAC', 'ROMEO', 'BLADE', 'SWORD', 'FURY'];
export const MIL_HEX_PFX = ['AE', '43', '3E', '4B', '3C0', '35'];

export function isMil(cs, icao) {
  if (!cs && !icao) return false;
  cs = (cs || '').toUpperCase().trim();
  icao = (icao || '').toUpperCase().trim();
  return MIL_PFX.some(p => cs.startsWith(p)) || MIL_HEX_PFX.some(p => icao.startsWith(p));
}

/* ── country centroids (Feodo IPs carry a 2-letter country) ── */
export const CC_MAP = {
  US: [37, -95], CN: [35, 105], RU: [60, 100], DE: [51, 10], GB: [54, -2],
  FR: [46, 2], NL: [52, 5], UA: [49, 32], IR: [32, 53], TR: [39, 35],
  BR: [10, -55], IN: [20, 78], JP: [36, 138], KR: [36, 128], AU: [-25, 133],
  PL: [52, 20], IT: [42, 12], ES: [40, -3], BE: [50, 4], CA: [56, -106],
  NG: [10, 8], EG: [26, 30], SA: [24, 45], IL: [31, 35], PK: [30, 70],
  ID: [-5, 120], VN: [16, 108], XX: [20, 0], RO: [46, 25], HU: [47, 19],
  CZ: [50, 15], SG: [1.3, 103.8], HK: [22.3, 114.2], TW: [23.6, 121],
  SE: [62, 16], CH: [47, 8], AT: [47, 14], DK: [56, 10], FI: [64, 26],
  NO: [64, 10], PT: [39, -8], GR: [39, 22], ZA: [-30, 25], MX: [23, -102],
  AR: [-34, -64], TH: [15, 101], MY: [4, 109], PH: [13, 122], BD: [23, 90],
};

/* ── flight-simulation seed data ── */
export const AIRPORTS = [
  ['JFK', 40.64, -73.78], ['LAX', 33.94, -118.41], ['LHR', 51.47, -0.46], ['DXB', 25.25, 55.36],
  ['HND', 35.55, 139.78], ['ORD', 41.98, -87.90], ['CDG', 49.01, 2.55], ['FRA', 50.03, 8.57],
  ['SIN', 1.35, 103.99], ['AMS', 52.31, 4.77], ['MEX', 19.44, -99.07], ['DEL', 28.57, 77.10],
  ['MIA', 25.79, -80.29], ['SFO', 37.62, -122.38], ['SYD', -33.95, 151.18], ['PEK', 40.08, 116.58],
  ['CAN', 23.39, 113.31], ['BOM', 19.09, 72.87], ['IST', 40.90, 29.33], ['GRU', -23.43, -46.47],
  ['JNB', -26.13, 28.24], ['NBO', -1.31, 36.83], ['BKK', 13.69, 100.75],
];
export const AIRLINES = ['UA', 'DL', 'AA', 'BA', 'AF', 'LH', 'QR', 'EK', 'SQ', 'CX',
  'JL', 'KE', 'ET', 'MS', 'SA', 'SU', 'TK', 'QF', 'CA', 'MU', 'CZ', 'AI'];
export const MIL_CALLS = ['RCH', 'LAGR', 'JAKE', 'REACH', 'SPAR', 'SAM', 'VENUS', 'IRON',
  'KING', 'GHOST', 'ATLAS', 'COBRA'];

/* ── fallback TLEs (used only if CelesTrak is unreachable) ── */
export const FB_TLES = [
  ['ISS (ZARYA)',  '1 25544U 98067A   25120.50000000  .00020000  00000-0  36000-3 0  9992', '2 25544  51.6400 100.0000 0001000 100.0000 260.0000 15.49900000495000'],
  ['NOAA 20',     '1 43013U 17073A   25120.50000000  .00000030  00000-0  28000-4 0  9991', '2 43013  98.7400 120.0000 0001000 000.0000 360.0000 14.19500000323000'],
  ['SENTINEL-2A', '1 40697U 15028A   25120.50000000  .00000010  00000-0  10000-4 0  9993', '2 40697  98.5700  80.0000 0001000 050.0000 310.0000 14.30800000462000'],
  ['LANDSAT 9',   '1 49260U 21088A   25120.50000000  .00000010  00000-0  10000-4 0  9994', '2 49260  98.2200  60.0000 0001000 040.0000 320.0000 14.57300000131000'],
  ['GOES-16',     '1 41866U 16071A   25120.50000000 -.00000261  00000-0  00000+0 0  9991', '2 41866   0.0200 270.0000 0001000 090.0000 000.0000  1.00270000 26001'],
  ['GOES-18',     '1 54267U 22021A   25120.50000000 -.00000270  00000-0  00000+0 0  9992', '2 54267   0.0200 224.0000 0001000 090.0000 000.0000  1.00270000 16002'],
];

/* ── fallback cyber IOCs (shown when Feodo is unreachable) ── */
export const FB_CYBERS = [
  { ip_address: '162.243.103.246', malware: 'Emotet',       country: 'US', as_name: 'DigitalOcean', status: 'offline' },
  { ip_address: '185.220.101.45',  malware: 'Heodo',        country: 'DE', as_name: 'Tor Exit',     status: 'online'  },
  { ip_address: '194.165.16.78',   malware: 'QakBot',       country: 'NL', as_name: 'Hosting',      status: 'online'  },
  { ip_address: '45.153.160.140',  malware: 'IcedID',       country: 'NL', as_name: 'Unknown',      status: 'online'  },
  { ip_address: '91.92.251.103',   malware: 'CobaltStrike', country: 'RU', as_name: 'Cloud',        status: 'online'  },
  { ip_address: '103.75.32.201',   malware: 'AsyncRAT',     country: 'CN', as_name: 'DC',           status: 'online'  },
  { ip_address: '198.54.117.200',  malware: 'Dridex',       country: 'US', as_name: 'Hosting',      status: 'online'  },
  { ip_address: '5.252.177.202',   malware: 'Trickbot',     country: 'RU', as_name: 'Unknown',      status: 'online'  },
];
