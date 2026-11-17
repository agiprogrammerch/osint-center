/* ══════════════════════════════════════════════════════════════
   PANEL: AIR TRAFFIC — searchable live aircraft list -> map focus
   Rows carry registration + model as metadata enrichment arrives.
   ══════════════════════════════════════════════════════════════ */
import { S } from '../../state.js';
import { h, num, setHeaderCount } from '../../utils.js';
import { makePanel, makeRow } from './panelKit.js';
import { focusMarker } from '../../map/markers.js';
import { describe, operatorOf, modelOf, enrich, enrichMany, onAircraftMeta } from '../../feeds/aircraftMeta.js';

let ui = null;
const state = { filter: 'all', sort: 'alt', query: '' };
let enrichDebounce = null;

const FILTERS = [
  { key: 'all', label: 'ALL',     on: true,  onClick: () => (state.filter = 'all') },
  { key: 'civ', label: 'CIVIL',   on: false, onClick: () => (state.filter = 'civ') },
  { key: 'mil', label: 'MILITARY', on: false, onClick: () => (state.filter = 'mil') },
];
const SORTS = [
  { key: 'alt',  label: 'BY ALT', on: true,  onClick: () => (state.sort = 'alt') },
  { key: 'spd',  label: 'BY SPD', on: false, onClick: () => (state.sort = 'spd') },
  { key: 'call', label: 'A-Z',    on: false, onClick: () => (state.sort = 'call') },
];

export function renderFlightsPanel() {
  if (!ui) {
    ui = makePanel({
      chips: [...FILTERS, ...SORTS],
      searchPlaceholder: 'SEARCH CALLSIGN / ICAO / REG / TYPE',
      refresh: refreshFlightsPanel,
      onSearch: (v) => { state.query = v.toUpperCase(); refreshFlightsPanel(); },
    });
  }
  const body = document.getElementById('rpbody');
  if (body) body.replaceChildren(ui.root);
  refreshFlightsPanel();
}

/** Rows are rebuilt when enrichment lands so new detail appears in place. */
let enrichPending = false;
function onMeta() {
  if (enrichPending) return;
  enrichPending = true;
  setTimeout(() => { enrichPending = false; refreshFlightsPanel(); }, 250);
}
onAircraftMeta(onMeta);

export function refreshFlightsPanel() {
  if (!ui) return;

  const pool = state.filter === 'mil' ? S.militaryFlightData
             : state.filter === 'civ' ? S.flightData
             : [...S.flightData, ...S.militaryFlightData];

  const q = state.query;
  const rows = pool.filter(a => {
    if (!q) return true;
    const meta = describe(a.icao);
    return [a.call, a.icao, a.country, meta?.registration, meta?.model, meta?.typeCode, modelOf(meta), operatorOf(a.call)]
      .some(v => String(v || '').toUpperCase().includes(q));
  });

  rows.sort((a, b) => state.sort === 'alt' ? (b.alt ?? -1) - (a.alt ?? -1)
                  : state.sort === 'spd' ? (b.vel ?? -1) - (a.vel ?? -1)
                  : (a.call || '').localeCompare(b.call || ''));

  ui.listEl.replaceChildren(...rows.slice(0, 300).map(a => {
    const meta = describe(a.icao);
    const model = modelOf(meta);
    const operator = operatorOf(a.call);
    const bits = [a.icao || 'ICAO n/a'];
    if (meta?.registration) bits.push(meta.registration);
    if (model) bits.push(model);
    if (operator) bits.push(operator);

    return makeRow({
      icon: a.mil ? '🎯' : '✈',
      title: a.call || meta?.registration || 'UNKNOWN',
      sub: bits.join(' · ') + (a.alt != null ? ' · ' + num(Math.round(a.alt)) + ' m' : ''),
      value: a.vel != null ? num(a.vel) + ' kn' : '--',
      tag: { text: a.mil ? 'MIL' : 'CIV', cls: a.mil ? 'mil' : 'civ' },
      extraClass: a.mil ? 'mil' : '',
      onClick: () => { focusMarker('military', a.id) || focusMarker('flights', a.id); enrich(a.icao); },
    });
  }));

  if (!rows.length) {
    ui.listEl.replaceChildren(h('div', { class: 'empty', text: 'NO AIRCRAFT MATCH · WAITING FOR LIVE FEED' }));
  }

  // Identify what the user is looking at: queue the visible rows that still
  // lack details. Debounced so typing doesn't flood the lookup queue.
  if (enrichDebounce) clearTimeout(enrichDebounce);
  enrichDebounce = setTimeout(() => {
    enrichDebounce = null;
    enrichMany(rows.slice(0, 40).map(a => a.icao));
  }, 500);

  const known = rows.filter(a => describe(a.icao)?.registration).length;
  ui.setMeta([
    ['SRC', S.flightSource],
    ['TOTAL', num(pool.length)],
    ['ID\'D', num(known) + '/' + num(rows.length)],
  ]);
  setHeaderCount(num(rows.length) + ' / ' + num(pool.length) + ' AC');
}
