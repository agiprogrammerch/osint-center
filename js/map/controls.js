/* ══════════════════════════════════════════════════════════════
   MAP CONTROLS — styled zoom stack, scale bar, crosshair, fullscreen,
   overlay toggles and keyboard shortcuts.
   ══════════════════════════════════════════════════════════════ */
import { S } from '../state.js';
import { cycleBasemap, basemapLabel, isOfflineActive } from './engine.js';
import { toggleGraticule, toggleNight } from './overlays.js';
import { toggleCoordMode } from './coords.js';
import { resetView, zoomToLayer } from './layers.js';
import { perfLabel } from './perf.js';
import { focusSearch } from './geoSearch.js';

const ICONS = {
  zoomIn: '＋', zoomOut: '－', home: '⌂', grat: '#', night: '☾',
  cross: '✛', fs: '⛶', dms: '°', base: '▤', fit: '⤢',
};

function ctrlBtn(html, title, onClick, id) {
  const btn = L.DomUtil.create('button', 'vm-btn');
  btn.innerHTML = html;
  btn.type = 'button';
  btn.title = title;
  btn.setAttribute('aria-label', title);
  if (id) btn.id = id;
  L.DomEvent.on(btn, 'click', (e) => {
    L.DomEvent.stop(e);
    onClick(btn);
  });
  return btn;
}

function stackControl(position, buttons) {
  const C = L.Control.extend({
    options: { position },
    onAdd() {
      const wrap = L.DomUtil.create('div', 'vm-ctrl');
      L.DomEvent.disableClickPropagation(wrap);
      L.DomEvent.disableScrollPropagation(wrap);
      buttons.forEach(b => wrap.appendChild(b));
      return wrap;
    },
  });
  return new C();
}

export function installControls(map) {
  /* zoom + view stack (top right) */
  const zoomStack = [
    ctrlBtn(ICONS.zoomIn, 'Zoom in  (+)', () => map.zoomIn()),
    ctrlBtn(ICONS.zoomOut, 'Zoom out  (−)', () => map.zoomOut()),
    ctrlBtn(ICONS.home, 'Reset view  (R)', () => resetView()),
    ctrlBtn(ICONS.fit, 'Zoom to top layer  (Z)', () => zoomToLayer(S.activeMapLayer || 'flights')),
  ];

  /* overlay stack (bottom right, above the legend) */
  const overlayStack = [
    ctrlBtn(ICONS.grat, 'Graticule 10°  (G)', (b) => b.classList.toggle('on', toggleGraticule()), 'vm-grat'),
    ctrlBtn(ICONS.night, 'Day / night terminator  (N)', (b) => b.classList.toggle('on', toggleNight()), 'vm-night'),
    ctrlBtn(ICONS.cross, 'Crosshair  (C)', (b) => {
      S.crosshairOn = !S.crosshairOn;
      document.getElementById('mc')?.classList.toggle('cross', S.crosshairOn);
      b.classList.toggle('on', S.crosshairOn);
    }, 'vm-cross'),
    ctrlBtn(ICONS.dms, 'Coordinate format DD / DMS  (M)', (b) => {
      const mode = toggleCoordMode();
      b.textContent = mode === 'DMS' ? 'DM' : '°';
      b.title = 'Coordinate format: ' + mode;
    }, 'vm-dms'),
    ctrlBtn(ICONS.base, 'Basemap style  (B): ' + basemapLabel(), () => {
      cycleBasemap();
      refreshBaseLabel();
    }, 'vm-base'),
    ctrlBtn('⬇', 'Offline map: Istanbul (see README) — download + status', () => showOfflineStatus(), 'vm-offline'),
    ctrlBtn(ICONS.fs, 'Fullscreen  (F)', () => toggleFullscreen(), 'vm-fs'),
  ];

  map.addControl(stackControl('topright', zoomStack));
  map.addControl(stackControl('bottomright', overlayStack));
  map.addControl(L.control.scale({ metric: true, imperial: false, maxWidth: 140, position: 'bottomleft' }));

  refreshBaseLabel();
  bindKeys(map);
  startHud();
}

