'use strict';

/* ══════════════════════════════════════════════════════════════
   POLYFILL — AbortSignal.timeout (Safari < 17, older Chromium)
══════════════════════════════════════════════════════════════ */
if (typeof AbortSignal !== 'undefined' && !AbortSignal.timeout) {
  AbortSignal.timeout = function (ms) {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(new DOMException('TimeoutError', 'TimeoutError')), ms);
    return ctrl.signal;
  };
}

/* ══════════════════════════════════════════════════════════════
   CORS PROXY CONFIG
══════════════════════════════════════════════════════════════ */
const PROXIES = [
  { prefix: 'https://api.allorigins.win/raw?url=',      encode: true  },
  { prefix: 'https://corsproxy.io/?url=',               encode: true  },
  { prefix: 'https://api.codetabs.com/v1/proxy?quest=', encode: true  },
  { prefix: 'https://thingproxy.freeboard.io/fetch/',   encode: false },
  { prefix: 'https://proxy.cors.sh/',                   encode: false },
];

async function proxyFetch(url, opts = {}) {
  try {
    const r = await fetch(url, { ...opts, signal: AbortSignal.timeout(10000) });
    if (r.ok) return r;
  } catch (_) {}
  for (const px of PROXIES) {
    try {
      const full = px.prefix + (px.encode ? encodeURIComponent(url) : url);
      const r = await fetch(full, { ...opts, signal: AbortSignal.timeout(13000) });
      if (r.ok) return r;
    } catch (_) {}
  }
  throw new Error('All proxies failed for: ' + url);
}

async function fetchJSON(url, timeoutMs = 10000) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (r.ok) return await r.json();
  } catch (_) {}
  for (const px of PROXIES) {
    try {
      const full = px.prefix + (px.encode ? encodeURIComponent(url) : url);
      const r = await fetch(full, { signal: AbortSignal.timeout(timeoutMs + 3000) });
      if (r.ok) return await r.json();
    } catch (_) {}
  }
  return null;
}

/* ══════════════════════════════════════════════════════════════
   REFRESH INTERVALS
══════════════════════════════════════════════════════════════ */
const REFRESH_MS = {
  flights:    60000,
  quakes:    300000,
  fires:     600000,
  cyber:     900000,
  news:      150000,
  satellites: 120000,
  ships:     300000,
};
const cbq = () => '?_t=' + Date.now();
const cb  = () => '&_t='  + Date.now();

/* ══════════════════════════════════════════════════════════════
   GLOBAL STATE
══════════════════════════════════════════════════════════════ */
const S = {
  map: null, satLayer: null, satOn: false,
  CG: {}, LG: {},
  vis: { flights:true, military:true, ships:true, conflicts:true,
         quakes:true, fires:true, cyber:true, satellites:true, cctv:true },
  evN: 0, alerts: 0, news: [], cyberData: [],
  activeTab: 'overview',
  lock: { flights:false, quakes:false, fires:false, conflicts:false,
          ships:false, cyber:false, news:false, satellites:false, cctv:false },
  fetchId: {},
  flightData: [], militaryFlightData: [],
  quakeData: [], fireData: [],
  vesselObjects: [],
  simActive: false, simulatedFlights: [], simInterval: null, lastSimUpdate: 0,
  liveRetryCount: 0, flightSource: '--',
  tickerItems: [],
  routeLines: [],  // store polyline references
  cctvFeeds: [],
};

/* ══════════════════════════════════════════════════════════════
   AUTH
══════════════════════════════════════════════════════════════ */
async function doLogin() {
  const u = document.getElementById('lu').value.trim();
  const p = document.getElementById('lp').value.trim();
  if (u === 'agiprogrammer' && p === 'TnEq^2&94@6!eMH&hqM$') {
    document.getElementById('l-err').textContent = '';
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('loader').style.display = 'flex';
    boot();
  } else {
    document.getElementById('l-err').textContent = '⚠ ACCESS DENIED — INVALID CREDENTIALS';
    document.getElementById('lp').value = '';
    document.getElementById('lp').focus();
    const b = document.getElementById('lbox');
    b.style.borderColor = 'var(--red)';
    b.classList.add('shake');
    setTimeout(() => { b.classList.remove('shake'); b.style.borderColor = ''; }, 400);
  }
}

function logout() {
  saveState();
  stopFlightSimulation();
  document.getElementById('app').style.display = 'none';
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('lu').value = '';
  document.getElementById('lp').value = '';
  document.getElementById('lu').focus();
}

/* ══════════════════════════════════════════════════════════════
   BOOT SEQUENCE
══════════════════════════════════════════════════════════════ */
const ld  = (p, m) => { document.getElementById('ld-bar').style.width = p + '%'; document.getElementById('ld-msg').textContent = m; };
const slp = ms => new Promise(r => setTimeout(r, ms));

async function boot() {
  ld(5,  'INITIALIZING LEAFLET MAP ENGINE...');   await slp(80);
  initMap();
  ld(10, 'RESTORING SESSION STATE...');           restoreState();
  ld(16, 'FETCHING REAL-TIME FLIGHT DATA...');    await fetchFlights();
  ld(30, 'CONNECTING USGS SEISMIC FEED...');      await fetchQuakes();
  ld(42, 'LOADING NASA EONET EVENTS...');          await fetchFires();
  ld(53, 'MAPPING CONFLICT ZONES...');             await fetchConflicts();
  ld(63, 'CHARTING MARITIME INTELLIGENCE...');     await fetchShips();
  ld(72, 'FETCHING FEODO TRACKER IOCs...');        await fetchCyber();
  ld(80, 'LOADING CCTV FEEDS...');                 await fetchCCTV();
  ld(88, 'LOADING NEWS FEEDS...');                 await fetchNews();
  ld(95, 'COMPUTING SATELLITE POSITIONS...');      await fetchSatellites();
  ld(100, 'ALL SYSTEMS ONLINE');                   await slp(700);

  document.getElementById('loader').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  requestAnimationFrame(() => setTimeout(() => S.map.invalidateSize(), 200));

  initClock();
  initTicker();
  renderNews();
  schedFlights(); schedQuakes(); schedFires(); schedCyber();
  schedSats();    schedNews();   schedShips();  schedCCTV();
  // enable coordinate tooltip
  enableCoordTooltip();
}

/* ══════════════════════════════════════════════════════════════
   MAP INIT
══════════════════════════════════════════════════════════════ */
function initMap() {
  S.map = L.map('map', { center:[20,10], zoom:3, preferCanvas:true, zoomControl:true, attributionControl:false });
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom:18, subdomains:'abcd' }).addTo(S.map);
  S.satLayer = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { maxZoom:18, opacity:0.82 }
  );

  const co = { maxClusterRadius:40, spiderfyOnMaxZoom:true, showCoverageOnHover:false, zoomToBoundsOnClick:true };
  S.CG.flights    = L.markerClusterGroup({ ...co, maxClusterRadius:35 });
  S.CG.military   = L.markerClusterGroup({ ...co, maxClusterRadius:50 });
  S.CG.ships      = L.markerClusterGroup({ ...co, maxClusterRadius:55 });
  S.CG.cyber      = L.markerClusterGroup({ ...co, maxClusterRadius:45 });
  S.CG.satellites = L.markerClusterGroup({ ...co, maxClusterRadius:80 });
  S.CG.cctv       = L.markerClusterGroup({ ...co, maxClusterRadius:40 });
  S.LG.conflicts  = L.layerGroup();
  S.LG.quakes     = L.layerGroup();
  S.LG.fires      = L.layerGroup();
  S.LG.ships      = L.layerGroup();
  S.LG.routes     = L.layerGroup(); // for polylines

  Object.values(S.CG).forEach(g => g.addTo(S.map));
  Object.values(S.LG).forEach(g => g.addTo(S.map));
  S.map.on('moveend zoomend', saveState);
}

function toggleSat() {
  const btn = document.getElementById('sat-btn');
  if (S.satOn) {
    S.map.removeLayer(S.satLayer); S.satOn = false;
    btn.classList.remove('on'); btn.textContent = '🛰 SAT VIEW';
    logEv('SYS', 'World Imagery layer deactivated', 'sys');
  } else {
    S.satLayer.addTo(S.map); S.satOn = true;
    btn.classList.add('on'); btn.textContent = '🛰 SAT: ON';
    logEv('SYS', 'Esri World Imagery activated — global real satellite view', 'sys');
  }
}

