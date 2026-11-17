/* ══════════════════════════════════════════════════════════════
   FEED: CONFLICT ZONES — curated static OSINT baseline
   (The GDELT geo endpoint this app previously used is retired —
    it returns 404/429, so only verified data is drawn.)
   ══════════════════════════════════════════════════════════════ */
import { S, registerMarker } from '../state.js';
import { CF_ZONES, CF_COLOR, CF_SIZE } from '../data/statics.js';
import { mkPop, setStat } from '../utils.js';
import { logEv } from '../ui/eventLog.js';
import { refreshPanel } from '../ui/panels/registry.js';
import { recomputeAlerts } from '../ui/alerts.js';

export async function fetchConflicts() {
  const token = Symbol(); S.fetchId.conflicts = token;
  if (!S.vis.conflicts) { S.lock.conflicts = false; return; }
  if (S.lock.conflicts) return;
  S.lock.conflicts = true;
  S.LG.conflicts.clearLayers();
  S.markers.conflicts?.clear();

  CF_ZONES.forEach(z => {
    const col = CF_COLOR[z.l];
    const mk = L.circleMarker([z.lat, z.lon], {
      radius: CF_SIZE[z.l], color: col, fillColor: col, fillOpacity: .45, weight: 2,
    }).bindPopup(mkPop('CONFLICT ZONE', [
      ['Zone', z.n], ['Countries', z.cc], ['Intensity', z.l], ['Source', 'Curated OSINT baseline'],
    ]));
    registerMarker('conflicts', z.n, mk);
    mk.addTo(S.LG.conflicts);
    if (z.l === 'CRITICAL') logEv('WAR', 'CRITICAL: ' + z.n + ' [' + z.cc + ']');
  });

  setStat('s-cf', CF_ZONES.length);
  recomputeAlerts();
  logEv('WAR', 'Conflict baseline: ' + CF_ZONES.length + ' monitored zones');
  refreshPanel('overview');
  S.lock.conflicts = false;
}
