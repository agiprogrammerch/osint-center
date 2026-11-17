/* ══════════════════════════════════════════════════════════════
   FEED: CYBER — abuse.ch Feodo Tracker botnet C2 blocklist (no key)
   ══════════════════════════════════════════════════════════════ */
import { S, registerMarker, clearMarkers } from '../state.js';
import { ENDPOINTS, REFRESH_MS, LIMITS } from '../config.js';
import { getJSON, mkIcon, mkPop, setStat, num } from '../utils.js';
import { CC_MAP, FB_CYBERS } from '../data/statics.js';
import { logEv } from '../ui/eventLog.js';
import { refreshPanel } from '../ui/panels/registry.js';
import { fetchCyberAttacks } from './cyberAttacks.js';

export async function fetchCyber() {
  const token = Symbol(); S.fetchId.cyber = token;
  if (!S.vis.cyber) { S.lock.cyber = false; return; }
  if (S.lock.cyber) return;
  S.lock.cyber = true;
  S.CG.cyber.clearLayers();
  clearMarkers('cyber');

  let entries = [];
  let source = 'Feodo Tracker (live)';
  try {
    const data = await getJSON(ENDPOINTS.cyber);
    if (S.fetchId.cyber !== token) { S.lock.cyber = false; return; }
    if (Array.isArray(data) && data.length) {
      entries = data.slice(0, LIMITS.cyberMarkers);
    } else {
      throw new Error('empty blocklist');
    }
  } catch (_) {
    entries = FB_CYBERS;
    source = 'Fallback IOC set (Feodo unreachable)';
    logEv('CYBER', 'Feodo Tracker unavailable — using fallback IOC set');
  }

  const seen = new Set();
  const recs = [];
  entries.forEach(e => {
    const cc = (e.country || 'XX').toUpperCase();
    const coord = CC_MAP[cc];
    if (!coord) return;
    const id = cc + '|' + (e.ip_address || 'unknown');
    if (seen.has(id)) return;           // de-duplicate identical indicators
    seen.add(id);

    const rec = {
      ...e,
      id,
      country: cc,
      lat: coord[0] + (Math.random() - .5) * 1.5,
      lon: coord[1] + (Math.random() - .5) * 1.5,
    };
    recs.push(rec);

    const mk = L.marker([rec.lat, rec.lon], { icon: mkIcon('💻', '#00eeff', 12) })
      .bindPopup(mkPop('BOTNET C2 SERVER', [
        ['IP', e.ip_address || 'N/A'],
        ['Malware', e.malware || 'C2'],
        ['Country', cc],
        ['ASN', e.as_name || 'N/A'],
        ['Status', (e.status || 'unknown').toUpperCase()],
        ['Source', source],
      ]));
    registerMarker('cyber', id, mk);
    mk.addTo(S.CG.cyber);
  });

  S.cyberData = recs;
  S.cyberSource = source;
  setStat('s-cy', entries.length);
  logEv('CYBER', source + ': ' + num(entries.length) + ' botnet C2 indicators');
  refreshPanel('cyber');
  S.lock.cyber = false;
}

export const schedCyber = () =>
  setTimeout(async () => { await fetchCyber(); schedCyber(); }, REFRESH_MS.cyber);

/** Attack telemetry (DShield) runs alongside the C2 blocklist. */
export const schedAttacks = () =>
  setTimeout(async () => { await fetchCyberAttacks(); schedAttacks(); }, REFRESH_MS.cyber);
