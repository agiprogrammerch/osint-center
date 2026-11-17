/* ══════════════════════════════════════════════════════════════
   PANEL: CCTV — REAL LIVE VIDEO (HLS) + TfL snapshot fallback
   Live cameras are played with hls.js straight from the local
   /proxy, which rewrites playlist URIs so any public .m3u8 works.
   No API key is required for any camera in the list.
   ══════════════════════════════════════════════════════════════ */
import { S } from '../../state.js';
import { PROXY_PATH } from '../../config.js';
import { h, num, setHeaderCount, assetUrl } from '../../utils.js';
import { makePanel } from './panelKit.js';
import { focusMarker } from '../../map/markers.js';
import { logEv } from '../eventLog.js';

let ui = null;
let currentCam = null;
let stageTimer = null;      // still-snapshot refresh (TfL fallback)
let clockTimer = null;      // modal clock
let hlsPlayer = null;       // active hls.js instance
let watchdog = null;        // "no frames arrived" watchdog
let retries = 0;

const state = { query: '' };

export function renderCCTVPanel() {
  if (!ui) {
    ui = makePanel({
      searchPlaceholder: 'SEARCH CAMERA / STREET / COUNTRY',
      refresh: refreshCCTVPanel,
      onSearch: (v) => { state.query = v.toUpperCase(); refreshCCTVPanel(); },
    });
  }
  const body = document.getElementById('rpbody');
  if (body) body.replaceChildren(ui.root);
  refreshCCTVPanel();
}

export function refreshCCTVPanel() {
  if (!ui) return;
  const q = state.query;
  const cams = S.cctvFeeds.filter(c =>
    !q || (c.name + ' ' + (c.id || '') + ' ' + (c.country || '') + ' ' + (c.stream || ''))
      .toUpperCase().includes(q));

  ui.listEl.replaceChildren(...cams.map(cam => {
    const dead = cam.live && cam.checked === false;
    const badge = !cam.live ? 'SNAPSHOT' : (dead ? 'OFFLINE' : 'LIVE HLS');
    const cls = !cam.live ? 'cam-b-snap' : (dead ? 'cam-b-bad' : 'cam-b-live');
    return h('div', {
      class: 'cam',
      dataset: { cam: cam.id },
      'data-action': 'open-cctv',
      onclick: () => focusMarker('cctv', cam.id),
    }, [
      h('span', { class: 'cam-ico', text: cam.live ? '📹' : '📷' }),
      h('div', { style: 'flex:1;min-width:0;' }, [
        h('div', { class: 'cam-name', text: cam.name }),
        h('div', { class: 'cam-sub', text: `${cam.country || '--'} · ${cam.lat.toFixed(3)}, ${cam.lon.toFixed(3)}` }),
      ]),
      h('span', { class: 'cam-b ' + cls, text: badge }),
    ]);
  }));

  if (!cams.length) {
    ui.listEl.replaceChildren(h('div', { class: 'empty',
      text: S.cctvFeeds.length ? 'NO CAMERA MATCHES'
        : 'CAMERA LIST NOT LOADED — CHECK THE LOCAL SERVER' }));
  }

  const liveCount = S.cctvFeeds.filter(c => c.live).length;
  ui.setMeta([
    ['SOURCE', liveCount ? 'LIVE HLS · FREE, NO KEY' : 'TfL JAMCAMS (LONDON)'],
    ['LIVE', num(liveCount)],
    ['AVAILABLE', num(S.cctvTotal)],
  ]);
  setHeaderCount(num(cams.length) + ' cameras');
}

/* ───────────────────────── modal ───────────────────────── */

export function openCCTV(cam) {
  if (!cam) return;
  currentCam = cam;
  retries = 0;

  document.getElementById('cctv-title').textContent = cam.name;
  document.getElementById('cctv-sub').textContent =
    `${cam.lat.toFixed(4)}, ${cam.lon.toFixed(4)} · ${cam.country || '--'} · ${cam.source || 'public CCTV'}`;
  const srcLink = document.getElementById('cctv-src');
  srcLink.href = cam.stream || cam.image || '#';
  document.getElementById('cctv-mode').textContent = cam.live ? 'CONNECTING…' : 'SNAPSHOT 2s';
  document.getElementById('cctv-msg').style.display = 'none';

  document.getElementById('cctv-modal').style.display = 'flex';

  if (clockTimer) clearInterval(clockTimer);
  clockTimer = setInterval(() => {
    document.getElementById('cctv-clock').textContent = new Date().toLocaleTimeString('en-GB');
  }, 1000);
  document.getElementById('cctv-clock').textContent = new Date().toLocaleTimeString('en-GB');

  if (cam.live && cam.stream) startLive(cam);
  else startStills(cam);

  logEv('CAM', 'Opened camera: ' + cam.name + (cam.live ? ' (live HLS)' : ' (2s snapshots)'));
}

