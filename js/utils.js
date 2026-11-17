/* ══════════════════════════════════════════════════════════════
   UTILS — http transport (proxy-aware), DOM helpers, formatters
   ══════════════════════════════════════════════════════════════ */
import { PROXY_PATH, FALLBACK_PROXIES, CORS_HOSTS, DIRECT_TIMEOUT, PROXY_TIMEOUT } from './config.js';
import { S } from './state.js';

/* ── polyfill: AbortSignal.timeout (Safari < 17) ── */
if (typeof AbortSignal !== 'undefined' && !AbortSignal.timeout) {
  AbortSignal.timeout = function (ms) {
    const c = new AbortController();
    setTimeout(() => c.abort(new DOMException('TimeoutError', 'TimeoutError')), ms);
    return c.signal;
  };
}

/* ══════════════════════════════════════════════════════════════
   HTTP — every cross-origin request goes through serve.py's /proxy
   ══════════════════════════════════════════════════════════════ */
const isFileProtocol = () => location.protocol === 'file:';

/**
 * Flag the local proxy as unavailable (shows the warning banner).
 * Only ever fires when the proxy has *never* answered — a later hiccup on a
 * single upstream must not alarm the user about their own server.
 */
function markProxyDown(detail) {
  if (S.proxyOk) return;                 // it has worked at least once: keep quiet
  S.proxyOk = false;
  const el = document.getElementById('proxy-warn');
  if (el) { el.style.display = 'block'; el.dataset.detail = detail || ''; }
}

/** Clear the banner once the proxy has answered successfully. */
function markProxyUp() {
  S.proxyOk = true;
  const el = document.getElementById('proxy-warn');
  if (el && el.style.display === 'block') el.style.display = 'none';
}

/** Build a proxied GET that carries extra request headers (e.g. OAuth). */
async function rawProxyFetch(url, ms, headers = {}) {
  const hasHeaders = headers && Object.keys(headers).length > 0;
  const target = hasHeaders
    ? PROXY_PATH + encodeURIComponent(url) + '&headers=' + encodeURIComponent(JSON.stringify(headers))
    : PROXY_PATH + encodeURIComponent(url);
  return rawFetch(target, Math.min(ms, PROXY_TIMEOUT));
}

/**
 * The proxy tags every response with X-Proxy, so we can tell "the proxy
 * answered (target may have 404'd)" from "the proxy itself is unreachable".
 */
function proxyAnswered(r) { return !!r.headers.get('x-proxy'); }

async function rawFetch(url, ms, headers = {}, redirect = 'follow', body = null, method = null) {
  return fetch(url, {
    signal: AbortSignal.timeout(ms), redirect, credentials: 'omit', headers, body,
    method: method || (body == null ? 'GET' : 'POST'),
  });
}

/**
 * Fetch a resource as JSON or text.
 * Strategy: direct (only for CORS-enabled hosts) -> local proxy -> fallbacks.
 * Throws when every route fails. `headers`/`timeout` apply to both routes.
 */
export async function httpGet(url, { json = false, headers = {}, timeout } = {}) {
  if (isFileProtocol()) throw new Error('file-protocol');
  const directMs = timeout || DIRECT_TIMEOUT;
  const proxyMs = Math.min(timeout || PROXY_TIMEOUT, PROXY_TIMEOUT);

  // 1) direct — only where the API actually sends CORS headers
  let host = '';
  try { host = new URL(url, location.href).hostname; } catch (_) { host = ''; }
  if (CORS_HOSTS.has(host)) {
    try {
      const r = await rawFetch(url, directMs, headers);
      if (r.ok) return json ? await r.json() : await r.text();
    } catch (_) { /* timeout -> try proxy */ }
  }

  // 2) local proxy (serve.py)
  try {
    const r = await rawProxyFetch(url, proxyMs, headers);
    if (proxyAnswered(r)) {
      markProxyUp();
      if (r.ok) return json ? await r.json() : await r.text();
      throw new Error('upstream ' + r.status + ' for ' + url);
    }
    markProxyDown('route-missing');   // server too old / wrong port
  } catch (_) {
    if (!S.proxyOk) markProxyDown('network');
  }

  // 3) optional external fallbacks (none by default — all public ones are dead)
  for (const px of FALLBACK_PROXIES) {
    try {
      const r = await rawFetch(px.prefix + (px.encode ? encodeURIComponent(url) : url), proxyMs);
      if (r.ok) return json ? await r.json() : await r.text();
    } catch (_) {}
  }
  throw new Error('unavailable: ' + url);
}