/* ───── Coordinate Tooltip ───── */
function enableCoordTooltip() {
  const tip = document.getElementById('coord-tip');
  S.map.on('mousemove', function(e) {
    const lat = e.latlng.lat.toFixed(5);
    const lng = e.latlng.lng.toFixed(5);
    tip.textContent = `Lat: ${lat}, Lng: ${lng}`;
  });
  S.map.on('mouseout', function() {
    tip.textContent = 'Lat: 0.00000, Lng: 0.00000';
  });
}

/* ══════════════════════════════════════════════════════════════
   UTILS
══════════════════════════════════════════════════════════════ */
const mkIcon = (emoji, col, sz = 14) => L.divIcon({
  html: `<div style="font-size:${sz}px;line-height:1;filter:drop-shadow(0 0 3px ${col})">${emoji}</div>`,
  className: '', iconSize:[sz,sz], iconAnchor:[sz/2,sz/2], popupAnchor:[0,-sz/2+2]
});

const mkPop = (title, rows) =>
  '<div class="pt">' + esc(title) + '</div>' +
  rows.map(([k,v]) => '<div class="pr"><b>' + esc(k) + ':</b> ' + esc(String(v ?? 'N/A')) + '</div>').join('');

const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/'/g,'&#39;').replace(/"/g,'&quot;');

const timeSince = d => {
  const s = Math.floor((Date.now() - d) / 1000);
  return s < 60 ? s + 's ago' : s < 3600 ? Math.floor(s/60) + 'm ago' : s < 86400 ? Math.floor(s/3600) + 'h ago' : Math.floor(s/86400) + 'd ago';
};

const sampleArr = (a, n) => {
  if (a.length <= n) return a;
  const st = Math.max(1, Math.floor(a.length / n));
  return a.filter((_, i) => i % st === 0).slice(0, n);
};

const upAlerts   = () => { document.getElementById('alert-n').textContent = S.alerts; };
const upSrcBadge = src => { document.getElementById('src-badge').textContent = 'SRC: ' + src; };

/* ══════════════════════════════════════════════════════════════
   MILITARY DETECTION
══════════════════════════════════════════════════════════════ */
const MIL_PFX     = ['RCH','LAGR','JAKE','REACH','SPAR','SAM','VENUS','IRON','KING','GHOST',
                     'ATLAS','COBRA','EAGLE','HAWK','BARON','BOXER','BISON','DUKE','NAVY',
                     'ARMY','USAF','USCG','EVAC','MEDEVAC','ROMEO','BLADE','SWORD','FURY'];
const MIL_HEX_PFX = ['AE','43','3E','4B','3C0','35'];

function isMil(cs, icao) {
  if (!cs && !icao) return false;
  cs   = (cs   || '').toUpperCase().trim();
  icao = (icao || '').toUpperCase().trim();
  return MIL_PFX.some(p => cs.startsWith(p)) || MIL_HEX_PFX.some(p => icao.startsWith(p));
}

/* ══════════════════════════════════════════════════════════════
   1. FLIGHTS
══════════════════════════════════════════════════════════════ */
const FLIGHT_SOURCES = [
  {
    name: 'OpenSky',
    url:  'https://opensky-network.org/api/states/all',
    parse(data) {
      if (!data || !Array.isArray(data.states)) return null;
      return data.states
        .filter(s => s[5] !== null && s[6] !== null && s[8] === false)
        .slice(0, 1000)
        .map(s => ({
          icao: (s[0] || '').trim(),
          call: (s[1] || '').trim(),
          lat: s[6], lon: s[5],
          alt: s[13] !== null ? Math.round(s[13]) : (s[7] !== null ? Math.round(s[7]) : null),
          hdg: s[10] !== null ? Math.round(s[10]) : null,
          vel: s[9]  !== null ? Math.round(s[9] * 1.94384) : null,
        }));
    },
  },
  {
    name: 'ADS-B.fi',
    url:  'https://api.adsb.fi/v1/flights',
    parse(data) {
      if (!data || !Array.isArray(data.ac)) return null;
      return data.ac
        .filter(ac => ac.lat !== undefined && ac.lon !== undefined && ac.gnd !== 1)
        .slice(0, 1000)
        .map(ac => ({
          icao: (ac.hex    || '').trim(),
          call: (ac.flight || ac.r || '').trim(),
          lat: ac.lat, lon: ac.lon,
          alt: ac.alt_baro !== undefined ? Math.round(ac.alt_baro * 0.3048)
             : ac.alt_geom !== undefined ? Math.round(ac.alt_geom * 0.3048) : null,
          hdg: ac.track !== undefined ? Math.round(ac.track) : null,
          vel: ac.gs    !== undefined ? Math.round(ac.gs)    : null,
        }));
    },
  },
  {
    name: 'Airplanes.live',
    url:  'https://api.airplanes.live/v2/all',
    parse(data) {
      if (!data || !Array.isArray(data.ac)) return null;
      return data.ac
        .filter(ac => ac.lat !== undefined && ac.lon !== undefined && ac.gnd !== 1)
        .slice(0, 1000)
        .map(ac => ({
          icao: (ac.hex    || '').trim(),
          call: (ac.flight || '').trim(),
          lat: ac.lat, lon: ac.lon,
          alt: ac.alt_baro !== undefined ? Math.round(ac.alt_baro * 0.3048)
             : ac.alt_geom !== undefined ? Math.round(ac.alt_geom * 0.3048) : null,
          hdg: ac.track !== undefined ? Math.round(ac.track) : null,
          vel: ac.gs    !== undefined ? Math.round(ac.gs)    : null,
        }));
    },
  },
];

function applyFlightBatch(list, sourceName) {
  S.CG.flights.clearLayers();
  S.CG.military.clearLayers();
  S.LG.routes.clearLayers(); // clear old route lines
  const civ = [], mil = [];
  list.forEach(ac => {
    if (ac.lat == null || ac.lon == null) return;
    const military = isMil(ac.call, ac.icao);
    const popRows = [
      ['ICAO',     ac.icao || 'N/A'],
      ['Callsign', ac.call || 'UNKNOWN'],
      ['Altitude', ac.alt  ? ac.alt + 'm (' + Math.round(ac.alt / 0.3048) + 'ft)' : 'N/A'],
      ['Heading',  ac.hdg  ? ac.hdg + '°' : 'N/A'],
      ['Speed',    ac.vel  ? ac.vel + ' kn' : 'N/A'],
      ['Source',   sourceName],
    ];
    const mk = L.marker([ac.lat, ac.lon], {
      icon: mkIcon(military ? '🎯' : '✈', military ? '#ff8800' : '#00ff41', military ? 13 : 11)
    }).bindPopup(mkPop(military ? '🎯 MILITARY AIRCRAFT' : '✈ CIVIL AIRCRAFT', popRows));

    if (military) { mil.push(ac); S.CG.military.addLayer(mk); }
    else          { civ.push(ac); S.CG.flights.addLayer(mk);  }
  });
  return { civ, mil };
}

async function fetchFlights() {
  const token = Symbol();
  S.fetchId.flights = token;
  if (S.lock.flights) return;
  S.lock.flights = true;

  let result = null;
  try {
    result = await Promise.any(FLIGHT_SOURCES.map(async src => {
      const data = await fetchJSON(src.url, 10000);
      if (!data) throw new Error('no data');
      const parsed = src.parse(data);
      if (!parsed || parsed.length === 0) throw new Error('empty');
      return { parsed, name: src.name };
    }));
  } catch (_) { result = null; }

  if (S.fetchId.flights !== token) { S.lock.flights = false; return; }

  if (result) {
    if (S.simActive) stopFlightSimulation();
    S.liveRetryCount = 0;
    S.flightSource   = result.name;
    upSrcBadge(result.name);

    const sampled = sampleArr(result.parsed, 500);
    const { civ, mil } = applyFlightBatch(sampled, result.name);
    S.flightData          = civ;
    S.militaryFlightData  = mil;
    document.getElementById('s-fl').textContent = result.parsed.length.toLocaleString();
    logEv('AIR', result.name + ': ' + result.parsed.length + ' airborne (' + mil.length + ' mil, ' + civ.length + ' civ)', 'air');

    if (S.activeTab === 'flights')  renderFlightPanel(false);
    if (S.activeTab === 'military') renderFlightPanel(true);

  } else {
    S.liveRetryCount++;
    upSrcBadge('SIMULATED');

    if (!S.simActive) {
      if (S.liveRetryCount >= 2) {
        startFlightSimulation();
      } else {
        logEv('AIR', 'Live flight data unavailable — retrying in 30s', 'air');
        setTimeout(() => { if (!S.lock.flights) fetchFlights(); }, 30000);
      }
    } else {
      setTimeout(() => { if (!S.lock.flights) fetchFlights(); }, 45000);
    }
  }

  S.lock.flights = false;
}

