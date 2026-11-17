/* ══════════════════════════════════════════════════════════════
   FEED: NATURAL DISASTERS — NASA EONET (no key)
   One request returns every open event with its real category,
   description, source link and a dated magnitude history
   (burned acres for wildfires, wind speed for storms, ...).
   Falls back to per-category requests if the bulk endpoint fails.
   ══════════════════════════════════════════════════════════════ */
import { S, registerMarker, clearMarkers } from '../state.js';
import { ENDPOINTS, REFRESH_MS } from '../config.js';
import { getJSON, h, mkIcon, mkPop, setStat, num } from '../utils.js';
import { logEv } from '../ui/eventLog.js';
import { refreshPanel } from '../ui/panels/registry.js';

/** Icon/colour per EONET category id (unknown ids get a generic marker). */
export const EONET_CATS = {
  wildfires:    { i: '🔥', c: '#ff6600', label: 'WILDFIRE' },
  severeStorms: { i: '🌀', c: '#aaddff', label: 'SEVERE STORM' },
  volcanoes:    { i: '🌋', c: '#ff4400', label: 'VOLCANO' },
  floods:       { i: '💧', c: '#4488ff', label: 'FLOOD' },
  seaLakeIce:   { i: '🧊', c: '#88ddff', label: 'SEA / LAKE ICE' },
  landslides:   { i: '⛰', c: '#ffaa00', label: 'LANDSLIDE' },
  drought:      { i: '🌵', c: '#ffdd00', label: 'DROUGHT' },
  earthquakes:  { i: '📳', c: '#ff2244', label: 'EARTHQUAKE' },
  tempExtremes: { i: '🌡', c: '#ff4466', label: 'TEMPERATURE EXTREME' },
  waterColor:   { i: '🎨', c: '#00eeff', label: 'WATER COLOUR' },
  manmade:      { i: '🏭', c: '#aaaaaa', label: 'MAN-MADE' },
};
const GENERIC_CAT = { i: '⚠', c: '#ff8800', label: 'NATURAL EVENT' };

const catOf = (id) => EONET_CATS[id] || GENERIC_CAT;

/** Human-readable magnitude: acres -> acres + km², kts -> knots + km/h, … */
export function fmtMagnitude(value, unit) {
  if (value == null || !unit) return null;
  const v = Number(value);
  if (unit === 'acres')  return num(v) + ' acres (' + num(Math.round(v * 0.00404686)) + ' km²) burned';
  if (unit === 'kts')    return num(v) + ' kn (' + num(Math.round(v * 1.852)) + ' km/h)';
  if (unit === 'NM^2')   return num(v) + ' NM² (' + num(Math.round(v * 3.4299)) + ' km²)';
  if (unit === 'km^2')   return num(v) + ' km²';
  return num(v) + ' ' + unit;
}

/** Latest geometry entry = current position; the rest is the event's track. */
function latestGeometry(geo = []) {
  const points = geo.filter(g => g.coordinates && g.coordinates.length >= 2);
  if (!points.length) return null;
  return points.slice().sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))[0];
}

function toRecord(ev) {
  const cats = ev.categories || [];
  const catId = cats[0]?.id || 'other';
  const geo = ev.geometry || [];
  const latest = latestGeometry(geo);
  if (!latest) return null;
  const [lon, lat] = latest.coordinates;
  const track = geo
    .filter(g => g.coordinates && g.coordinates.length >= 2)
    .sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0))
    .map(g => ({ lat: g.coordinates[1], lon: g.coordinates[0], date: g.date, mag: g.magnitudeValue, unit: g.magnitudeUnit }));
  return {
    id: ev.id,
    cat: catId,
    catLabels: cats.map(c => c.title),
    catLabel: cats[0]?.title || GENERIC_CAT.label,
    title: ev.title,
    description: ev.description || null,
    sources: (ev.sources || []).map(s => ({ id: s.id, url: s.url })),
    link: ev.link,
    lat, lon,
    date: latest.date || null,
    mag: latest.magnitudeValue ?? null,
    magUnit: latest.magnitudeUnit ?? null,
    positions: track.length,
    track,
  };
}

