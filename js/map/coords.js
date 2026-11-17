/* ══════════════════════════════════════════════════════════════
   COORDINATES — live readout with DD / DMS formats + click-to-copy
   ══════════════════════════════════════════════════════════════ */
import { S } from '../state.js';

const KEY = 'voidmatrix_coords';
let tipEl = null;

function loadMode() {
  try { S.coordMode = localStorage.getItem(KEY) || 'dd'; } catch (_) { S.coordMode = 'dd'; }
}

/** 51.50960, -0.13484  |  51°30'34.6"N 0°08'05.4"W */
export function formatLatLng(lat, lng) {
  if (S.coordMode === 'dms') {
    const d = (v, pos, neg) => {
      const h = v < 0 ? neg : pos;
      const a = Math.abs(v);
      const deg = Math.floor(a);
      const min = Math.floor((a - deg) * 60);
      const sec = ((a - deg - min / 60) * 3600).toFixed(1);
      return `${deg}°${String(min).padStart(2, '0')}'${String(sec).padStart(4, '0')}"${h}`;
    };
    return d(lat, 'N', 'S') + '  ' + d(lng, 'E', 'W');
  }
  return lat.toFixed(5).padStart(8, ' ') + ', ' + lng.toFixed(5).padStart(9, ' ');
}

export function toggleCoordMode() {
  S.coordMode = S.coordMode === 'dms' ? 'dd' : 'dms';
  try { localStorage.setItem(KEY, S.coordMode); } catch (_) {}
  return S.coordMode.toUpperCase();
}

export function initCoords(map) {
  loadMode();
  tipEl = document.getElementById('coord-tip');
  if (!tipEl) return;

  let last = null;
  map.on('mousemove', (e) => {
    const { lat, lng } = e.latlng;
    last = [lat, lng];
    tipEl.textContent = 'LAT/LNG  ' + formatLatLng(lat, lng).replace(/\s+/g, ' ').trim();
  });
  map.on('mouseout', () => { tipEl.textContent = 'LAT/LNG  --.----, ---.-----'; });

  // click on the readout copies the last position
  tipEl.style.pointerEvents = 'auto';
  tipEl.addEventListener('click', async () => {
    if (!last) return;
    const txt = formatLatLng(last[0], last[1]);
    try {
      await navigator.clipboard.writeText(txt);
      const old = tipEl.textContent;
      tipEl.textContent = 'COPIED  ' + txt;
      setTimeout(() => { tipEl.textContent = old; }, 1200);
    } catch (_) {
      tipEl.textContent = 'COPY FAILED — ' + txt;
    }
  });
  return tipEl;
}
