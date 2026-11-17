/* ══════════════════════════════════════════════════════════════
   TABS — build nav from the panel registry, switch panels
   ══════════════════════════════════════════════════════════════ */
import { S } from '../state.js';
import { h } from '../utils.js';
import { PANELS, DEFAULT_TAB, getPanel, setCurrentTab } from './panels/registry.js';

export function buildNav() {
  const nav = document.getElementById('nav');
  nav.replaceChildren(...Object.entries(PANELS).map(([key, p]) =>
    h('div', {
      class: 'tab' + (key === DEFAULT_TAB ? ' active' : ''),
      dataset: { t: key },
      'data-action': 'tab',
    }, [
      h('span', { text: p.icon + ' ' }),
      h('span', { text: p.label }),
    ])
  ));
}

export function switchTab(el) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  S.activeTab = el.dataset.t;
  setCurrentTab(S.activeTab);

  const p = getPanel(S.activeTab);
  document.getElementById('rp-head').replaceChildren(
    h('span', { class: 'rp-title', text: '// ' + p.title }),
    h('span', { id: 'rp-st', text: '--' }),
  );
  p.render();
}
