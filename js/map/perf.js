/* ══════════════════════════════════════════════════════════════
   PERF GUARD — measures frame time while interacting and adapts
   the clustering policy so 10k+ markers stay smooth.
   ══════════════════════════════════════════════════════════════ */
import { S } from '../state.js';
import { applyClusterPolicy } from './layers.js';

const EVAL_MS = 1000;      // sample window
const SLOW = 26;           // ms/frame — start clustering harder above this
const MID = 18;            // ms/frame — mild boost

export function startPerfGuard(map) {
  if (S.perf.running) return;
  S.perf.running = true;

  map.on('movestart zoomstart', () => { S.perf.moving = true; });
  map.on('moveend zoomend', () => {
    S.perf.moving = false;
    applyClusterPolicy(map.getZoom());
  });

  let last = performance.now();
  let acc = 0, frames = 0;
  let evalAt = last + EVAL_MS;

  const loop = (t) => {
    const dt = t - last;
    last = t;
    acc += dt; frames++;                       // always measure, so the HUD is live

    if (t >= evalAt) {
      if (frames >= 10) {
        const avg = acc / frames;
        S.perf.fps = Math.min(120, Math.round(1000 / Math.max(avg, 1)));
        S.perf.frameMs = Math.round(avg);
        // Adapt whenever the frame budget is blown — including at idle zoom,
        // where too many markers (689 ships + everything else) is exactly the
        // problem. Moving only makes the measurement more reliable.
        const active = S.perf.moving || frames >= 20;
        if (active) {
          S.perf.boost = avg > SLOW ? 1.6 : avg > MID ? 1.25 : 1;
          if (S.perf.boost !== S.perf.applied) {
            S.perf.applied = S.perf.boost;
            applyClusterPolicy(map.getZoom());
          }
        }
      }
      acc = 0; frames = 0; evalAt = t + EVAL_MS;
    }
    S.perf.raf = requestAnimationFrame(loop);
  };
  S.perf.raf = requestAnimationFrame(loop);
}

export function stopPerfGuard() {
  if (S.perf?.raf) cancelAnimationFrame(S.perf.raf);
  S.perf.running = false;
  S.perf.raf = null;
}

/** Quality label for the status line. */
export function perfLabel() {
  if (!S.perf.fps) return 'FPS --';
  const q = S.perf.fps >= 50 ? 'SMOOTH' : S.perf.fps >= 30 ? 'FAIR' : 'HEAVY';
  return `FPS ${S.perf.fps} ${q}`;
}
