/* ══════════════════════════════════════════════════════════════
   FEED: LIVE CYBER ATTACKS — SANS ISC / DShield + ip-api.com
   Real telemetry, free, no keys:
     origin  -> attacking IP (geolocated: country, city, AS)
     type    -> the services actually under attack (top targeted ports)
     target  -> DShield sensor network (distinct target counts per port)
     time    -> first/last seen per origin, plus the feed date
   Origins are drawn as pulsing markers; results are cached per IP.
   ══════════════════════════════════════════════════════════════ */
import { S, registerMarker, clearMarkers } from '../state.js';
import { ENDPOINTS, REFRESH_MS } from '../config.js';
import { getJSON, postViaProxy, mkPop, setStat, num, timeSince } from '../utils.js';
import { logEv } from '../ui/eventLog.js';
import { refreshPanel } from '../ui/panels/registry.js';

const GEO_KEY = 'voidmatrix_ipgeo';
const ATTACK_LIMIT = 60;       // origins drawn/listed
const PORT_LIMIT = 12;

/** targeted port -> service name (what is being attacked) */
export const PORT_SERVICE = {
  22: 'SSH', 23: 'Telnet', 25: 'SMTP', 53: 'DNS', 80: 'HTTP', 110: 'POP3',
  123: 'NTP', 143: 'IMAP', 161: 'SNMP', 443: 'HTTPS', 445: 'SMB', 465: 'SMTPS',
  502: 'Modbus', 593: 'RPC', 993: 'IMAPS', 995: 'POP3S', 1433: 'MSSQL',
  1883: 'MQTT', 2000: 'MikroTik', 3306: 'MySQL', 3389: 'RDP', 4899: 'Radmin',
  5060: 'SIP', 5432: 'PostgreSQL', 5555: 'ADB', 5900: 'VNC', 6379: 'Redis',
  7547: 'TR-069', 8000: 'HTTP-alt', 8080: 'HTTP-proxy', 8291: 'Winbox',
  8443: 'HTTPS-alt', 9000: 'Webmin', 9100: 'Printer', 9200: 'Elasticsearch',
  7680: 'Windows Update', 53140: 'IoT', 51413: 'UPnP',
  27017: 'MongoDB', 11211: 'Memcached',
};
const serviceOf = (port) => PORT_SERVICE[port] || 'port ' + port;

/* ── IP geolocation cache (free tier is rate-limited) ── */
let geoCache = loadGeo();
function loadGeo() {
  try { return JSON.parse(localStorage.getItem(GEO_KEY) || '{}') || {}; } catch (_) { return {}; }
}
function persistGeo() {
  try {
    const now = Date.now();
    const out = {};
    for (const [k, v] of Object.entries(geoCache)) if (v.fetchedAt && now - v.fetchedAt < 30 * 86400000) out[k] = v;
    localStorage.setItem(GEO_KEY, JSON.stringify(out));
  } catch (_) { /* storage full or disabled */ }
}

async function geolocate(ips) {
  const unknown = ips.filter(ip => !geoCache[ip] || geoCache[ip].miss);
  if (unknown.length) {
    // ip-api accepts up to 100 IPs per request
    for (let i = 0; i < unknown.length; i += 100) {
      const batch = unknown.slice(i, i + 100);
      // ip-api accepts up to 100 IPs per request; HTTPS batch is pro-only,
      // so try https first and fall back to plain http.
      const endpoints = ['https://ip-api.com/batch', 'http://ip-api.com/batch'];
      let done = false;
      for (const ep of endpoints) {
        try {
          const rows = await postViaProxy({
            url: ep, method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(batch),
          });
          (Array.isArray(rows) ? rows : []).forEach(r => {
            if (r?.status === 'success' && r.query) {
              geoCache[r.query] = {
                lat: r.lat, lon: r.lon, country: r.country, countryCode: r.countryCode,
                city: r.city, isp: r.isp, org: r.org, as: r.as, fetchedAt: Date.now(),
              };
            } else if (r?.query) {
              geoCache[r.query] = { miss: true, fetchedAt: Date.now() };
            }
          });
          done = true;
          break;
        } catch (_) { /* try the other transport */ }
      }
      if (done) persistGeo();
    }
  }
  return ips.map(ip => ({ ip, geo: geoCache[ip]?.miss ? null : (geoCache[ip] || null) }));
}

/** Origins without usable geolocation are simply dropped (see .filter below). */
const today = () => new Date().toISOString().split('T')[0];