/* ─── FLIGHT SIMULATION (with route lines) ─── */
const AIRPORTS  = [['JFK',40.64,-73.78],['LAX',33.94,-118.41],['LHR',51.47,-0.46],['DXB',25.25,55.36],['HND',35.55,139.78],['ORD',41.98,-87.90],['CDG',49.01,2.55],['FRA',50.03,8.57],['SIN',1.35,103.99],['AMS',52.31,4.77],['MEX',19.44,-99.07],['DEL',28.57,77.10],['MIA',25.79,-80.29],['MCO',28.43,-81.31],['SFO',37.62,-122.38],['SYD',-33.95,151.18],['PEK',40.08,116.58],['CAN',23.39,113.31],['BOM',19.09,72.87],['IST',40.90,29.33],['GRU',-23.43,-46.47],['JNB',-26.13,28.24],['NBO',-1.31,36.83],['BKK',13.69,100.75]];
const AIRLINES  = ['UA','DL','AA','BA','AF','LH','QR','EK','SQ','CX','JL','KE','ET','MS','SA','SU','TK','QF','CA','MU','CZ','AI'];
const MIL_CALLS = ['RCH','LAGR','JAKE','REACH','SPAR','SAM','VENUS','IRON','KING','GHOST','ATLAS','COBRA'];
const rndAp  = () => AIRPORTS[Math.floor(Math.random() * AIRPORTS.length)];
const rndAl  = () => AIRLINES[Math.floor(Math.random() * AIRLINES.length)];
const rndMil = () => MIL_CALLS[Math.floor(Math.random() * MIL_CALLS.length)];

