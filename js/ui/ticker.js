/* ══════════════════════════════════════════════════════════════
   TICKER — scrolling headline strip
   ══════════════════════════════════════════════════════════════ */
import { S } from '../state.js';
import { h } from '../utils.js';

let seeded = false;
export function initTicker() {
  if (seeded) return;
  seeded = true;
  addTickerItem('VOID//MATRIX ONLINE — ALL SYSTEMS NOMINAL', 'g');
  addTickerItem('MONITORING GLOBAL COMMUNICATIONS...', 'g');
  addTickerItem('OSINT DATA REFRESH CYCLE ACTIVE', 'y');
  rebuildTicker();
}

export function addTickerItem(text, type) {
  S.tickerItems.push({ text, type });
  if (S.tickerItems.length > 25) S.tickerItems.shift();
}

let rebuildTimer = null;

/** Rebuilds at most once per 2s so bursts of events don't restart the animation. */
export function rebuildTicker() {
  if (rebuildTimer) return;
  rebuildTimer = setTimeout(() => {
    rebuildTimer = null;
    doRebuild();
  }, 2000);
}

function doRebuild() {
  const inner = document.getElementById('t-inner');
  const dup = document.getElementById('t-inner-dup');
  const outer = document.getElementById('t-outer');
  if (!inner || !dup || !outer) return;
  const build = () => S.tickerItems.map(i =>
    h('span', { class: i.type === 'r' ? 'tr' : i.type === 'y' ? 'ty' : '', text: i.text }));
  inner.replaceChildren(...build());
  dup.replaceChildren(...build());
  outer.classList.remove('running');
  void outer.offsetWidth;             // force reflow to restart animation
  outer.classList.add('running');
}
