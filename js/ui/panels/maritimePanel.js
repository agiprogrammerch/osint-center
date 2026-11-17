/* ══════════════════════════════════════════════════════════════
   PANEL: MARITIME — live AIS vessels -> map focus
   Rows carry name, type, flag, speed and destination; clicking a row
   opens the full detail popup on the map.
   ══════════════════════════════════════════════════════════════ */
import { S } from '../../state.js';
import { h, num, setHeaderCount } from '../../utils.js';
import { makePanel, makeRow, makeSummary } from './panelKit.js';
import { focusMarker } from '../../map/markers.js';

let ui = null;
let summaryEl = null;
const state = { filter: 'all', sort: 'name', query: '' };

const FILTERS = [
  { key: 'all',      label: 'ALL',       on: true,  onClick: () => (state.filter = 'all') },
  { key: 'military', label: 'MILITARY',  on: false, onClick: () => (state.filter = 'military') },
  { key: 'moving',   label: 'UNDER WAY', on: false, onClick: () => (state.filter = 'moving') },
  { key: '80',       label: 'TANKERS',   on: false, onClick: () => (state.filter = '80') },
  { key: '70',       label: 'CARGO',     on: false, onClick: () => (state.filter = '70') },
  { key: '60',       label: 'PASSENGER', on: false, onClick: () => (state.filter = '60') },
  { key: '30',       label: 'FISHING',   on: false, onClick: () => (state.filter = '30') },
];
const SORTS = [
  { key: 'name', label: 'A-Z',     on: true,  onClick: () => (state.sort = 'name') },
  { key: 'spd',  label: 'FASTEST', on: false, onClick: () => (state.sort = 'spd') },
  { key: 'type', label: 'BY TYPE', on: false, onClick: () => (state.sort = 'type') },
];

export function renderShipPanel() {
  if (!ui) {
    ui = makePanel({
      chips: [...FILTERS, ...SORTS],
      searchPlaceholder: 'SEARCH NAME / MMSI / IMO / DEST / FLAG',
      refresh: refreshShipPanel,
      onSearch: (v) => { state.query = v.toUpperCase(); refreshShipPanel(); },
    });
    summaryEl = makeSummary([]);
    ui.root.insertBefore(summaryEl, ui.metaEl);
  }
  const body = document.getElementById('rpbody');
  if (body) body.replaceChildren(ui.root);
  refreshShipPanel();
}

function rows() {
  const q = state.query;
  let list = S.vesselObjects.filter(v => {
    if (state.filter === 'military' && !v.military) return false;
    if (state.filter === 'moving' && !(v.sog != null && v.sog > 0.5)) return false;
    if (state.filter !== 'all' && state.filter !== 'military' && state.filter !== 'moving'
        && String(v.shipType) !== state.filter) return false;
    if (!q) return true;
    return [v.name, v.mmsi, v.imo, v.destination, v.flag, v.callsign, v.type?.label]
      .some(x => String(x ?? '').toUpperCase().includes(q));
  });
  list.sort((a, b) =>
    state.sort === 'spd' ? (b.sog ?? -1) - (a.sog ?? -1)
    : state.sort === 'type' ? (a.type?.label || '').localeCompare(b.type?.label || '')
    : (a.name || 'UNKNOWN').localeCompare(b.name || 'UNKNOWN'));
  return list;
}

export function refreshShipPanel() {
  if (!ui) return;
  const list = rows().slice(0, 300);

  ui.listEl.replaceChildren(...list.map(v => makeRow({
    icon: v.military ? '🚨' : (v.type?.icon || '🚢'),
    title: (v.name || 'UNKNOWN') + (v.military ? ' ⟫ MIL' : ''),
    sub: [v.type?.label, v.flag, v.mmsi].filter(Boolean).join(' · ')
       + (v.destination ? ' → ' + v.destination : ''),
    value: v.sog != null ? v.sog.toFixed(1) + ' kn' : '--',
    tag: v.military ? { text: 'MIL', cls: 'bad' }
                    : (v.navStat === 1 || v.navStat === 5 ? { text: 'PORT', cls: 'ok' } : { text: 'SEA', cls: 'warn' }),
    extraClass: v.military ? 'mil' : '',
    onClick: () => focusMarker('ships', v.id),
  })));

  if (!list.length) {
    ui.listEl.replaceChildren(h('div', { class: 'empty', text: 'NO VESSELS MATCH · AIS FEED PENDING' }));
  }

  const mil = S.vesselObjects.filter(v => v.military).length;
  const moving = S.vesselObjects.filter(v => v.sog != null && v.sog > 0.5).length;
  summaryEl.replaceChildren(...[
    ['VESSELS', num(S.vesselObjects.length)],
    ['MIL/GOV', num(mil)],
    ['UNDER WAY', num(moving)],
  ].map(([k, v]) => h('span', { class: 'pnum', text: k + ' ' + v })));

  ui.setMeta([
    ['SRC', S.shipSource],
    ['SHOWN', num(list.length)],
    ['COVERAGE', S.aisBounds ? 'Baltic (AIS)' : 'n/a'],
  ]);
  setHeaderCount(num(S.vesselObjects.length) + ' vessels');
}