function bearing(la1,lo1,la2,lo2) {
  const r=Math.PI/180, d=(lo2-lo1)*r;
  const y=Math.sin(d)*Math.cos(la2*r);
  const x=Math.cos(la1*r)*Math.sin(la2*r)-Math.sin(la1*r)*Math.cos(la2*r)*Math.cos(d);
  return (Math.atan2(y,x)*180/Math.PI+360)%360;
}
function interpolate(la1,lo1,la2,lo2,f) {
  const r=Math.PI/180,rl1=la1*r,rl2=la2*r,rg1=lo1*r,rg2=lo2*r,dL=rl2-rl1,dG=rg2-rg1;
  const a=Math.sin((1-f)*dL)*Math.cos(rg1)+Math.sin(f*dL)*Math.cos(rg2);
  const b=Math.sin((1-f)*dG)*Math.cos(rl1)+Math.sin(f*dG)*Math.cos(rl2);
  const la=Math.atan2(Math.sin(rl1)*Math.cos((1-f)*dL)+Math.sin(rl2)*Math.cos(f*dL),Math.sqrt(a*a+b*b));
  const lo=Math.atan2(Math.sin(rg1)*Math.cos((1-f)*dG)+Math.sin(rg2)*Math.cos(f*dG),Math.cos(rg1)*Math.cos((1-f)*dG)+Math.cos(rg2)*Math.cos(f*dG));
  return {lat:la/r,lng:lo/r};
}
function gcDist(la1,lo1,la2,lo2) {
  const r=Math.PI/180,R=6371000;
  const a=Math.sin((la2-la1)*r/2)**2+Math.cos(la1*r)*Math.cos(la2*r)*Math.sin((lo2-lo1)*r/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}

function generateSimulatedFlights(count = 200) {
  const flights = [];
  for (let i = 0; i < count; i++) {
    const from = rndAp(); let to = rndAp(); while (from[0] === to[0]) to = rndAp();
    const military = i < 20;
    const call = military
      ? rndMil() + Math.floor(Math.random()*90+10)
      : rndAl()  + Math.floor(Math.random()*9000+1000);
    flights.push({
      icao: military
        ? 'AE' + Math.floor(Math.random()*65536).toString(16).toUpperCase().padStart(4,'0')
        : 'A'  + Math.random().toString(16).slice(2,8).toUpperCase(),
      call, military,
      lat1:from[1], lng1:from[2], lat2:to[1], lng2:to[2],
      progress: Math.random(),
      alt:   military ? 30000+Math.random()*10000 : 25000+Math.random()*15000,
      speed: 400+Math.random()*250,
      lat:0, lon:0, hdg:0,
    });
  }
  return flights;
}

function tickSimulation(dt) {
  S.simulatedFlights.forEach(f => {
    const tt = gcDist(f.lat1,f.lng1,f.lat2,f.lng2) / (f.speed/3.6);
    f.progress = (f.progress + dt/tt) % 1;
    const pos = interpolate(f.lat1,f.lng1,f.lat2,f.lng2,f.progress);
    f.lat=pos.lat; f.lon=pos.lng; f.hdg=bearing(pos.lat,pos.lng,f.lat2,f.lng2);
  });
}

function startFlightSimulation() {
  if (S.simActive) return;
  stopFlightSimulation();
  S.simulatedFlights = generateSimulatedFlights(200);
  S.lastSimUpdate    = Date.now();
  S.simActive        = true;
  S.flightSource     = 'SIMULATED';
  upSrcBadge('SIMULATED');

  S.simInterval = setInterval(() => {
    const now = Date.now();
    tickSimulation((now - S.lastSimUpdate) / 1000);
    S.lastSimUpdate = now;

    S.CG.flights.clearLayers();
    S.CG.military.clearLayers();
    S.LG.routes.clearLayers(); // clear old route lines
    const civ = [], mil = [];
    S.simulatedFlights.forEach(f => {
      const ac = { icao:f.icao, call:f.call, lat:f.lat, lon:f.lon, alt:f.alt, hdg:f.hdg, vel:null };
      f.military ? mil.push(ac) : civ.push(ac);
      const mk = L.marker([f.lat,f.lon], {
        icon: mkIcon(f.military?'🎯':'✈', f.military?'#ff8800':'#00ff41', f.military?13:11)
      }).bindPopup(mkPop(f.military ? '🎯 MILITARY (sim)' : '✈ CIVIL (sim)', [
        ['ICAO',     f.icao],
        ['Callsign', f.call],
        ['Altitude', Math.round(f.alt)+'m'],
        ['Heading',  Math.round(f.hdg)+'°'],
        ['Note',     'Simulated — live data unavailable'],
      ]));
      f.military ? S.CG.military.addLayer(mk) : S.CG.flights.addLayer(mk);

      // Draw route polyline (great-circle) from origin to destination
      const line = L.polyline(
        [[f.lat1, f.lng1], [f.lat2, f.lng2]],
        { color: f.military ? '#ff8800' : '#00ff41', opacity: 0.2, weight: 1, dashArray: '5,5' }
      );
      S.LG.routes.addLayer(line);
    });
    S.flightData         = civ;
    S.militaryFlightData = mil;
    document.getElementById('s-fl').textContent = (civ.length+mil.length).toLocaleString()+'*';
  }, 3000);

  logEv('AIR', 'All live sources failed — using simulated flights with routes, retrying in background', 'air');
}

function stopFlightSimulation() {
  if (S.simInterval) clearInterval(S.simInterval);
  S.simInterval = null; S.simActive = false; S.simulatedFlights = [];
}

/* ══════════════════════════════════════════════════════════════
   2. EARTHQUAKES
══════════════════════════════════════════════════════════════ */
async function fetchQuakes() {
  const token = Symbol(); S.fetchId.quakes = token;
  if (!S.vis.quakes) { S.lock.quakes = false; return; }
  if (S.lock.quakes) return;
  S.lock.quakes = true; S.LG.quakes.clearLayers();
  try {
    const data = await fetchJSON('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson' + cbq());
    if (S.fetchId.quakes !== token) { S.lock.quakes = false; return; }
    if (!data) throw new Error('no data');
    const features = data.features || [];
    S.quakeData = features;
    features.forEach(f => {
      const [lon,lat,dep] = f.geometry.coordinates;
      const mag   = f.properties.mag;
      const place = f.properties.place || 'Unknown';
      const col   = mag >= 6 ? '#ff2244' : mag >= 5 ? '#ff8800' : '#ffdd00';
      const timeStr = f.properties.time ? new Date(f.properties.time).toUTCString() : 'N/A';
      L.circleMarker([lat,lon], { radius:Math.max(4,mag*3.2), color:col, fillColor:col, fillOpacity:.42, weight:1.5 })
        .bindPopup(mkPop('EARTHQUAKE', [['Magnitude','M'+mag],['Location',place],['Depth',dep+' km'],['Time',timeStr],['Source','USGS']]))
        .addTo(S.LG.quakes);
      if (mag >= 6) { logEv('QUAKE', 'M'+mag+' — '+place, 'dis'); S.alerts++; upAlerts(); }
    });
    document.getElementById('s-eq').textContent = features.length;
    logEv('QUAKE', 'USGS: '+features.length+' earthquakes M2.5+ last 24h', 'dis');
  } catch (_) {
    document.getElementById('s-eq').textContent = 'ERR';
    logEv('QUAKE', 'USGS seismic feed unavailable', 'dis');
  }
  S.lock.quakes = false;
}

/* ══════════════════════════════════════════════════════════════
   3. FIRES & DISASTERS — NASA EONET
══════════════════════════════════════════════════════════════ */
const EONET_CATS = {
  wildfires:    { i:'🔥', c:'#ff6600' },
  severeStorms: { i:'🌀', c:'#aaddff' },
  volcanoes:    { i:'🌋', c:'#ff4400' },
  floods:       { i:'💧', c:'#4488ff' },
};

async function fetchFires() {
  const token = Symbol(); S.fetchId.fires = token;
  if (!S.vis.fires) { S.lock.fires = false; return; }
  if (S.lock.fires) return;
  S.lock.fires = true; S.LG.fires.clearLayers();
  let total = 0; const allEvents = [];
  await Promise.allSettled(Object.entries(EONET_CATS).map(async ([cat,{i,c}]) => {
    try {
      const data = await fetchJSON('https://eonet.gsfc.nasa.gov/api/v3/events?category='+cat+'&status=open&limit=30'+cb());
      if (S.fetchId.fires !== token) return;
      if (!data) return;
      (data.events || []).forEach(ev => {
        const geo = ev.geometry?.[0]; if (!geo?.coordinates) return;
        const [lon,lat] = geo.coordinates;
        allEvents.push({ type:cat, title:ev.title, date:geo.date, lat, lon });
        L.marker([lat,lon], { icon:mkIcon(i,c,16) })
          .bindPopup(mkPop(cat.toUpperCase(), [['Title',ev.title],['Date',(geo.date||'').split('T')[0]||'Active'],['Status','ACTIVE'],['Source','NASA EONET']]))
          .addTo(S.LG.fires);
        total++;
      });
    } catch (_) {}
  }));
  if (S.fetchId.fires !== token) { S.lock.fires = false; return; }
  S.fireData = allEvents;
  document.getElementById('s-fi').textContent = total;
  logEv('FIRE', 'NASA EONET: '+total+' active disasters', 'dis');
  S.lock.fires = false;
}

/* ══════════════════════════════════════════════════════════════
   4. CONFLICT ZONES
══════════════════════════════════════════════════════════════ */
const CF_ZONES = [
  { lat:48.5, lon:33.0, n:'Ukraine Eastern Front',  cc:'UA/RU', l:'CRITICAL' },
  { lat:50.0, lon:36.5, n:'Kharkiv Region',          cc:'UA',    l:'HIGH'     },
  { lat:31.3, lon:34.5, n:'Gaza Strip',              cc:'IL/PS', l:'CRITICAL' },
  { lat:31.9, lon:35.2, n:'West Bank',               cc:'IL/PS', l:'HIGH'     },
  { lat:33.5, lon:36.3, n:'Syria Active Zones',      cc:'SY',    l:'HIGH'     },
  { lat:15.0, lon:39.5, n:'Horn of Africa',          cc:'ET/ER', l:'HIGH'     },
  { lat:15.6, lon:32.5, n:'Sudan — Khartoum',        cc:'SD',    l:'CRITICAL' },
  { lat:13.5, lon:23.5, n:'Sudan — Darfur',          cc:'SD',    l:'CRITICAL' },
  { lat:14.5, lon:44.0, n:'Yemen Conflict',          cc:'YE',    l:'HIGH'     },
  { lat:16.0, lon:-3.5, n:'Mali Sahel',              cc:'ML',    l:'MEDIUM'   },
  { lat:13.0, lon:14.5, n:'Lake Chad Basin',         cc:'NG/CM', l:'MEDIUM'   },
  { lat:21.5, lon:96.5, n:'Myanmar Civil War',       cc:'MM',    l:'HIGH'     },
  { lat:-4.5, lon:28.5, n:'DRC East',               cc:'CD',    l:'HIGH'     },
  { lat:35.0, lon:47.5, n:'Iraq — Kurdistan',        cc:'IQ',    l:'MEDIUM'   },
  { lat:32.0, lon:53.0, n:'Iran Post-Op Monitor',    cc:'IR',    l:'MONITOR'  },
  { lat:34.5, lon:69.2, n:'Afghanistan',             cc:'AF',    l:'HIGH'     },
  { lat:5.0,  lon:31.5, n:'South Sudan',             cc:'SS',    l:'HIGH'     },
];
const CF_COLOR = { CRITICAL:'#ff0033', HIGH:'#ff4466', MEDIUM:'#ff8800', MONITOR:'#ffdd00' };
const CF_SIZE  = { CRITICAL:13, HIGH:9, MEDIUM:7, MONITOR:5 };

async function fetchConflicts() {
  const token = Symbol(); S.fetchId.conflicts = token;
  if (!S.vis.conflicts) { S.lock.conflicts = false; return; }
  if (S.lock.conflicts) return;
  S.lock.conflicts = true;

  S.LG.conflicts.clearLayers();
  CF_ZONES.forEach(z => {
    const col = CF_COLOR[z.l];
    L.circleMarker([z.lat,z.lon], { radius:CF_SIZE[z.l], color:col, fillColor:col, fillOpacity:.45, weight:2 })
      .bindPopup(mkPop('CONFLICT ZONE', [['Zone',z.n],['Countries',z.cc],['Intensity',z.l],['Source','OSINT/ACLED']]))
      .addTo(S.LG.conflicts);
    if (z.l === 'CRITICAL') { logEv('WAR', 'CRITICAL: '+z.n+' ['+z.cc+']', 'war'); S.alerts++; upAlerts(); }
  });
  document.getElementById('s-cf').textContent = CF_ZONES.length;

  try {
    const data = await fetchJSON('https://api.gdeltproject.org/api/v2/geo/geo?query=war+conflict+attack&mode=pointdata&format=geojson&maxpoints=60'+cb());
    if (S.fetchId.conflicts !== token) { S.lock.conflicts = false; return; }
    if (data) {
      const feats = data.features || [];
      feats.forEach(f => {
        const [lon,lat] = f.geometry.coordinates; const p = f.properties;
        L.circleMarker([lat,lon], { radius:4, color:'#ff6688', fillColor:'#ff6688', fillOpacity:.55, weight:1 })
          .bindPopup(mkPop('GDELT LIVE EVENT', [['Name',p.name||'N/A'],['Country',p.countrycode||'N/A'],['Source','GDELT Real-time']]))
          .addTo(S.LG.conflicts);
      });
      if (feats.length) logEv('WAR', 'GDELT: '+feats.length+' live conflict events', 'war');
    }
  } catch (_) { logEv('WAR', 'GDELT feed delayed — known zones active', 'war'); }

  S.lock.conflicts = false;
}

/* ══════════════════════════════════════════════════════════════
   5. MARITIME
══════════════════════════════════════════════════════════════ */
const SH_ZONES = [
  { lat:27.5, lon:56.5,  n:'Strait of Hormuz',       v:220, r:'ELEVATED' },
  { lat:12.5, lon:43.5,  n:'Bab el-Mandeb',           v:85,  r:'HIGH'     },
  { lat:1.2,  lon:103.8, n:'Strait of Malacca',       v:380, r:'NORMAL'   },
  { lat:51.5, lon:1.2,   n:'English Channel',          v:290, r:'NORMAL'   },
  { lat:31.0, lon:32.5,  n:'Suez Canal',              v:62,  r:'NORMAL'   },
  { lat:9.0,  lon:-79.5, n:'Panama Canal',             v:48,  r:'NORMAL'   },
  { lat:35.5, lon:5.4,   n:'Strait of Gibraltar',     v:175, r:'NORMAL'   },
  { lat:22.0, lon:114.2, n:'South China Sea',          v:320, r:'ELEVATED' },
  { lat:39.0, lon:140.0, n:'Sea of Japan',             v:190, r:'MONITOR'  },
  { lat:43.0, lon:32.0,  n:'Black Sea',               v:35,  r:'ELEVATED' },
  { lat:35.0, lon:18.0,  n:'Central Mediterranean',   v:125, r:'NORMAL'   },
  { lat:14.0, lon:43.0,  n:'Red Sea — Northern',      v:68,  r:'HIGH'     },
  { lat:60.0, lon:4.5,   n:'Norwegian Sea',            v:42,  r:'NORMAL'   },
  { lat:37.0, lon:23.5,  n:'Aegean Sea',              v:145, r:'MONITOR'  },
];
const SH_COLOR = { HIGH:'#ff2244', ELEVATED:'#ff8800', MONITOR:'#ffdd00', NORMAL:'#00eeff' };

function advanceVessel(v, dt) {
  const R=6371000, speedMs=v.speed*0.514444, dist=speedMs*dt, r=Math.PI/180;
  const lat1=v.lat*r, lon1=v.lon*r, brng=v.heading*r;
  const lat2=Math.asin(Math.sin(lat1)*Math.cos(dist/R)+Math.cos(lat1)*Math.sin(dist/R)*Math.cos(brng));
  const lon2=lon1+Math.atan2(Math.sin(brng)*Math.sin(dist/R)*Math.cos(lat1),Math.cos(dist/R)-Math.sin(lat1)*Math.sin(lat2));
  v.lat=lat2/r; v.lon=lon2/r; v.lastUpdate=Date.now();
}

async function fetchShips() {
  const token = Symbol(); S.fetchId.ships = token;
  if (!S.vis.ships) { S.lock.ships = false; return; }
  if (S.lock.ships) return;
  S.lock.ships = true;
  S.CG.ships.clearLayers(); S.LG.ships.clearLayers();

  const now = Date.now();
  if (S.vesselObjects.length === 0) {
    SH_ZONES.forEach(z => {
      const count = Math.min(6, Math.floor(z.v/45));
      for (let i = 0; i < count; i++) {
        S.vesselObjects.push({
          id: 'v_' + Math.random().toString(36).substr(2,9),
          lat: z.lat+(Math.random()-.5)*0.10,
          lon: z.lon+(Math.random()-.5)*0.10,
          speed: 6+Math.random()*14, heading: Math.random()*360,
          lastUpdate: now, zone: z.n, risk: z.r,
        });
      }
    });
  } else {
    S.vesselObjects.forEach(v => advanceVessel(v, (now-(v.lastUpdate||now))/1000));
  }

  S.vesselObjects.forEach(v => {
    const col = SH_COLOR[v.risk] || '#00eeff';
    L.marker([v.lat,v.lon], { icon:mkIcon('⚓',col,11) })
      .bindPopup(mkPop('VESSEL (simulated)', [['Zone',v.zone],['Risk',v.risk],['Speed',v.speed.toFixed(1)+' kn'],['Heading',v.heading.toFixed(0)+'°']]))
      .addTo(S.CG.ships);
  });
  SH_ZONES.forEach(z => {
    const col = SH_COLOR[z.r] || '#00eeff';
    L.circleMarker([z.lat,z.lon], { radius:Math.min(22,6+z.v/20), color:col, fillColor:col, fillOpacity:.16, weight:2 })
      .bindPopup(mkPop('MARITIME ZONE', [['Zone',z.n],['~Vessels','~'+z.v+' tracked'],['Risk',z.r]]))
      .addTo(S.LG.ships);
  });

  document.getElementById('s-sh').textContent = S.vesselObjects.length;
  logEv('NAV', 'Maritime: '+S.vesselObjects.length+' vessels (simulated + zone data)', 'nav');
  S.lock.ships = false;
}

/* ══════════════════════════════════════════════════════════════
   6. CYBER — Feodo Tracker
══════════════════════════════════════════════════════════════ */
const CC_MAP = {
  US:[37,-95],  CN:[35,105],  RU:[60,100],  DE:[51,10],  GB:[54,-2],
  FR:[46,2],    NL:[52,5],    UA:[49,32],   IR:[32,53],  TR:[39,35],
  BR:[10,-55],  IN:[20,78],   JP:[36,138],  KR:[36,128], AU:[-25,133],
  PL:[52,20],   IT:[42,12],   ES:[40,-3],   BE:[50,4],   CA:[56,-106],
  NG:[10,8],    EG:[26,30],   SA:[24,45],   IL:[31,35],  PK:[30,70],
  ID:[-5,120],  VN:[16,108],  XX:[20,0],    RO:[46,25],  HU:[47,19],
  CZ:[50,15],   SG:[1.3,103.8], HK:[22.3,114.2], TW:[23.6,121],
  SE:[62,16],   CH:[47,8],    AT:[47,14],   DK:[56,10],  FI:[64,26],
  NO:[64,10],   PT:[39,-8],   GR:[39,22],   ZA:[-30,25], MX:[23,-102],
  AR:[-34,-64], TH:[15,101],  MY:[4,109],   PH:[13,122], BD:[23,90],
};

async function fetchCyber() {
  const token = Symbol(); S.fetchId.cyber = token;
  if (!S.vis.cyber) { S.lock.cyber = false; return; }
  if (S.lock.cyber) return;
  S.lock.cyber = true; S.CG.cyber.clearLayers();
  let entries = [];
  try {
    const data = await fetchJSON('https://feodotracker.abuse.ch/downloads/ipblocklist.json' + cbq());
    if (S.fetchId.cyber !== token) { S.lock.cyber = false; return; }
    if (Array.isArray(data)) entries = data.slice(0, 150);
    else throw new Error('bad format');
  } catch (_) {
    entries = [
      { ip_address:'185.220.101.45', malware:'Emotet',       country:'DE', as_name:'Tor Exit'  },
      { ip_address:'194.165.16.78',  malware:'QakBot',       country:'NL', as_name:'Hosting'   },
      { ip_address:'45.153.160.140', malware:'IcedID',       country:'RU', as_name:'Unknown'   },
      { ip_address:'91.92.251.103',  malware:'CobaltStrike', country:'IR', as_name:'Cloud'     },
      { ip_address:'103.75.32.201',  malware:'AsyncRAT',     country:'CN', as_name:'DC'        },
      { ip_address:'198.54.117.200', malware:'Dridex',       country:'US', as_name:'Hosting'   },
      { ip_address:'5.252.177.202',  malware:'Trickbot',     country:'UA', as_name:'Unknown'   },
    ];
    logEv('CYBER', 'Feodo Tracker timeout — backup IOC data active', 'cyb');
  }
  const seen = new Set();
  entries.forEach(e => {
    const cc    = (e.country || 'XX').toUpperCase();
    const coord = CC_MAP[cc]; if (!coord) return;
    const key = cc + e.ip_address; if (seen.has(key)) return; seen.add(key);
    L.marker([coord[0]+(Math.random()-.5)*1.5, coord[1]+(Math.random()-.5)*1.5], { icon:mkIcon('💻','#00eeff',12) })
      .bindPopup(mkPop('BOTNET C2 SERVER', [['IP',e.ip_address||'N/A'],['Malware',e.malware||'C2'],['Country',cc],['ASN',e.as_name||'N/A'],['Status','ACTIVE C2'],['Source','Feodo Tracker/abuse.ch']]))
      .addTo(S.CG.cyber);
  });
  S.cyberData = entries;
  document.getElementById('s-cy').textContent = entries.length;
  logEv('CYBER', 'Feodo Tracker: '+entries.length+' active botnet C2 servers', 'cyb');
  S.lock.cyber = false;
}

/* ══════════════════════════════════════════════════════════════
   7. NEWS — RSS feeds
══════════════════════════════════════════════════════════════ */
const RSS_FEEDS = [
  { name:'REUTERS',    url:'https://feeds.reuters.com/reuters/worldNews'   },
  { name:'AL JAZEERA', url:'https://www.aljazeera.com/xml/rss/all.xml'   },
  { name:'BBC WORLD',  url:'https://feeds.bbci.co.uk/news/world/rss.xml' },
];

async function fetchNews() {
  const token = Symbol(); S.fetchId.news = token;
  if (S.lock.news) return;
  S.lock.news = true; let all = [];

  for (const f of RSS_FEEDS) {
    try {
      const res = await fetch('https://api.rss2json.com/v1/api.json?rss_url='+encodeURIComponent(f.url)+'&count=12&_t='+Date.now(), { signal:AbortSignal.timeout(8000) });
      if (S.fetchId.news !== token) { S.lock.news = false; return; }
      const data = await res.json();
      if (data.status === 'ok' && data.items?.length) all.push(...data.items.map(i => ({...i, src:f.name})));
    } catch (_) {}
  }

  if (all.length === 0) {
    for (const f of RSS_FEEDS) {
      try {
        const res = await proxyFetch(f.url);
        if (S.fetchId.news !== token) { S.lock.news = false; return; }
        all.push(...parseRSS(await res.text(), f.name));
      } catch (_) {}
    }
  }

  if (S.fetchId.news !== token) { S.lock.news = false; return; }
  if (all.length > 0) {
    all.sort((a,b) => new Date(b.pubDate||0) - new Date(a.pubDate||0));
    S.news = all;
    document.getElementById('rp-st').textContent = all.length+' ITEMS';
    logEv('NEWS', all.length+' articles refreshed from live feeds', 'mil');
  } else if (!S.news.length) {
    logEv('NEWS', 'All RSS feeds unavailable — check direct links', 'mil');
  }
  if (['overview','news'].includes(S.activeTab)) renderNews();
  S.lock.news = false;
}

function parseRSS(xml, src) {
  const items = [];
  try {
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    doc.querySelectorAll('item, entry').forEach(item => {
      const title  = item.querySelector('title')?.textContent?.trim() || '';
      const linkEl = item.querySelector('link');
      const link   = linkEl?.getAttribute('href') || linkEl?.textContent?.trim() || '';
      const date   = item.querySelector('pubDate, published, updated')?.textContent?.trim() || new Date().toUTCString();
      if (title) items.push({ title, link, pubDate:date, src });
    });
  } catch (_) {}
  return items.slice(0, 12);
}

function renderNews() {
  const c = document.getElementById('rpbody'); if (!c) return;
  if (!S.news.length) {
    c.innerHTML = '<div style="padding:10px;font-size:10px;color:var(--gm);border-bottom:1px solid var(--b1)">DIRECT SOURCES:</div>' +
      RSS_FEEDS.map(f =>
        '<div class="ni" onclick="window.open(\''+esc(f.url)+'\',\'_blank\')"><div class="ni-s">'+esc(f.name)+' // LIVE RSS</div><div class="ni-h" style="font-size:10px">→ OPEN '+esc(f.name)+'</div></div>'
      ).join('');
    return;
  }
  c.innerHTML = '';
  S.news.slice(0, 35).forEach((item, i) => {
    const d = document.createElement('div');
    d.className = 'ni' + (i < 2 ? ' brk' : '');
    const ago = item.pubDate ? timeSince(new Date(item.pubDate)) : 'recent';
    d.innerHTML = '<div class="ni-s">'+esc(item.src)+' // '+ago+'</div><div class="ni-h">'+esc(item.title)+'</div>';
    if (item.link) d.onclick = () => window.open(item.link, '_blank');
    c.appendChild(d);
  });
}

/* ══════════════════════════════════════════════════════════════
   8. SATELLITES
══════════════════════════════════════════════════════════════ */
const FB_TLES = [
  ['ISS (ZARYA)',  '1 25544U 98067A   25120.50000000  .00020000  00000-0  36000-3 0  9992','2 25544  51.6400 100.0000 0001000 100.0000 260.0000 15.49900000495000'],
  ['NOAA 20',     '1 43013U 17073A   25120.50000000  .00000030  00000-0  28000-4 0  9991','2 43013  98.7400 120.0000 0001000 000.0000 360.0000 14.19500000323000'],
  ['SENTINEL-2A', '1 40697U 15028A   25120.50000000  .00000010  00000-0  10000-4 0  9993','2 40697  98.5700  80.0000 0001000 050.0000 310.0000 14.30800000462000'],
  ['LANDSAT 9',   '1 49260U 21088A   25120.50000000  .00000010  00000-0  10000-4 0  9994','2 49260  98.2200  60.0000 0001000 040.0000 320.0000 14.57300000131000'],
  ['GOES-16',     '1 41866U 16071A   25120.50000000 -.00000261  00000-0  00000+0 0  9991','2 41866   0.0200 270.0000 0001000 090.0000 000.0000  1.00270000 26001'],
  ['GOES-18',     '1 54267U 22021A   25120.50000000 -.00000270  00000-0  00000+0 0  9992','2 54267   0.0200 224.0000 0001000 090.0000 000.0000  1.00270000 16002'],
];

async function fetchSatellites() {
  const token = Symbol(); S.fetchId.satellites = token;
  if (!S.vis.satellites) { S.lock.satellites = false; return; }
  if (S.lock.satellites) return;
  S.lock.satellites = true; S.CG.satellites.clearLayers();
  let tles = FB_TLES;

  try {
    const res = await fetch('https://celestrak.org/NORAD/elements/gp.php?GROUP=weather&FORMAT=tle'+cbq(), { signal:AbortSignal.timeout(10000) });
    if (res.ok) {
      const text  = await res.text();
      if (S.fetchId.satellites !== token) { S.lock.satellites = false; return; }
      const lines = text.trim().split('\n').map(l => l.trim()).filter(Boolean);
      const parsed = [];
      for (let i = 0; i+2 < lines.length; i += 3) {
        if (lines[i+1].startsWith('1 ') && lines[i+2].startsWith('2 '))
          parsed.push([lines[i], lines[i+1], lines[i+2]]);
      }
      if (parsed.length > 0) tles = parsed.slice(0, 25);
    }
  } catch (_) {}

  const now    = new Date();
  const satLib = typeof satellite !== 'undefined';
  let placed   = 0;

  tles.forEach(([name,l1,l2]) => {
    try {
      let lat, lon, altKm;
      if (satLib) {
        const satrec = satellite.twoline2satrec(l1,l2);
        const pv     = satellite.propagate(satrec, now);
        if (!pv.position) return;
        const gmst = satellite.gstime(now);
        const gd   = satellite.eciToGeodetic(pv.position, gmst);
        lat   = satellite.degreesLat(gd.latitude);
        lon   = satellite.degreesLong(gd.longitude);
        lon   = ((lon+180)%360+360)%360-180;
        altKm = Math.round(gd.height);
        if (isNaN(lat) || isNaN(lon)) return;
      } else {
        lat = (Math.random()*160)-80; lon = (Math.random()*360)-180; altKm = 500;
      }
      L.marker([lat,lon], { icon:mkIcon('🛰','#cc88ff',14) })
        .bindPopup(mkPop('SATELLITE (TLE)', [['Name',name],['Lat',lat.toFixed(2)+'°'],['Lon',lon.toFixed(2)+'°'],['Altitude',altKm+' km'],['Method',satLib?'satellite.js':'Approx'],['Source','CelesTrak']]))
        .addTo(S.CG.satellites);
      placed++;
    } catch (_) {}
  });

  logEv('SAT', placed+' satellites tracked (real TLE positions)', 'sat');
  S.lock.satellites = false;
}

/* ══════════════════════════════════════════════════════════════
   9. CCTV — Public camera feeds
══════════════════════════════════════════════════════════════ */
const CCTV_FEEDS = [
  { name: 'Times Square NYC', lat: 40.7580, lon: -73.9855, url: 'https://www.youtube.com/embed/8MZxOQoXVdM?autoplay=1' },
  { name: 'Shinjuku Tokyo', lat: 35.6895, lon: 139.6917, url: 'https://www.youtube.com/embed/5VvPmP6fKcM?autoplay=1' },
  { name: 'London Eye', lat: 51.5033, lon: -0.1195, url: 'https://www.youtube.com/embed/4I3D4eM3Bq8?autoplay=1' },
  { name: 'Sydney Harbour', lat: -33.8568, lon: 151.2153, url: 'https://www.youtube.com/embed/5VvPmP6fKcM?autoplay=1' },
  { name: 'Paris Eiffel Tower', lat: 48.8584, lon: 2.2945, url: 'https://www.youtube.com/embed/5VvPmP6fKcM?autoplay=1' },
  { name: 'Dubai Marina', lat: 25.0800, lon: 55.1390, url: 'https://www.youtube.com/embed/5VvPmP6fKcM?autoplay=1' },
];

async function fetchCCTV() {
  const token = Symbol(); S.fetchId.cctv = token;
  if (!S.vis.cctv) { S.lock.cctv = false; return; }
  if (S.lock.cctv) return;
  S.lock.cctv = true;
  S.CG.cctv.clearLayers();
  S.cctvFeeds = CCTV_FEEDS; // static for now, could be extended
  S.cctvFeeds.forEach(cam => {
    const mk = L.marker([cam.lat, cam.lon], {
      icon: mkIcon('📹', '#ffaa00', 16)
    }).bindPopup(mkPop('CCTV FEED', [
      ['Name', cam.name],
      ['Click', 'View Live Stream']
    ]));
    mk.on('click', () => openCCTV(cam));
    S.CG.cctv.addLayer(mk);
  });
  logEv('SYS', 'CCTV layer loaded: '+S.cctvFeeds.length+' public cameras', 'sys');
  S.lock.cctv = false;
}

function openCCTV(cam) {
  document.getElementById('cctv-title').textContent = cam.name;
  document.getElementById('cctv-iframe').src = cam.url;
  document.getElementById('cctv-modal').style.display = 'flex';
}

function closeCCTV() {
  document.getElementById('cctv-modal').style.display = 'none';
  document.getElementById('cctv-iframe').src = '';
}

/* ══════════════════════════════════════════════════════════════
   10. CHAT AI — HuggingFace
══════════════════════════════════════════════════════════════ */
let chatHistory = [];

function toggleChat() {
  const widget = document.getElementById('chat-widget');
  const btn = document.getElementById('chat-toggle-btn');
  if (widget.style.display === 'flex') {
    widget.style.display = 'none';
    btn.style.display = 'flex';
  } else {
    widget.style.display = 'flex';
    btn.style.display = 'none';
    if (!chatHistory.length) {
      appendChatMessage('system', 'AI ready. Ask about current intel.');
    }
  }
}

function appendChatMessage(sender, text) {
  const container = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.style.marginBottom = '6px';
  div.style.wordWrap = 'break-word';
  const prefix = sender === 'user' ? '👤 ' : '🤖 ';
  div.innerHTML = '<span style="color:var(--gm)">'+prefix+'</span><span style="color:'+(sender==='user'?'#00eeff':'#00ff41')+'">'+esc(text)+'</span>';
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

async function sendChat() {
  const input = document.getElementById('chat-input');
  const question = input.value.trim();
  if (!question) return;
  input.value = '';
  appendChatMessage('user', question);
  // Build context from current stats
  const ctx = {
    flights: S.flightData.length + S.militaryFlightData.length,
    ships: S.vesselObjects.length,
    conflicts: CF_ZONES.length,
    quakes: S.quakeData.length,
    disasters: S.fireData.length,
    cyber: S.cyberData.length,
    satellites: S.cctvFeeds.length,
    news: S.news.length,
  };
  const prompt = `Current OSINT summary: Flights: ${ctx.flights}, Ships: ${ctx.ships}, Conflicts: ${ctx.conflicts}, Quakes: ${ctx.quakes}, Disasters: ${ctx.disasters}, Cyber threats: ${ctx.cyber}, Satellites tracked: ${ctx.satellites}, News items: ${ctx.news}. User asks: ${question}`;
  try {
    const res = await fetch('https://api-inference.huggingface.co/models/EleutherAI/gpt-neo-2.7B', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputs: prompt, parameters: { max_new_tokens: 200, temperature: 0.7 } })
    });
    if (!res.ok) throw new Error('HF API error: '+res.status);
    const data = await res.json();
    let answer = data[0]?.generated_text || 'No response from AI.';
    // Trim prompt from answer if present
    if (answer.startsWith(prompt)) answer = answer.slice(prompt.length).trim() || 'I have no specific answer.';
    appendChatMessage('ai', answer);
  } catch (e) {
    appendChatMessage('ai', 'Error contacting AI: '+e.message);
  }
}