/** Live HLS video via hls.js, routed through the local /proxy. */
function startLive(cam) {
  const video = document.getElementById('cctv-video');
  const img = document.getElementById('cctv-img');
  stopStills();
  destroyPlayer();

  img.style.display = 'none';
  img.removeAttribute('src');
  video.style.display = 'block';
  video.muted = true;
  const badge = document.getElementById('cctv-live');
  badge.style.display = 'inline-block';
  badge.textContent = '● LIVE HLS';

  const url = PROXY_PATH + encodeURIComponent(cam.stream);
  const HlsCtor = window.Hls;

  if (HlsCtor && HlsCtor.isSupported()) {
    try {
      hlsPlayer = new HlsCtor({
        lowLatencyMode: true,
        enableWorker: true,
        backBufferLength: 30,
        manifestLoadingTimeOut: 20000,
        manifestLoadingMaxRetry: 2,
        fragLoadingTimeOut: 30000,
        levelLoadingTimeOut: 20000,
      });
      hlsPlayer.loadSource(url);
      hlsPlayer.attachMedia(video);
      hlsPlayer.on(HlsCtor.Events.MANIFEST_PARSED, () => {
        document.getElementById('cctv-mode').textContent = 'BUFFERING…';
        video.play().catch(() => {});
      });
      video.onplaying = () => {
        if (!hlsPlayer) return;
        const lvl = hlsPlayer.levels?.[hlsPlayer.currentLevel];
        const res = (lvl && lvl.width) ? `${lvl.width}×${lvl.height}` :
          (video.videoWidth ? `${video.videoWidth}×${video.videoHeight}` : '');
        document.getElementById('cctv-mode').textContent = (res ? res + ' · ' : '') + 'LIVE HLS';
      };
      hlsPlayer.on(HlsCtor.Events.LEVEL_SWITCHED, () => {
        const lvl = hlsPlayer?.levels?.[hlsPlayer.currentLevel];
        if (lvl && lvl.width) {
          document.getElementById('cctv-mode').textContent =
            `${lvl.width}×${lvl.height} · LIVE HLS`;
        }
      });
      hlsPlayer.on(HlsCtor.Events.ERROR, (_e, data) => onStreamError(data));
      startWatchdog(video);
      video.play().catch(() => {});
      return;
    } catch (e) {
      /* fall through to native / error below */
    }
  }

  if (video.canPlayType && video.canPlayType('application/vnd.apple.mpegurl')) {
    // Safari has native HLS — the proxied playlist is fully absolute, so it
    // plays without hls.js.
    video.src = url;
    startWatchdog(video);
    video.play().catch(() => {});
    return;
  }

  showMsg('HLS PLAYBACK UNAVAILABLE — hls.js did not load (CDN blocked?). ' +
          'Open the STREAM URL in a media player to watch this camera.');
}

/** Declare the current stream dead with a clear message. */
function markOffline(reason) {
  clearWatchdog();
  destroyPlayer();
  const video = document.getElementById('cctv-video');
  video.style.display = 'none';
  const badge = document.getElementById('cctv-live');
  badge.textContent = '○ OFFLINE';
  document.getElementById('cctv-mode').textContent = 'OFFLINE';
  showMsg(reason + ' · press RELOAD to retry');
  logEv('CAM', 'Stream offline: ' + (currentCam ? currentCam.name : '?') + ' — ' + reason);
}

/**
 * hls.js occasionally stalls without firing a fatal error (404 playlists,
 * silent CDN drops). Watch for actual frames and declare the stream offline
 * if nothing arrives, so the viewer never shows "RECONNECTING…" forever.
 * The window is deliberately generous: some cameras serve multi-megabyte
 * segments over slow public CDNs.
 */
const FIRST_FRAME_GRACE_MS = 30000;