export async function fetchCyberAttacks() {
  const token = Symbol(); S.fetchId.attacks = token;
  if (S.lock.attacks) return;
  S.lock.attacks = true;

  let origins = [];
  let ports = [];
  let src = 'SANS ISC / DShield';

  try {
    const [sources, portRows] = await Promise.all([
      getJSON(ENDPOINTS.iscSources(ATTACK_LIMIT, today()), 15000),
      getJSON(ENDPOINTS.iscTopPorts(PORT_LIMIT, today()), 15000),
    ]);
    if (S.fetchId.attacks !== token) { S.lock.attacks = false; return; }
    origins = Array.isArray(sources) ? sources : [];
    ports = Object.values(portRows || {})
      .filter(p => p && p.targetport != null)
      .map(p => ({
        port: p.targetport, service: serviceOf(p.targetport),
        records: p.records || 0, targets: p.targets || 0, sources: p.sources || 0,
      }));
    if (!origins.length) throw new Error('no attack sources');
  } catch (e) {
    if (S.fetchId.attacks !== token) { S.lock.attacks = false; return; }
    logEv('CYBER', 'DShield attack feed unavailable (' + (e && e.message ? e.message : e) + ') — showing botnet C2 indicators only');
    S.attackData = [];
    S.portData = [];
    renderAttackMarkers();
    refreshPanel('cyber');
    S.lock.attacks = false;
    return;
  }

  const geo = await geolocate(origins.map(o => o.ip));
  if (S.fetchId.attacks !== token) { S.lock.attacks = false; return; }

  S.attackData = geo.map(({ ip, geo: g }) => {
    const o = origins.find(x => x.ip === ip) || {};
    return {
      id: 'atk:' + ip,
      ip, geo: g,
      lat: g?.lat ?? null, lon: g?.lon ?? null,
      attacks: o.attacks || 0, records: o.count || 0,
      firstSeen: o.firstseen || null, lastSeen: o.lastseen || null,
      as: g?.as || null,
      place: g ? [g.city, g.country].filter(Boolean).join(', ') : null,
      // top targeted services at this moment (real, global)
      topTargets: ports.slice(0, 4),
    };
  }).filter(a => a.lat != null && a.lon != null);

  S.portData = ports;
  S.attackSource = src + ' · ' + today();

  renderAttackMarkers();

  const totalAttacks = S.attackData.reduce((n, a) => n + a.attacks, 0);
  setStat('s-cy', num(S.attackData.length + S.cyberData.length));
  logEv('CYBER', 'DShield: ' + num(S.attackData.length) + ' attack origins · ' + num(totalAttacks) + ' events today'
    + ' · most attacked: ' + (ports[0] ? ports[0].service : 'n/a'));
  refreshPanel('cyber');
  S.lock.attacks = false;
}

/** Pulsing origin markers (mixed into the cyber layer with the C2 indicators). */
function renderAttackMarkers() {
  clearMarkers('attacks');
  // only clear markers we own: remove attack markers, keep C2 markers
  S.CG.cyber.eachLayer(m => { if (m.__isAttack) S.CG.cyber.removeLayer(m); });

  const max = Math.max(1, ...S.attackData.map(a => a.attacks));
  S.attackData.forEach(a => {
    const t = a.attacks / max;
    const col = t > 0.66 ? '#ff2244' : t > 0.33 ? '#ff8800' : '#ffdd00';
    const mk = L.marker([a.lat, a.lon], { icon: mkAttackIcon(col, t) });
    mk.__isAttack = true;
    mk.bindPopup(() => attackPopup(a));
    registerMarker('attacks', a.id, mk);
    mk.addTo(S.CG.cyber);
  });
}

/** origin marker: pulsing ring sized by attack volume */
function mkAttackIcon(col, t) {
  const size = 10 + Math.round(t * 10);
  return L.divIcon({
    className: 'atk-pin',
    html: `<span class="atk-ring" style="border-color:${col};width:${size}px;height:${size}px"></span>`
        + `<span class="atk-dot" style="background:${col};width:${Math.round(size * 0.45)}px;height:${Math.round(size * 0.45)}px"></span>`,
    iconSize: [size, size], iconAnchor: [size / 2, size / 2], popupAnchor: [0, -size / 2],
  });
}

export function attackPopup(a) {
  const rows = [
    ['Origin IP', a.ip],
    a.place ? ['Location', a.place] : null,
    ['Coordinates', a.lat.toFixed(3) + ', ' + a.lon.toFixed(3)],
    a.as ? ['Network', a.as] : null,
    a.geo?.isp ? ['ISP', a.geo.isp] : null,
    ['Attack events', num(a.attacks)],
    ['Records / packets', num(a.records)],
    ['First reported', a.firstSeen || 'n/a'],
    ['Last reported', a.lastSeen ? a.lastSeen + ' (' + timeSince(a.lastSeen + 'T00:00:00Z') + ')' : 'n/a'],
    a.topTargets.length ? ['Targeted now', a.topTargets.map(p => p.service).join(', ')] : null,
    a.topTargets.length ? ['Targets hit', a.topTargets.map(p => p.service + ' ' + num(p.targets)).join(' · ')] : null,
    ['Target infrastructure', 'SANS ISC / DShield sensor network (honeypots)'],
    ['Source', S.attackSource || 'SANS ISC'],
  ];
  return mkPop('🎯 ATTACK ORIGIN · ' + a.ip, rows.filter(Boolean));
}

export const schedAttacks = () =>
  setTimeout(async () => { await fetchCyberAttacks(); schedAttacks(); }, REFRESH_MS.cyber);
