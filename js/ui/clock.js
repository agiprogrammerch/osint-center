/* ══════════════════════════════════════════════════════════════
   CLOCK — UTC header clock + stats timestamp
   ══════════════════════════════════════════════════════════════ */
import { utcClock } from '../utils.js';

let running = false;
export function initClock() {
  if (running) return;
  running = true;
  const tick = () => {
    const t = utcClock();
    document.getElementById('utc').textContent = t + ' UTC';
    document.getElementById('stats-ts').textContent = t.slice(0, 5);
    document.getElementById('sb-r').textContent =
      'VOIDMATRIX // ' + new Date().toISOString().split('T')[0];
  };
  tick();
  setInterval(tick, 1000);
}