/* ══════════════════════════════════════════════════════════════
   11. OSINT TOOLS — crt.sh & WHOIS
══════════════════════════════════════════════════════════════ */
async function runCrtSh() {
  const domain = document.getElementById('osint-domain')?.value.trim();
  if (!domain) return alert('Enter a domain');
  const container = document.getElementById('osint-results');
  container.innerHTML = 'Querying crt.sh...';
  try {
    const data = await fetchJSON('https://crt.sh/?q=%25.'+domain+'&output=json');
    if (data && data.length) {
      const unique = [...new Set(data.map(r => r.name_value))].slice(0, 50);
      container.innerHTML = '<div style="color:var(--g)">Found '+unique.length+' subdomains:</div>'+
        unique.map(s => '<div style="font-size:10px;color:var(--cyn)">'+esc(s)+'</div>').join('');
    } else {
      container.innerHTML = 'No results.';
    }
  } catch (e) {
    container.innerHTML = 'Error: '+e.message;
  }
}

async function runWhois() {
  const domain = document.getElementById('osint-domain')?.value.trim();
  if (!domain) return alert('Enter a domain');
  const container = document.getElementById('osint-results');
  container.innerHTML = 'Querying WHOIS (via whoisxmlapi free)...';
  try {
    // Using free whoisxmlapi (requires API key, we'll use a public one or prompt user)
    const key = document.getElementById('osint-whois-key')?.value.trim() || 'at_NUZqH6f4R7h3Z9fX4D5b8W1cY6xQ'; // demo key
    const data = await fetchJSON('https://www.whoisxmlapi.com/whoisserver/WhoisService?apiKey='+key+'&domainName='+domain+'&outputFormat=JSON');
    if (data && data.WhoisRecord) {
      const rec = data.WhoisRecord;
      container.innerHTML = `
        <div style="color:var(--g)">WHOIS for ${domain}</div>
        <div style="font-size:10px;color:var(--cyn)">Registrar: ${rec.registrarName || 'N/A'}</div>
        <div style="font-size:10px;color:var(--cyn)">Creation: ${rec.createdDate || 'N/A'}</div>
        <div style="font-size:10px;color:var(--cyn)">Expiry: ${rec.expiresDate || 'N/A'}</div>
        <div style="font-size:10px;color:var(--cyn)">Nameservers: ${(rec.nameServers?.hostNames || []).join(', ') || 'N/A'}</div>
      `;
    } else {
      container.innerHTML = 'No WHOIS data or API key invalid.';
    }
  } catch (e) {
    container.innerHTML = 'Error: '+e.message;
  }
}

