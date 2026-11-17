/* ══════════════════════════════════════════════════════════════
   ALERTS — alert count is DERIVED from current data, never
   accumulated, so repeated refreshes can't inflate it.
   ══════════════════════════════════════════════════════════════ */
import { S } from '../state.js';
import { CF_ZONES } from '../data/statics.js';
import { upAlerts } from '../utils.js';

export function recomputeAlerts() {
  const bigQuakes = S.quakeData.filter(q => q.mag >= 6).length;
  const criticalZones = CF_ZONES.filter(z => z.l === 'CRITICAL').length;
  S.alerts = bigQuakes + criticalZones;
  upAlerts();
  return S.alerts;
}
