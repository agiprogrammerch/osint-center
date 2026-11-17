/* ══════════════════════════════════════════════════════════════
   MAP SHUTDOWN — stops timers started by the map modules so a
   backgrounded (logged-out) app doesn't keep rendering.
   ══════════════════════════════════════════════════════════════ */
import { stopPerfGuard } from './perf.js';
import { stopNight } from './overlays.js';

export function shutdownMap() {
  stopPerfGuard();
  stopNight();
  // overlay/HUD interval + keyboard listeners live in controls.js
  import('./controls.js').then(m => m.stopControlTimers());
}