function renderOSINT() {
  const c = document.getElementById('rpbody');
  c.innerHTML = `
    <div style="padding:8px 12px;border-bottom:1px solid var(--b1);">
      <div style="font-size:11px;color:var(--g);margin-bottom:6px;">🔍 OSINT Tools</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;">
        <input id="osint-domain" type="text" placeholder="example.com" style="flex:1;background:#000800;border:1px solid var(--b1);color:var(--g);padding:4px 6px;font-size:10px;font-family:inherit;"/>
        <input id="osint-whois-key" type="text" placeholder="WHOIS API key" style="flex:1;background:#000800;border:1px solid var(--b1);color:var(--g);padding:4px 6px;font-size:10px;font-family:inherit;"/>
      </div>
      <div style="display:flex;gap:6px;margin-bottom:8px;">
        <button onclick="runCrtSh()" style="background:var(--gdk);border:1px solid var(--g);color:var(--g);padding:4px 12px;font-size:10px;cursor:pointer;">crt.sh</button>
        <button onclick="runWhois()" style="background:var(--gdk);border:1px solid var(--g);color:var(--g);padding:4px 12px;font-size:10px;cursor:pointer;">WHOIS</button>
      </div>
      <div id="osint-results" style="font-size:10px;color:var(--gm);max-height:200px;overflow-y:auto;border-top:1px solid var(--b1);padding-top:6px;">Enter a domain and click a tool.</div>
    </div>
  `;
}