export async function getJSON(url, timeout, headers) {
  return httpGet(url, { json: true, timeout, headers });
}
export async function getText(url, timeout, headers) {
  return httpGet(url, { json: false, timeout, headers });
}

/**
 * POST through the local proxy (used for OAuth2 token exchanges, which never
 * send CORS headers). `payload` may carry { method, headers, body }.
 */
export async function postViaProxy(payload, { json = true } = {}) {
  if (isFileProtocol()) throw new Error('file-protocol');
  const r = await rawFetch(PROXY_PATH, PROXY_TIMEOUT,
    { 'Content-Type': 'application/json' }, 'follow', JSON.stringify(payload));
  if (r.ok) {
    markProxyUp();
    return json ? await r.json() : await r.text();
  }
  if (r.status === 404) markProxyDown('route-missing');
  throw new Error('proxy POST failed: ' + r.status);
}

/** Build a proxied, cache-busted URL for <img>/<video> sources. */
export function assetUrl(url, cacheBust = true) {
  if (isFileProtocol() || !url) return url;
  return PROXY_PATH + encodeURIComponent(url) + (cacheBust ? '&cb=' + Date.now() : '');
}

/* ══════════════════════════════════════════════════════════════
   DOM — tiny hyperscript so no innerHTML is ever used for data
   ══════════════════════════════════════════════════════════════ */
export const $ = (id) => document.getElementById(id);

/**
 * h('div', {class:'x', dataset:{id:1}, onclick:fn}, [child, 'text'])
 * Children: Node | string | number | null | array (flattened, one level).
 */
export function h(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = String(v);
    else if (k === 'html') el.innerHTML = v;          // only for trusted static markup
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  const kids = Array.isArray(children) ? children.flat() : [children];
  for (const c of kids) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
export const clear = (el) => { if (el) el.replaceChildren(); };

/* ══════════════════════════════════════════════════════════════
   FORMATTERS
   ══════════════════════════════════════════════════════════════ */
export const num = (n) => (n == null || isNaN(n)) ? '--' : Number(n).toLocaleString('en-US');

export function timeSince(d) {
  const t = new Date(d).getTime();
  if (!t) return '--';
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return s + 's ago';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}

export const utcClock = () => {
  const n = new Date();
  return [n.getUTCHours(), n.getUTCMinutes(), n.getUTCSeconds()].map(v => String(v).padStart(2, '0')).join(':');
};

export const fmtAlt = (m) => m == null ? 'N/A' : `${num(m)} m / ${num(Math.round(m / 0.3048))} ft`;

/** Deterministic downsample: keep at most n entries, preserving spread. */
export function sampleArr(a, n) {
  if (a.length <= n) return a;
  const step = Math.max(1, Math.floor(a.length / n));
  const out = [];
  for (let i = 0; i < a.length && out.length < n; i += step) out.push(a[i]);
  return out;
}

/* ══════════════════════════════════════════════════════════════
   LEAFLET HELPERS
   ══════════════════════════════════════════════════════════════ */
export const mkIcon = (emoji, col, sz = 14) => L.divIcon({
  html: `<div style="font-size:${sz}px;line-height:1;filter:drop-shadow(0 0 3px ${col})">${emoji}</div>`,
  className: '', iconSize: [sz, sz], iconAnchor: [sz / 2, sz / 2], popupAnchor: [0, -sz / 2 + 2],
});

/** Build a Leaflet popup body as a real DOM node (no HTML injection). */
export function mkPop(title, rows) {
  return h('div', {}, [
    h('div', { class: 'pt', text: title }),
    ...rows.map(([k, v]) => h('div', { class: 'pr' }, [
      k instanceof Node ? k : h('b', { text: k + ': ' }),
      v instanceof Node ? v : document.createTextNode(String(v ?? 'N/A')),
    ])),
  ]);
}

/* ══════════════════════════════════════════════════════════════
   BADGES / STATS
   ══════════════════════════════════════════════════════════════ */
export const setStat = (id, v) => { const e = $(id); if (e) e.textContent = v; };
export const upAlerts = () => setStat('alert-n', S.alerts);
export const upSrcBadge = (src) => setStat('src-badge', 'SRC: ' + src);
export const setHeaderCount = (txt) => setStat('rp-st', txt);
