/* ══════════════════════════════════════════════════════════════
   PANEL: DISASTERS — earthquakes (USGS) + natural events (NASA EONET)
   Filters are built from the categories actually present in the data.
   ══════════════════════════════════════════════════════════════ */
import { S } from '../../state.js';
import { h, num, setHeaderCount } from '../../utils.js';
import { makePanel, makeRow } from './panelKit.js';
import { focusMarker } from '../../map/markers.js';
import { EONET_CATS, fmtMagnitude } from '../../feeds/disasters.js';

let ui = null;
const state = { filter: 'all', sort: 'new', query: '' };

/** Filter chips: QUAKES + every EONET category that actually has data. */
function chips() {
  const present = [...new Set(S.fireData.map(e => e.cat))];
  return [
    { key: 'all', label: 'ALL', on: state.filter === 'all', onClick: () => (state.filter = 'all') },
    { key: 'quakes', label: 'QUAKES', on: state.filter === 'quakes', onClick: () => (state.filter = 'quakes') },
    ...present.map(cat => ({
      key: cat,
      label: (EONET_CATS[cat]?.label || 'EVENT').toUpperCase(),
      on: state.filter === cat,
      onClick: () => (state.filter = cat),
    })),
    { key: '__new', label: 'NEWEST', on: state.sort === 'new', onClick: () => (state.sort = 'new') },
    { key: '__mag', label: 'STRONGEST', on: state.sort === 'mag', onClick: () => (state.sort = 'mag') },
  ];
}

export function renderDisasterPanel() {
  if (!ui) {
    ui = makePanel({
      searchPlaceholder: 'SEARCH EVENT / LOCATION',
      refresh: refreshDisasterPanel,
      onSearch: (v) => { state.query = v.toUpperCase(); refreshDisasterPanel(); },
    });
  }
  ui.setChips(buildChipNodes());   // category set can change between refreshes
  const body = document.getElementById('rpbody');
  if (body) body.replaceChildren(ui.root);
  refreshDisasterPanel();
}

function buildChipNodes() {
  return chips().map(c => h('button', {
    class: 'chip' + (c.on ? ' on' : ''),
    text: c.label,
    onclick: () => {
      if (c.key === '__new') state.sort = 'new';
      else if (c.key === '__mag') state.sort = 'mag';
      else state.filter = c.key;
      refreshDisasterPanel();
    },
  }));
}

/** Normalised view over both feeds. */
function merged() {
  const quakes = S.quakeData.map(x => ({
    feed: 'quakes', id: x.id, cat: 'quakes',
    icon: '📳',
    title: 'M' + (x.mag ?? '?') + ' — ' + (x.place || 'Unknown'),
    sub: `${x.type || 'earthquake'}${x.magType ? ' (' + x.magType + ')' : ''} · depth ${x.depth != null ? Math.round(x.depth) + ' km' : '?'}`
        + `${x.lat.toFixed(1)}, ${x.lon.toFixed(1)}`,
    value: x.mmi != null ? 'MMI ' + x.mmi.toFixed(1) : (x.felt ? num(x.felt) + ' felt' : '--'),
    tag: { text: x.tsunami ? 'TSUNAMI' : (x.alert || '').toUpperCase() || 'QUAKE',
           cls: x.tsunami || x.alert === 'red' || x.alert === 'orange' ? 'bad'
              : x.alert === 'yellow' ? 'warn' : 'ok' },
    mag: x.mag ?? 0, ts: x.time || 0, url: x.url,
  }));
  const events = S.fireData.map(x => {
    const meta = EONET_CATS[x.cat] || { i: '⚠', label: 'NATURAL EVENT' };
    const mag = fmtMagnitude(x.mag, x.magUnit);
    return {
      feed: 'fires', id: x.id, cat: x.cat,
      icon: meta.i,
      title: x.title,
      sub: `${x.catLabel}${x.positions > 1 ? ' · ' + x.positions + ' positions' : ''} · ${x.lat.toFixed(1)}, ${x.lon.toFixed(1)}`,
      value: mag ? mag.split(' (')[0] : '--',
      tag: { text: (x.sources[0]?.id || 'EONET').slice(0, 10), cls: 'warn' },
      mag: x.mag || 0, ts: x.date ? new Date(x.date).getTime() : Date.now(), url: x.sources[0]?.url,
    };
  });
  return [...quakes, ...events];
}

export function refreshDisasterPanel() {
  if (!ui) return;
  const q = state.query;
  const rows = merged().filter(r =>
    (state.filter === 'all' || r.cat === state.filter) &&
    (!q || (r.title + ' ' + r.sub).toUpperCase().includes(q)));

  rows.sort((a, b) => state.sort === 'mag' ? (b.mag - a.mag) || (b.ts - a.ts) : b.ts - a.ts);

  const shown = rows.slice(0, 250);
  ui.listEl.replaceChildren(...shown.map(r => makeRow({
    icon: r.icon, title: r.title, sub: r.sub, value: r.value,
    tag: r.tag, extraClass: r.tag.cls === 'bad' ? 'mil' : '',
    onClick: () => focusMarker(r.feed, r.id),
  })));

  if (!shown.length) {
    ui.listEl.replaceChildren(h('div', { class: 'empty', text: 'NO EVENTS MATCH · FEEDS PENDING' }));
  }

  const quakes = S.quakeData.length, events = S.fireData.length;
  ui.setMeta([
    ['QUAKES', num(quakes) + ' (USGS)'],
    ['EVENTS', num(events) + ' (EONET)'],
    ['SHOWN', num(shown.length)],
  ]);
  setHeaderCount(num(shown.length) + ' events');
}