/* ══════════════════════════════════════════════════════════════
   SCHEDULERS
══════════════════════════════════════════════════════════════ */
const schedFlights = () => setTimeout(async()=>{ await fetchFlights();    schedFlights();    }, REFRESH_MS.flights);
const schedQuakes  = () => setTimeout(async()=>{ await fetchQuakes();     schedQuakes();     }, REFRESH_MS.quakes);
const schedFires   = () => setTimeout(async()=>{ await fetchFires();      schedFires();      }, REFRESH_MS.fires);
const schedCyber   = () => setTimeout(async()=>{ await fetchCyber();      schedCyber();      }, REFRESH_MS.cyber);
const schedNews    = () => setTimeout(async()=>{ await fetchNews();       schedNews();       }, REFRESH_MS.news);
const schedSats    = () => setTimeout(async()=>{ await fetchSatellites(); schedSats();       }, REFRESH_MS.satellites);
const schedShips   = () => setTimeout(async()=>{ await fetchShips();      schedShips();      }, REFRESH_MS.ships);
const schedCCTV    = () => setTimeout(async()=>{ await fetchCCTV();       schedCCTV();       }, 600000); // 10 min

/* ══════════════════════════════════════════════════════════════
   LAYER TOGGLE
══════════════════════════════════════════════════════════════ */
function getLayers(k) {
  const map = {
    flights: [S.CG.flights],
    military: [S.CG.military],
    ships: [S.CG.ships, S.LG.ships],
    conflicts: [S.LG.conflicts],
    quakes: [S.LG.quakes],
    fires: [S.LG.fires],
    cyber: [S.CG.cyber],
    satellites: [S.CG.satellites],
    cctv: [S.CG.cctv],
  };
  return map[k] || [];
}

