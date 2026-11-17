/* ══════════════════════════════════════════════════════════════
   LOGIN — themed access gate
   NOTE: this is a client-side gate for a local tool. It keeps the UI
   private on screen but is NOT real authentication — the credential
   lives in this file. Move it server-side if that ever matters.
   ══════════════════════════════════════════════════════════════ */
import { S } from '../state.js';

export const CREDENTIALS = { user: 'agiprogrammer', pass: 'Hacker@11' };

/** Returns true when the credentials are valid (and shakes the box when not). */
export function attemptLogin() {
  const u = document.getElementById('lu').value.trim();
  const p = document.getElementById('lp').value.trim();
  const err = document.getElementById('l-err');
  const box = document.getElementById('lbox');

  if (u === CREDENTIALS.user && p === CREDENTIALS.pass) {
    err.textContent = '';
    return true;
  }
  err.textContent = '⚠ ACCESS DENIED — INVALID CREDENTIALS';
  document.getElementById('lp').value = '';
  document.getElementById('lp').focus();
  box.style.borderColor = 'var(--red)';
  box.classList.add('shake');
  setTimeout(() => { box.classList.remove('shake'); box.style.borderColor = ''; }, 400);
  return false;
}

export function showLogin() {
  document.getElementById('app').style.display = 'none';
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('lu').value = '';
  document.getElementById('lp').value = '';
  document.getElementById('lu').focus();
}

export async function logout() {
  const { saveState } = await import('./session.js');
  const { stopFlightSimulation } = await import('../feeds/flights.js');
  const { shutdownMap } = await import('../map/shutdown.js');
  const { closeCCTV } = await import('./panels/cctvPanel.js');

  closeCCTV();                 // stops the 5s still-refresh timer
  shutdownMap();               // perf rAF, terminator timer, HUD interval
  saveState();
  stopFlightSimulation();
  S.simActive = false;
  showLogin();
}
