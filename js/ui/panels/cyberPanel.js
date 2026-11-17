/* ══════════════════════════════════════════════════════════════
   PANEL: CYBER — live attack origins (DShield) + botnet C2 indicators
   Each row: origin, where it is, what it is attacking, how much, when.
   ══════════════════════════════════════════════════════════════ */
import { S } from '../../state.js';
import { h, num, setHeaderCount, timeSince } from '../../utils.js';
import { makePanel, makeRow, makeSummary } from './panelKit.js';
import { focusMarker } from '../../map/markers.js';
import { attackPopup, PORT_SERVICE } from '../../feeds/cyberAttacks.js';

let ui = null;
let summaryEl = null;
const state = { filter: 'all', query: '' };

const FILTERS = [
  { key: 'all',     label: 'ALL',     on: true,  onClick: () => (state.filter = 'all') },
  { key: 'online',  label: 'ONLINE C2', on: false, onClick: () => (state.filter = 'online') },
];

function chips() {
  const services = [...new Set((S.portData || []).map(p => p.service))].slice(0, 4);
  return [
    ...FILTERS,
    ...services.map(svc => ({ key: 'svc:' + svc, label: svc.toUpperCase(), on: state.filter === 'svc:' + svc,
                              onClick: () => (state.filter = 'svc:' + svc) })),
  ];
}

export function renderCyberPanel() {
  if (!ui) {
    ui = makePanel({
      searchPlaceholder: 'SEARCH IP / COUNTRY / AS / CITY',
      refresh: refreshCyberPanel,
      onSearch: (v) => { state.query = v.toUpperCase(); refreshCyberPanel(); },
    });
    summaryEl = makeSummary([]);
    ui.root.insertBefore(summaryEl, ui.metaEl);
  }
  ui.setChips(chips().map(c => h('button', {
    class: 'chip' + (c.on ? ' on' : ''), text: c.label,
    onclick: () => { c.onClick(); refreshCyberPanel(); },
  })));
  const body = document.getElementById('rpbody');
  if (body) body.replaceChildren(ui.root);
  refreshCyberPanel();
}

/** One row per attack origin. */
function attackRows() {
  const q = state.query;
  return S.attackData
    .map(a => ({
      kind: 'attack', a,
      match: !q || [a.ip, a.geo?.country, a.geo?.city, a.geo?.isp, a.geo?.as, a.geo?.org]
        .some(v => String(v || '').toUpperCase().includes(q)),
      svcOk: state.filter.startsWith('svc:')
        ? a.topTargets.some(p => p.service === state.filter.slice(4))
        : true,
    }))
    .filter(r => r.match && r.svcOk)
    .sort((x, y) => y.a.attacks - x.a.attacks);
}

function c2Rows() {
  if (state.filter.startsWith('svc:')) return [];
  const q = state.query;
  return S.cyberData
    .map(e => ({
      kind: 'c2', e,
      match: !q || [e.ip_address, e.malware, e.as_name, e.country]
        .some(v => String(v || '').toUpperCase().includes(q)),
      statusOk: state.filter === 'all' || (e.status || '').toLowerCase() === state.filter,
    }))
    .filter(r => r.match && r.statusOk)
    .slice(0, 60);
}

export function refreshCyberPanel() {
  if (!ui) return;

  const attacks = attackRows();
  const c2s = c2Rows();
  const nodes = [];

  // ── live attack origins ──
  if (attacks.length) {
    nodes.push(h('div', { class: 'pmeta', text: '▸ LIVE ATTACK ORIGINS (' + attacks.length + ')' }));
    attacks.slice(0, 60).forEach(({ a }) => nodes.push(makeRow({
      icon: '🎯',
      title: a.ip + (a.geo?.countryCode ? ' · ' + a.geo.countryCode : ''),
      sub: [a.place || 'location unknown', a.as || a.geo?.isp, a.topTargets.map(p => p.service).join('/')].filter(Boolean).join(' · '),
      value: num(a.attacks) + ' events',
      tag: { text: 'ORIGIN', cls: 'bad' },
      onClick: () => {
        focusMarker('attacks', a.id);
        const mk = S.markers.attacks?.get(a.id);
        if (mk?.isPopupOpen?.()) mk.setPopupContent(attackPopup(a));
      },
    })));
  }

  // ── targeted services (the "type" of attacks happening now) ──
  if (S.portData?.length) {
    nodes.push(h('div', { class: 'pmeta', text: '▸ SERVICES UNDER ATTACK NOW' }));
    S.portData.slice(0, 6).forEach(p => nodes.push(makeRow({
      icon: '🛡',
      title: p.service,
      sub: 'port ' + p.port + ' · ' + num(p.sources) + ' sources attacking',
      value: num(p.targets) + ' targets',
      tag: { text: num(p.records) + ' rec', cls: 'warn' },
      onClick: () => { state.query = p.service.toUpperCase(); ui.root.querySelector('.psearch').value = p.service.toUpperCase(); refreshCyberPanel(); },
    })));
  }

  // ── botnet C2 indicators ──
  if (c2s.length) {
    nodes.push(h('div', { class: 'pmeta', text: '▸ BOTNET C2 INDICATORS (' + c2s.length + ')' }));
    c2s.forEach(({ e }) => nodes.push(makeRow({
      icon: '💻',
      title: e.ip_address || 'unknown host',
      sub: (e.malware || 'C2') + ' · ' + (e.country || 'XX') + ' · ' + (e.as_name || 'ASN n/a'),
      value: e.last_online ? timeSince(e.last_online.replace(' ', 'T') + 'Z') : '',
      tag: { text: (e.status || 'unknown').toUpperCase(), cls: (e.status || '').toLowerCase() === 'online' ? 'bad' : 'ok' },
      onClick: () => focusMarker('cyber', (e.country || 'XX') + '|' + e.ip_address),
    })));
  }

  if (!nodes.length) {
    nodes.push(h('div', { class: 'empty', text: 'NO CYBER DATA · FEEDS PENDING' }));
  }

  ui.listEl.replaceChildren(...nodes);

  const totalEvents = S.attackData.reduce((n, a) => n + a.attacks, 0);
  summaryEl.replaceChildren(...[
    ['ORIGINS', num(S.attackData.length)],
    ['EVENTS', num(totalEvents)],
    ['C2', num(S.cyberData.length)],
  ].map(([k, v]) => h('span', { class: 'pnum', text: k + ' ' + v })));

  const topPort = (S.portData || []).slice().sort((a, b) => b.targets - a.targets)[0];
  ui.setMeta([
    ['ATTACKS', S.attackSource || 'DShield'],
    ['ORIGINS', num(S.attackData.length)],
    topPort ? ['TOP TARGET', topPort.service + ' · ' + num(topPort.targets) + ' targets'] : null,
  ].filter(Boolean));
  setHeaderCount(num(S.attackData.length) + ' origins / ' + num(S.cyberData.length) + ' C2');
}