let hudTimer = null;

function startHud() {
  if (hudTimer) return;
  hudTimer = setInterval(updateHud, 1000);
}

/** Stop the HUD interval (used on logout). */
export function stopControlTimers() {
  if (hudTimer) clearInterval(hudTimer);
  hudTimer = null;
}

/** Offline map status: what has been downloaded locally, if anything. */
function showOfflineStatus() {
  import('../ui/eventLog.js').then(m => {
    import('../state.js').then(({ S }) => {
      const maps = S.offlineMaps || [];
      if (!maps.length) {
        m.logEv('SYS', 'No offline map yet — run: python3 download_istanbul_map.py (see README.md)');
        return;
      }
      maps.forEach(e => m.logEv('SYS', 'Offline map ready: ' + e.label + ' — ' +
        (e.manifest ? `z${e.manifest.minZoom}-z${e.manifest.maxZoom}, ${Number(e.manifest.tiles||0).toLocaleString('en-US')} tiles` : '')));
    });
  });
}

function refreshBaseLabel() {
  const b = document.getElementById('vm-base');
  if (b) b.title = 'Basemap style (B): ' + basemapLabel();
}

export function toggleFullscreen() {
  const mc = document.getElementById('mc');
  const inFs = document.fullscreenElement || mc.classList.contains('vm-fs');
  if (document.fullscreenElement) {
    document.exitFullscreen?.().catch(() => {});
  } else if (mc.requestFullscreen) {
    mc.requestFullscreen().then(() => S.map?.invalidateSize()).catch(() => mc.classList.toggle('vm-fs'));
  } else {
    mc.classList.toggle('vm-fs');
  }
  setTimeout(() => S.map?.invalidateSize(), 250);
}

/** Live HUD: fps, marker count, coordinate mode. */
function updateHud() {
  const el = document.getElementById('minfo');
  if (!el || !S.map) return;
  el.textContent = `${perfLabel()} · ${totalMarkersSafe()} OBJ · ${(S.coordMode || 'DD').toUpperCase()}`;
}
function totalMarkersSafe() {
  let n = 0;
  Object.values(S.markers).forEach(m => n += m.size);
  return n.toLocaleString('en-US');
}

function bindKeys(map) {
  const PAN = 120;
  document.addEventListener('keydown', (e) => {
    // never steal keys from inputs
    if (e.target instanceof Element && e.target.matches('input, textarea, select')) return;
    const k = e.key.toLowerCase();
    const zoomStep = (map.getZoom() || 3) + (k === '+' || k === '=' ? 1 : -1);
    if (k === '+' || k === '=' || k === '-') { e.preventDefault(); map.setZoom(zoomStep); }
    else if (k === 'arrowup') { e.preventDefault(); map.panBy([0, -PAN]); }
    else if (k === 'arrowdown') { e.preventDefault(); map.panBy([0, PAN]); }
    else if (k === 'arrowleft') { e.preventDefault(); map.panBy([-PAN, 0]); }
    else if (k === 'arrowright') { e.preventDefault(); map.panBy([PAN, 0]); }
    else if (k === 'r') resetView();
    else if (k === 'p') document.getElementById('panels-btn')?.click();
    else if (k === '/') focusSearch();
    // route overlay keys through their buttons so the highlight stays in sync
    else if (k === 'g') document.getElementById('vm-grat')?.click();
    else if (k === 'n') document.getElementById('vm-night')?.click();
    else if (k === 'b') document.getElementById('vm-base')?.click();
    else if (k === 'm') document.getElementById('vm-dms')?.click();
    else if (k === 'f') document.getElementById('vm-fs')?.click();
    else if (k === 'c') document.getElementById('vm-cross')?.click();
    else if (k === 'z') zoomToLayer(S.activeMapLayer || 'flights');
  });
}
