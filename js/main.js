/* ══════════════════════════════════════════════════════════════
   MAIN — entry point: boot sequence, action dispatch, schedulers
   ══════════════════════════════════════════════════════════════ */
import { S } from './state.js';
import { $ } from './utils.js';

import { initMap, toggleSat, initOfflineBasemaps } from './map/init.js';
import { buildNav, switchTab } from './ui/tabs.js';
import { toggleLyr, updateLayerBadge } from './ui/legend.js';
import { restoreState, saveState } from './ui/session.js';
import { initClock } from './ui/clock.js';
import { initTicker } from './ui/ticker.js';
import { logEv } from './ui/eventLog.js';
import { attemptLogin, showLogin, logout } from './ui/login.js';
import { getPanel, DEFAULT_TAB, setCurrentTab } from './ui/panels/registry.js';
import { openCCTV, closeCCTV, reloadCCTV } from './ui/panels/cctvPanel.js';
import { zoomLegendLayer } from './ui/legend.js';
import { toggle as togglePanels, restorePanels } from './ui/panelsLayout.js';

import { fetchFlights, schedFlights } from './feeds/flights.js';
import { fetchQuakes, schedQuakes } from './feeds/quakes.js';
import { fetchFires, schedFires } from './feeds/disasters.js';
import { fetchConflicts } from './feeds/conflicts.js';
import { fetchShips, schedShips } from './feeds/maritime.js';
import { fetchCyber, schedCyber } from './feeds/cyber.js';
import { fetchCyberAttacks, schedAttacks } from './feeds/cyberAttacks.js';
import { fetchNews, schedNews } from './feeds/news.js';
import { fetchSatellites, schedSats } from './feeds/satellites.js';
import { fetchCCTV, schedCCTV, hydrateCachedCCTV } from './feeds/cctv.js';

/* ══════════════════════════════════════════════════════════════
   ACTION DISPATCH — all clicks flow through data-action attributes
   ══════════════════════════════════════════════════════════════ */
const ACTIONS = {
  login: async () => { if (attemptLogin()) enterApp(); },
  logout,
  'toggle-sat': toggleSat,
  'toggle-panels': () => togglePanels(),
  'toggle-lyr': (el) => toggleLyr(el),
  tab: (el) => switchTab(el),
  'open-cctv': (el) => openCCTV(camFromRow(el)),
  'close-cctv': closeCCTV,
  'cctv-reload': reloadCCTV,
};

function camFromRow(el) {
  const row = el.closest('.cam');
  const id = row && row.dataset.cam;
  return S.cctvFeeds.find(c => c.id === id) || null;
}

function installActions() {
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const fn = ACTIONS[el.dataset.action];
    if (fn) { e.preventDefault(); fn(el, e); }
  });

  // Enter key submits the login form from either field
  ['lu', 'lp'].forEach(id => $(id)?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); ACTIONS.login(); }
  }));

  // double-click a legend chip → fly to that layer's data
  document.addEventListener('dblclick', (e) => {
    const leg = e.target.closest('.leg');
    if (leg) zoomLegendLayer(leg);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && $('cctv-modal')?.style.display === 'flex') closeCCTV();
  });
}

/** Map listeners that only exist once Leaflet is up. */
function installMapListeners() {
  if (S.map) S.map.on('moveend zoomend', saveState);
}

/* ══════════════════════════════════════════════════════════════
   BOOT
   ══════════════════════════════════════════════════════════════ */
const ld = (p, m) => { $('ld-bar').style.width = p + '%'; $('ld-msg').textContent = m; };
const slp = (ms) => new Promise(r => setTimeout(r, ms));

async function enterApp() {
  $('login-screen').style.display = 'none';
  $('loader').style.display = 'flex';
  boot();
}

export async function boot() {
  // A previous session may have left a feed "in flight" — clear stale locks.
  Object.keys(S.lock).forEach(k => { S.lock[k] = false; });

  try {
    await runBoot();
  } catch (err) {
    console.error('boot failed:', err);
    logEv('SYS', 'Boot error: ' + (err && err.message ? err.message : err));
  } finally {
    $('loader').style.display = 'none';
    $('app').style.display = 'flex';
    requestAnimationFrame(() => setTimeout(() => S.map.invalidateSize(), 200));
  }
}

async function runBoot() {
  ld(4, 'INITIALIZING LEAFLET MAP ENGINE...');   await slp(60);
  initMap();
  await initOfflineBasemaps();   // enables the offline basemap if tiles exist
  ld(10, 'RESTORING SESSION STATE...');
  buildNav();
  restoreState();
  setCurrentTab(S.activeTab || DEFAULT_TAB);
  const activeTabEl = document.querySelector(`.tab[data-t="${S.activeTab || DEFAULT_TAB}"]`);
  (activeTabEl || document.querySelector('.tab')).classList.add('active');
  switchTab(activeTabEl || document.querySelector('.tab'));
  updateLayerBadge();
  installMapListeners();
  restorePanels();

  // Feeds run in parallel so the loader advances as data arrives.
  const steps = [
    ['FETCHING REAL-TIME FLIGHT DATA...',  16, fetchFlights],
    ['CONNECTING USGS SEISMIC FEED...',    30, fetchQuakes],
    ['LOADING NASA EONET EVENTS...',       42, fetchFires],
    ['MAPPING CONFLICT ZONES...',          53, fetchConflicts],
    ['CHARTING MARITIME INTELLIGENCE...',  63, fetchShips],
    ['FETCHING FEODO TRACKER IOCs...',     72, fetchCyber],
    ['MAPPING LIVE ATTACK TELEMETRY...',     74, fetchCyberAttacks],
    ['INDEXING LIVE CCTV STREAMS...',     80, null],
    ['LOADING NEWS FEEDS...',              88, fetchNews],
    ['COMPUTING SATELLITE POSITIONS...',   95, fetchSatellites],
  ];
  // CCTV is deliberately *not* awaited: the HLS camera index is ~6MB. The
  // cached camera list is rendered instantly and the live list replaces it.
  ld(80, 'INDEXING LIVE CCTV STREAMS...');
  hydrateCachedCCTV();
  fetchCCTV();
  await Promise.all(steps.map(async ([msg, pct, fn]) => {
    if (!fn) return;
    ld(pct, msg); await fn();
  }));

  ld(100, 'ALL SYSTEMS ONLINE');              await slp(600);
  initClock();
  initTicker();
  getPanel(S.activeTab || DEFAULT_TAB).render();
  logEv('SYS', 'All systems online — local proxy verified: ' + (S.proxyOk === false ? 'NO' : 'yes'));

  startSchedulers();
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) saveState();
  });
}

let schedulersRunning = false;
/** Guarded so re-login can't start a second set of refresh timers. */
function startSchedulers() {
  if (schedulersRunning) return;
  schedulersRunning = true;
  schedFlights(); schedQuakes(); schedFires(); schedCyber();
  schedNews();    schedSats();   schedShips();  schedCCTV();  schedAttacks();
}

/* The login screen is the initial view; clicks are dispatched from here. */
try { $('boot-warn').style.display = 'none'; } catch (_) { /* static notice stays visible */ }
installActions();
showLogin();