function startWatchdog(video) {
  clearWatchdog();
  const started = Date.now();
  watchdog = setInterval(() => {
    if (document.getElementById('cctv-modal').style.display !== 'flex') {
      clearWatchdog();
      return;
    }
    const alive = video.videoWidth > 0 || video.readyState >= 2 || video.currentTime > 0;
    if (alive && Date.now() - started > 1500) { clearWatchdog(); return; }
    if (!alive) {
      const secs = Math.round((Date.now() - started) / 1000);
      document.getElementById('cctv-mode').textContent = 'CONNECTING… ' + secs + 's';
      if (secs * 1000 > FIRST_FRAME_GRACE_MS) {
        markOffline('NO VIDEO DATA — stream is offline or blocked');
      }
    }
  }, 1000);
}

function clearWatchdog() {
  if (watchdog) { clearInterval(watchdog); watchdog = null; }
}

function onStreamError(data) {
  if (!data) return;
  if (!data.fatal) return;
  if (data.type === 'mediaError' && hlsPlayer) {
    try { hlsPlayer.recoverMediaError(); } catch (_) {}
    return;
  }
  if (data.type === 'networkError' && hlsPlayer && retries < 2) {
    retries++;
    try { hlsPlayer.startLoad(); } catch (_) {}
    document.getElementById('cctv-mode').textContent = 'RECONNECTING…';
    return;
  }
  markOffline('STREAM OFFLINE — ' + (data.details || data.type || 'unknown error'));
}

/** TfL fallback: live still snapshot, refreshed every 2 seconds. */
function startStills(cam) {
  const video = document.getElementById('cctv-video');
  const img = document.getElementById('cctv-img');
  clearWatchdog();
  destroyPlayer();
  video.style.display = 'none';
  video.pause?.();
  video.removeAttribute('src');
  img.style.display = 'block';
  document.getElementById('cctv-live').style.display = 'none';

  if (!cam.image) {
    showMsg('NO SNAPSHOT URL FOR THIS CAMERA');
    return;
  }
  paintStill();
  if (stageTimer) clearInterval(stageTimer);
  stageTimer = setInterval(paintStill, 2000);
}

function paintStill() {
  if (!currentCam || document.getElementById('cctv-modal').style.display !== 'flex') return;
  if (!currentCam.image) return;
  document.getElementById('cctv-img').src = assetUrl(currentCam.image);
  document.getElementById('cctv-clock').textContent = new Date().toLocaleTimeString('en-GB');
}

/** RELOAD button: restart whichever view is open. */
export function reloadCCTV() {
  if (!currentCam) return;
  retries = 0;
  const modal = document.getElementById('cctv-modal');
  modal.style.display = 'flex';
  document.getElementById('cctv-msg').style.display = 'none';
  document.getElementById('cctv-mode').textContent = currentCam.live ? 'CONNECTING…' : 'SNAPSHOT 2s';
  const badge = document.getElementById('cctv-live');
  badge.style.display = currentCam.live ? 'inline-block' : 'none';
  if (currentCam.live) badge.textContent = '● LIVE HLS';
  if (currentCam.live && currentCam.stream) startLive(currentCam);
  else startStills(currentCam);
  logEv('CAM', 'Reloading camera: ' + currentCam.name);
}

function stopStills() {
  if (stageTimer) { clearInterval(stageTimer); stageTimer = null; }
  document.getElementById('cctv-img').removeAttribute('src');
}

function destroyPlayer() {
  if (hlsPlayer) {
    try { hlsPlayer.destroy(); } catch (_) {}
    hlsPlayer = null;
  }
}

function showMsg(text) {
  const msg = document.getElementById('cctv-msg');
  msg.textContent = text;
  msg.style.display = 'flex';
}

export function closeCCTV() {
  document.getElementById('cctv-modal').style.display = 'none';
  document.getElementById('cctv-live').style.display = 'none';
  document.getElementById('cctv-live').textContent = '● LIVE HLS';
  stopStills();
  clearWatchdog();
  destroyPlayer();
  if (clockTimer) { clearInterval(clockTimer); clockTimer = null; }
  const video = document.getElementById('cctv-video');
  video.pause?.();
  video.removeAttribute('src');
  video.style.display = 'none';
  const img = document.getElementById('cctv-img');
  img.removeAttribute('src');
  img.style.display = 'none';
  document.getElementById('cctv-msg').style.display = 'none';
  document.getElementById('cctv-mode').textContent = '';
  currentCam = null;
}