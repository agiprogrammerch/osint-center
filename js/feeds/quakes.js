/* ══════════════════════════════════════════════════════════════
   FEED: EARTHQUAKES — USGS real-time GeoJSON (no key)
   Keeps the full property set: PAGER alert, MMI/CDI intensity,
   felt reports, significance, tsunami flag, quality metrics.
   ══════════════════════════════════════════════════════════════ */
import { S, registerMarker, clearMarkers } from '../state.js';
import { ENDPOINTS, REFRESH_MS } from '../config.js';
import { getJSON, h, mkPop, setStat, num, timeSince } from '../utils.js';
import { logEv } from '../ui/eventLog.js';
import { refreshPanel } from '../ui/panels/registry.js';
import { recomputeAlerts } from '../ui/alerts.js';

const ALERT_COLOR = { green: '#00ff41', yellow: '#ffdd00', orange: '#ff8800', red: '#ff2244' };
const ALERT_LABEL = { green: 'GREEN', yellow: 'YELLOW', orange: 'ORANGE', red: 'RED' };

/** mmi/cdi -> a shaking descriptor */
const MMI_TEXT = {
  1: 'Not felt', 2: 'Weak', 3: 'Weak', 4: 'Light', 5: 'Moderate',
  6: 'Strong', 7: 'Very strong', 8: 'Severe', 9: 'Violent', 10: 'Extreme',
};
const mmiText = (mmi) => MMI_TEXT[Math.round(mmi)] || 'Unknown';

export async function fetchQuakes() {
  const token = Symbol(); S.fetchId.quakes = token;
  if (!S.vis.quakes) { S.lock.quakes = false; return; }
  if (S.lock.quakes) return;
  S.lock.quakes = true;
  S.LG.quakes.clearLayers();
  clearMarkers('quakes');

  try {
    const data = await getJSON(ENDPOINTS.quakes + '?_t=' + Date.now(), 15000);
    if (S.fetchId.quakes !== token) { S.lock.quakes = false; return; }
    if (!data) throw new Error('no data');

    const features = data.features || [];
    const quakes = [];

    features.forEach(f => {
      const [lon, lat, dep] = f.geometry.coordinates;
      const p = f.properties;
      const q = {
        id: f.id,
        url: p.url || null,
        lat, lon, depth: dep,
        mag: p.mag,
        magType: p.magType || null,
        place: p.place || 'Unknown',
        time: p.time,
        updated: p.updated || null,
        type: p.type || 'earthquake',
        alert: p.alert || null,
        mmi: p.mmi ?? null,
        cdi: p.cdi ?? null,
        felt: p.felt ?? null,
        tsunami: p.tsunami === 1,
        sig: p.sig ?? null,
        status: p.status || null,
        nst: p.nst ?? null,
        rms: p.rms ?? null,
        gap: p.gap ?? null,
        dmin: p.dmin ?? null,
      };
      quakes.push(q);

      const mag = q.mag ?? 0;
      const col = q.alert ? (ALERT_COLOR[q.alert] || '#ffdd00')
                  : mag >= 6 ? '#ff2244' : mag >= 5 ? '#ff8800' : '#ffdd00';
      const mk = L.circleMarker([lat, lon], {
        radius: Math.max(4, mag * 3.2), color: col, fillColor: col, fillOpacity: .42, weight: 1.5,
      }).bindPopup(mkPop('📳 ' + (p.title || ('M' + mag + ' — ' + q.place)), [
        ['Magnitude', 'M' + mag + (q.magType ? ' (' + q.magType + ')' : '')],
        ['Location', q.place],
        ['Position', lat.toFixed(3) + ', ' + lon.toFixed(3)],
        ['Depth', (dep ?? 0) + ' km'],
        q.alert ? ['PAGER alert', ALERT_LABEL[q.alert] || q.alert] : null,
        q.mmi != null ? ['Max shaking', 'MMI ' + q.mmi.toFixed(1) + ' — ' + mmiText(q.mmi)] : null,
        q.cdi != null ? ['Reported intensity', 'CDI ' + q.cdi.toFixed(1)] : null,
        q.felt ? ['Felt reports', num(q.felt) + ' "Did You Feel It?" reports'] : null,
        q.sig != null ? ['Significance', num(q.sig) + ' / 1000'] : null,
        ['Tsunami', q.tsunami ? 'FLAGGED by USGS' : 'not flagged'],
        ['Event type', q.type + (q.status ? ' · ' + q.status : '')],
        q.nst ? ['Stations', num(q.nst) + ' reporting · gap ' + (q.gap ?? '?') + '° · RMS ' + (q.rms ?? '?')] : null,
        q.dmin != null ? ['Nearest station', num(Math.round(q.dmin * 10) / 10) + '° away'] : null,
        ['Occurred', q.time ? new Date(q.time).toUTCString().replace('GMT', 'UTC') : 'N/A'],
        q.updated ? ['Last updated', timeSince(q.updated)] : null,
        q.url ? [h('b', { text: 'USGS page: ' }), h('a', { href: q.url, target: '_blank', rel: 'noopener', text: q.url.replace('https://', '').slice(0, 44) + '…', style: { color: 'var(--cyn)' } })] : null,
        ['Feed', 'USGS M2.5+ · last 24 h'],
      ].filter(Boolean)));
      registerMarker('quakes', f.id, mk);
      mk.addTo(S.LG.quakes);
      if (mag >= 6) logEv('QUAKE', 'M' + mag + ' — ' + q.place + (q.tsunami ? ' [TSUNAMI FLAG]' : ''));
    });

    S.quakeData = quakes;
    setStat('s-eq', features.length);
    recomputeAlerts();
    const big = quakes.filter(q => (q.mag ?? 0) >= 6).length;
    const tsu = quakes.filter(q => q.tsunami).length;
    logEv('QUAKE', 'USGS: ' + features.length + ' earthquakes M2.5+ last 24h'
      + (big ? ' · ' + big + ' M6+' : '') + (tsu ? ' · ' + tsu + ' tsunami-flagged' : ''));
    refreshPanel('disasters');
  } catch (_) {
    setStat('s-eq', 'ERR');
    logEv('QUAKE', 'USGS seismic feed unavailable — check the local server/proxy');
  }
  S.lock.quakes = false;
}

export const schedQuakes = () =>
  setTimeout(async () => { await fetchQuakes(); schedQuakes(); }, REFRESH_MS.quakes);