export async function fetchFires() {
  const token = Symbol(); S.fetchId.fires = token;
  if (!S.vis.fires) { S.lock.fires = false; return; }
  if (S.lock.fires) return;
  S.lock.fires = true;
  S.LG.fires.clearLayers();
  clearMarkers('fires');

  let events = [];
  let src = 'NASA EONET';

  try {
    const data = await getJSON(ENDPOINTS.eonetAll, 20000);
    if (S.fetchId.fires !== token) { S.lock.fires = false; return; }
    if (!data?.events) throw new Error('bad payload');
    events = data.events.map(toRecord).filter(Boolean);
  } catch (_) {
    // fallback: per-category requests (older, slower path)
    const lists = await Promise.allSettled(Object.keys(EONET_CATS).map(async catId => {
      try {
        const d = await getJSON(ENDPOINTS.eonet(catId, 40), 20000);
        if (S.fetchId.fires !== token) return [];
        return (d?.events || []).map(ev => {
          const r = toRecord({ ...ev, categories: ev.categories?.length ? ev.categories : [{ id: catId, title: catOf(catId).label }] });
          return r;
        }).filter(Boolean);
      } catch (_) { return []; }
    }));
    if (S.fetchId.fires !== token) { S.lock.fires = false; return; }
    const seen = new Set();
    lists.forEach(l => (l.value || []).forEach(ev => {
      if (seen.has(ev.id)) return;
      seen.add(ev.id); events.push(ev);
    }));
  }

  if (!events.length) {
    setStat('s-fi', 'ERR');
    logEv('FIRE', 'NASA EONET unavailable — no open natural events returned');
    S.lock.fires = false;
    return;
  }

  S.fireData = events;
  S.fireSource = src;

  events.forEach(ev => {
    const meta = catOf(ev.cat);
    const mag = fmtMagnitude(ev.mag, ev.magUnit);

    // movement/evolution track (cyclones, migrating ice edges, …)
    if (ev.track.length > 1) {
      L.polyline(ev.track.map(p => [p.lat, p.lon]), {
        color: meta.c, weight: 1.4, opacity: 0.55, dashArray: '4,4', interactive: false,
      }).addTo(S.LG.fires);
    }

    const mk = L.marker([ev.lat, ev.lon], { icon: mkIcon(meta.i, meta.c, 16) })
      .bindPopup(mkPop(meta.i + ' ' + ev.title, [
        ['Category', ev.catLabel + (ev.catLabels.length > 1 ? ' (+' + (ev.catLabels.length - 1) + ')' : '')],
        ['Position', ev.lat.toFixed(3) + ', ' + ev.lon.toFixed(3)],
        mag ? ['Magnitude', mag] : null,
        ['Reported', ev.date ? new Date(ev.date).toUTCString().replace('GMT', 'UTC') : 'Active'],
        ev.description ? ['Description', ev.description] : null,
        ['Positions tracked', ev.positions + (ev.positions > 1 ? ' (track drawn)' : '')],
        ['Source', ev.sources.map(s => s.id).join(', ') || 'NASA EONET'],
        ev.sources[0]?.url ? [h('b', { text: 'Link: ' }), h('a', { href: ev.sources[0].url, target: '_blank', rel: 'noopener', text: ev.sources[0].url.slice(0, 46) + '…', style: { color: 'var(--cyn)' } })] : null,
        ['Feed', 'NASA EONET (open events)'],
      ].filter(Boolean)));
    registerMarker('fires', ev.id, mk);
    mk.addTo(S.LG.fires);
  });

  const breakdown = {};
  events.forEach(e => { breakdown[e.catLabel] = (breakdown[e.catLabel] || 0) + 1; });
  setStat('s-fi', events.length);
  logEv('FIRE', 'NASA EONET: ' + events.length + ' open events — '
    + Object.entries(breakdown).map(([k, v]) => v + ' ' + k.toLowerCase()).join(' · '));
  refreshPanel('disasters');
  S.lock.fires = false;
}

export const schedFires = () =>
  setTimeout(async () => { await fetchFires(); schedFires(); }, REFRESH_MS.fires);
