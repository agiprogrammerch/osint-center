/* ══════════════════════════════════════════════════════════════
   GEO SEARCH — jump the map to typed coordinates (or a place name)
   Accepts:  51.5074, -0.1278  |  51.5074 -0.1278  |  51.5074N 0.1278W
             51°30'27.1"N 0°07'39.7"W  |  51 30 27 N 0 07 39 W
   Place names go through OpenStreetMap Nominatim (free, key-less).
   ══════════════════════════════════════════════════════════════ */
import { S } from '../state.js';
import { h, getJSON, num } from '../utils.js';
import { logEv } from '../ui/eventLog.js';

const NOMINATIM = 'https://nominatim.openstreetmap.org/search?format=json&limit=6&q=';
const RECENT_KEY = 'voidmatrix_geo';

/* ── coordinate parsing ────────────────────────────────────────── */
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function dmsToDecimal(deg, min = 0, sec = 0, hemi) {
  const sign = /[SWsw-]/i.test(hemi || '') ? -1 : 1;
  return sign * (Math.abs(deg) + (min || 0) / 60 + (sec || 0) / 3600);
}

/** "51.5074, -0.1278" · "51.5074N 0.1278W" · "N51.5 W0.12" */
function parseDecimalPair(s) {
  const m = s.match(/(-?\d+(?:[.,]\d+)?)\s*°?\s*([NSns])?\s*[,\/ ]\s*(-?\d+(?:[.,]\d+)?)\s*°?\s*([EWew])?/);
  if (!m) return null;
  const latRaw = Number(String(m[1]).replace(',', '.'));
  const lngRaw = Number(String(m[3]).replace(',', '.'));
  if (!isFinite(latRaw) || !isFinite(lngRaw)) return null;
  const lat = m[2] ? dmsToDecimal(latRaw, 0, 0, m[2]) : latRaw;
  const lng = m[4] ? dmsToDecimal(lngRaw, 0, 0, m[4]) : lngRaw;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat: clamp(lat, -90, 90), lng: clamp(lng, -180, 180) };
}

/**
 * "51°30'27.1"N 0°07'39.7"W" · "51 30 27 N 0 07 39 W" · "51°30'N 0°07'W"
 * Minutes/seconds are optional, separators may be missing, and either
 * hemisphere pair (N/S or E/W) may come first.
 */
const DMS_ONE = new RegExp(
  '(\\d{1,3}(?:\\.\\d+)?)\\s*(?:°|deg\\b)?\\s*' +
  '(?:(\\d{1,2}(?:\\.\\d+)?)\\s*(?:\'|′|min\\b)?\\s*)?' +
  '(?:(\\d{1,2}(?:\\.\\d+)?)\\s*(?:"|″|sec\\b)?\\s*)?' +
  '\\s*([NSEWnsew])', 'g');

function parseDMSPair(s) {
  DMS_ONE.lastIndex = 0;
  const out = [];
  let m;
  while ((m = DMS_ONE.exec(s))) {
    out.push({ deg: +m[1], min: +(m[2] || 0), sec: +(m[3] || 0), hemi: m[4] });
  }
  if (out.length < 2) return null;
  let [a, b] = out;
  // longitude may come first ("0 07 W 51 30 N") - swap it back
  if (/[EWew]/i.test(a.hemi) && /[NSns]/i.test(b.hemi)) { const t = a; a = b; b = t; }
  // latitude must be N/S and longitude must be E/W
  if (!/[NSns]/i.test(a.hemi) || !/[EWew]/i.test(b.hemi)) return null;
  const lat = dmsToDecimal(a.deg, a.min, a.sec, a.hemi);
  const lng = dmsToDecimal(b.deg, b.min, b.sec, b.hemi);
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

/** Decimal / DMS formatter for the hint line and marker popup. */
export function toDMS(lat, lng) {
  const f = (v, pos, neg) => {
    const h = v < 0 ? neg : pos;
    const a = Math.abs(v);
    const d = Math.floor(a);
    const m = Math.floor((a - d) * 60);
    const sec = ((a - d - m / 60) * 3600).toFixed(1);
    return `${d}°${String(m).padStart(2, '0')}'${String(sec).padStart(4, '0')}"${h}`;
  };
  return f(lat, 'N', 'S') + ' ' + f(lng, 'E', 'W');
}

export function parseCoords(input) {
  const s = String(input || '').trim();
  if (!s) return null;
  const nums = (s.match(/\d+(?:[.,]\d+)?/g) || []).length;
  // 3+ numbers or DMS symbols mean degrees/minutes/seconds — never let the
  // simple decimal pair grab "51 30" out of "51 30 27 N".
  if (nums > 2 || /[°′″]/.test(s)) return parseDMSPair(s);
  return parseDMSPair(s) || parseDecimalPair(s);
}

/* ── recent locations ── */
function loadRecent() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]') || []; } catch (_) { return []; }
}
function pushRecent(lat, lng, label) {
  const list = loadRecent().filter(r => !(Math.abs(r.lat - lat) < 1e-6 && Math.abs(r.lng - lng) < 1e-6));
  list.unshift({ lat, lng, label });
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 5))); } catch (_) {}
}

/* ── the control itself ── */
let goMarker = null;
let box = null;      // { input, hint, results }