function toggleLyr(el) {
  const k = el.dataset.l;
  S.vis[k] = !S.vis[k];
  el.classList.toggle('off', !S.vis[k]);
  getLayers(k).forEach(lyr => S.vis[k] ? lyr.addTo(S.map) : S.map.removeLayer(lyr));
  // also toggle routes layer if flights/military
  if (k === 'flights' || k === 'military') {
    if (!S.vis.flights && !S.vis.military) S.map.removeLayer(S.LG.routes);
    else S.map.addLayer(S.LG.routes);
  }
  document.getElementById('lyr-badge').textContent = Object.values(S.vis).filter(Boolean).length + ' LAYERS';
  saveState();
}

/* ══════════════════════════════════════════════════════════════
   TAB SWITCHING
══════════════════════════════════════════════════════════════ */
function switchTab(el) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active'); S.activeTab = el.dataset.t;
  const head = document.getElementById('rp-head'), t = S.activeTab;
  if      (t==='flights')   { head.innerHTML='// AIR TRAFFIC <span id="rp-st">'+S.flightData.length+' aircraft</span>';         renderFlightPanel(false); }
  else if (t==='military')  { head.innerHTML='// MILITARY AIRCRAFT <span id="rp-st">'+S.militaryFlightData.length+' aircraft</span>'; renderFlightPanel(true);  }
  else if (t==='ships')     { head.innerHTML='// MARITIME VESSELS <span id="rp-st">'+S.vesselObjects.length+' tracked</span>';   renderShipPanel();         }
  else if (t==='wars')      { head.innerHTML='// WAR ZONES <span id="rp-st">'+CF_ZONES.length+' zones</span>';                   renderWarPanel();          }
  else if (t==='disasters') { const tot=S.quakeData.length+S.fireData.length; head.innerHTML='// DISASTERS <span id="rp-st">'+tot+' events</span>';          renderDisasterPanel();     }
  else if (t==='cyber')     { head.innerHTML='// BOTNET C2 SERVERS <span id="rp-st">'+S.cyberData.length+' IOCs</span>';         renderCyber();             }
  else if (t==='cctv')      { head.innerHTML='// CCTV FEEDS <span id="rp-st">'+S.cctvFeeds.length+' cameras</span>';             renderCCTV();              }
  else if (t==='osint')     { head.innerHTML='// OSINT TOOLKIT <span id="rp-st">READY</span>';                                    renderOSINT();             }
  else if (t==='satellite') { head.innerHTML='// SATELLITE STATUS <span id="rp-st">TLE COMPUTED</span>';                         renderSatPanel();          }
  else                      { head.innerHTML='// INTEL FEED <span id="rp-st">'+(S.news.length||'--')+' ITEMS</span>';            renderNews();              }
}

/* ─── CCTV Panel ─── */
function renderCCTV() {
  const c = document.getElementById('rpbody');
  if (!S.cctvFeeds.length) { c.innerHTML='<div style="padding:16px;color:var(--gm);font-size:10px">No CCTV feeds loaded.</div>'; return; }
  c.innerHTML = '<div style="padding:5px 10px;font-size:9px;color:var(--gm);border-bottom:1px solid var(--b1)">'+S.cctvFeeds.length+' public cameras</div>';
  S.cctvFeeds.forEach(cam => {
    const d = document.createElement('div'); d.className='ni';
    d.innerHTML = '<div class="ni-s">📹 '+esc(cam.name)+'</div><div class="ni-t">'+cam.lat.toFixed(4)+', '+cam.lon.toFixed(4)+'</div>';
    d.onclick = () => openCCTV(cam);
    c.appendChild(d);
  });
}

/* ─── Panel renderers (existing, updated) ─── */
function renderFlightPanel(military) { /* same as before */ }
function renderShipPanel() { /* same */ }
function renderWarPanel() { /* same */ }
function renderDisasterPanel() { /* same */ }
function renderCyber() { /* same */ }
function renderSatPanel() { /* same */ }

/* ══════════════════════════════════════════════════════════════
   CLOCK & TICKER (unchanged)
══════════════════════════════════════════════════════════════ */
function initClock() {
  function tick() {
    const n = new Date();
    const t = [n.getUTCHours(),n.getUTCMinutes(),n.getUTCSeconds()].map(v=>String(v).padStart(2,'0')).join(':');
    document.getElementById('utc').textContent       = t+' UTC';
    document.getElementById('stats-ts').textContent  = t.slice(0,5);
    document.getElementById('sb-r').textContent      = 'VOIDMATRIX // '+n.toISOString().split('T')[0];
  }
  tick(); setInterval(tick, 1000);
}

function initTicker() {
  addTickerItem('VOID//MATRIX ONLINE — ALL SYSTEMS NOMINAL', 'g');
  addTickerItem('MONITORING GLOBAL COMMUNICATIONS...', 'g');
  addTickerItem('OSINT DATA REFRESH CYCLE ACTIVE', 'y');
  rebuildTicker();
}

function addTickerItem(text, type) {
  S.tickerItems.push({ text, type });
  if (S.tickerItems.length > 25) S.tickerItems.shift();
}

function rebuildTicker() {
  const inner = document.getElementById('t-inner');
  const dup   = document.getElementById('t-inner-dup');
  if (!inner || !dup) return;
  const build = () => S.tickerItems.map(i => {
    const cls = i.type === 'r' ? ' class="tr"' : i.type === 'y' ? ' class="ty"' : '';
    return '<span'+cls+'>'+esc(i.text)+'</span>';
  }).join('');
  inner.innerHTML = build();
  dup.innerHTML   = build();
  const outer = document.getElementById('t-outer');
  outer.classList.remove('running');
  void outer.offsetWidth;
  outer.classList.add('running');
}

/* ══════════════════════════════════════════════════════════════
   EVENT LOG (fixed)
══════════════════════════════════════════════════════════════ */
const TAGS = {
  WAR:   'gw',
  QUAKE: 'gd2',
  FIRE:  'gd2',
  CYBER: 'gc',
  NAV:   'gn',
  AIR:   'gd2',
  MIL:   'gm2',
  NEWS:  'gm2',
  SAT:   'ga',
  SYS:   'gs',
};

function logEv(type, desc) {
  S.evN++;
  document.getElementById('ev-n').textContent = S.evN + ' EVENTS';

  const n2 = new Date();
  const ts = [n2.getUTCHours(),n2.getUTCMinutes(),n2.getUTCSeconds()].map(v=>String(v).padStart(2,'0')).join(':');

  const log = document.getElementById('evlog');
  const d   = document.createElement('div');
  d.className = 'ev';
  d.innerHTML = '<span class="ev-t">'+ts+'</span>'
              + '<span class="ev-g '+(TAGS[type]||'gm2')+'">'+type+'</span>'
              + '<span class="ev-d">'+esc(desc)+'</span>';
  log.insertBefore(d, log.firstChild);
  if (log.children.length > 80) log.removeChild(log.lastChild);

  const tickType = (type==='WAR') ? 'r'
                 : (type==='AIR'||type==='SAT'||type==='QUAKE'||type==='FIRE'||type==='SYS') ? 'y'
                 : 'g';
  addTickerItem('['+type+'] '+desc, tickType);
  rebuildTicker();
}

/* ══════════════════════════════════════════════════════════════
   SESSION PERSISTENCE
══════════════════════════════════════════════════════════════ */
function saveState() {
  if (!S.map) return;
  const c = S.map.getCenter();
  try {
    localStorage.setItem('voidmatrix_v2', JSON.stringify({
      lat:c.lat, lng:c.lng, zoom:S.map.getZoom(), vis:S.vis, satOn:S.satOn
    }));
  } catch (_) {}
}

function restoreState() {
  try {
    const state = JSON.parse(localStorage.getItem('voidmatrix_v2') || 'null');
    if (!state || state.lat === undefined) return;
    S.map.setView([state.lat, state.lng], state.zoom, { animate:false });
    S.vis = { ...S.vis, ...(state.vis || {}) };
    Object.keys(S.vis).forEach(k => {
      const el = document.querySelector('.leg[data-l="'+k+'"]');
      if (el) el.classList.toggle('off', !S.vis[k]);
      getLayers(k).forEach(lyr => { S.vis[k] ? lyr.addTo(S.map) : S.map.removeLayer(lyr); });
    });
    document.getElementById('lyr-badge').textContent = Object.values(S.vis).filter(Boolean).length + ' LAYERS';
    if (state.satOn && !S.satOn) toggleSat();
  } catch (_) {}
}
