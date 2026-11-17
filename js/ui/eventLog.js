/* ══════════════════════════════════════════════════════════════
   EVENT LOG — sidebar activity feed + ticker mirror
   ══════════════════════════════════════════════════════════════ */
import { S } from '../state.js';
import { h, utcClock, setStat } from '../utils.js';
import { addTickerItem, rebuildTicker } from './ticker.js';

const TAGS = {
  WAR: 'gw', QUAKE: 'gd2', FIRE: 'gd2', CYBER: 'gc', NAV: 'gn',
  AIR: 'gd2', MIL: 'gm2', NEWS: 'gm2', SAT: 'ga', SYS: 'gs', CAM: 'gs',
};

export function logEv(type, desc) {
  S.evN++;
  setStat('ev-n', S.evN + ' EVENTS');

  const row = h('div', { class: 'ev' }, [
    h('span', { class: 'ev-t', text: utcClock() }),
    h('span', { class: 'ev-g ' + (TAGS[type] || 'gm2'), text: type }),
    h('span', { class: 'ev-d', text: desc }),
  ]);

  const log = document.getElementById('evlog');
  if (!log) return;
  log.insertBefore(row, log.firstChild);
  while (log.children.length > 80) log.removeChild(log.lastChild);

  const tickType = type === 'WAR' ? 'r'
    : (type === 'AIR' || type === 'SAT' || type === 'QUAKE' || type === 'FIRE' || type === 'SYS' || type === 'CAM') ? 'y'
    : 'g';
  addTickerItem('[' + type + '] ' + desc, tickType);
  rebuildTicker();
}