export function initGeoSearch(map) {
  const SearchCtl = L.Control.extend({
    options: { position: 'topleft' },
    onAdd() {
      const wrap = L.DomUtil.create('div', 'geo-search');
      L.DomEvent.disableClickPropagation(wrap);
      L.DomEvent.disableScrollPropagation(wrap);

      const input = h('input', {
        class: 'geo-input', type: 'text', placeholder: 'COORDINATES  ·  40.86511, 26.30721',
        'aria-label': 'Go to coordinates or place',
      });
      const btn = h('button', { class: 'geo-btn', type: 'button', text: 'GO' });
      const hint = h('div', { class: 'geo-hint' });
      const results = h('div', { class: 'geo-results' });
      wrap.append(input, btn, hint, results);

      const submit = () => run(input.value, map, hint, results);
      L.DomEvent.on(btn, 'click', (e) => { L.DomEvent.stop(e); submit(); });
      L.DomEvent.on(input, 'keydown', (e) => {
        // Stop the MAP from reacting (zoom/pan keys), but never preventDefault
        // on character keys - that would block typing completely.
        L.DomEvent.stopPropagation(e);
        if (e.key === 'Enter') { e.preventDefault(); submit(); }
        else if (e.key === 'Escape') { e.preventDefault(); results.replaceChildren(); input.blur(); }
      });
      // keep focus in the box even though Leaflet traps focus on the container
      L.DomEvent.on(input, 'mousedown', (e) => { L.DomEvent.stopPropagation(e); });
      box = { input, hint, results };
      return wrap;
    },
  });
  map.addControl(new SearchCtl());
}

/** Focus the search input (shortcut). */
export function focusSearch() {
  const input = document.querySelector('.geo-input');
  if (input) { input.focus(); input.select(); }
}

async function run(raw, map, hint, results) {
  const q = String(raw || '').trim();
  if (!q) return;

  const coords = parseCoords(q);
  if (coords) {
    goTo(map, coords.lat, coords.lng);
    hint.textContent = '◆ ' + coords.lat.toFixed(5) + ', ' + coords.lng.toFixed(5)
      + '   (' + toDMS(coords.lat, coords.lng) + ')';
    results.replaceChildren();
    return;
  }

  // place name -> Nominatim (free, key-less)
  hint.textContent = 'SEARCHING…';
  results.replaceChildren();
  try {
    const rows = await getJSON(NOMINATIM + encodeURIComponent(q), 6000);
    const list = Array.isArray(rows) ? rows : [];
    if (!list.length) {
      hint.textContent = 'NO MATCH — TRY "51.5074, -0.1278"';
      return;
    }
    hint.textContent = list.length + ' PLACES — CLICK TO JUMP';
    results.replaceChildren(...list.map(r => {
      const lat = +r.lat, lng = +r.lon;
      const name = (r.display_name || '').split(',').slice(0, 3).join(',').trim();
      return h('button', {
        class: 'geo-result', type: 'button',
        onclick: () => {
          goTo(map, lat, lng);
          hint.textContent = '◆ ' + lat.toFixed(5) + ', ' + lng.toFixed(5) + ' — ' + name;
          results.replaceChildren();
        },
      }, [name + '  ⟶ ' + lat.toFixed(4) + ', ' + lng.toFixed(4)]);
    }));
  } catch (e) {
    hint.textContent = 'PLACE LOOKUP UNAVAILABLE (' + (e.message || 'proxy') + ') — COORDINATES STILL WORK';
  }
}

function goTo(map, lat, lng) {
  const zoom = Math.max(map.getZoom(), 9);
  map.flyTo([lat, lng], zoom, { duration: 0.8 });

  const label = lat.toFixed(5) + ', ' + lng.toFixed(5);
  if (goMarker) { map.removeLayer(goMarker); goMarker = null; }
  const icon = L.divIcon({
    className: 'geo-pin',
    html: '<span class="geo-pin-dot"></span><span class="geo-pin-ring"></span>',
    iconSize: [16, 16], iconAnchor: [8, 8], popupAnchor: [0, -8],
  });
  goMarker = L.marker([lat, lng], { icon, title: label })
    .bindPopup(() => mkGeoPopup(lat, lng))
    .addTo(map);
  setTimeout(() => { if (goMarker && map.hasLayer(goMarker)) goMarker.openPopup(); }, 850);

  pushRecent(lat, lng, label);
  logEv('SYS', 'Map jumped to ' + label + ' (' + toDMS(lat, lng) + ')');
  if (box) box.input.value = label;
}

function mkGeoPopup(lat, lng) {
  const d = h('div', {}, [
    h('div', { class: 'pt', text: 'SEARCHED LOCATION' }),
    h('div', { class: 'pr' }, [h('b', { text: 'Decimal: ' }), document.createTextNode(lat.toFixed(5) + ', ' + lng.toFixed(5))]),
    h('div', { class: 'pr' }, [h('b', { text: 'DMS: ' }), document.createTextNode(toDMS(lat, lng))]),
    h('div', { class: 'pr' }, [h('b', { text: 'Zoom: ' }), document.createTextNode(String(S.map ? S.map.getZoom() : '--'))]),
  ]);
  return d;
}
