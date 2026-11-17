/* ══════════════════════════════════════════════════════════════
   PANEL REGISTRY — tab id -> { title, render, refresh }
   Only panels that actually render content are registered.
   ══════════════════════════════════════════════════════════════ */
import { S } from '../../state.js';
import { renderFlightsPanel, refreshFlightsPanel } from './flightsPanel.js';
import { renderCyberPanel, refreshCyberPanel } from './cyberPanel.js';
import { renderDisasterPanel, refreshDisasterPanel } from './disasterPanel.js';
import { renderNews, refreshNewsPanel } from './newsPanel.js';
import { renderCCTVPanel, refreshCCTVPanel } from './cctvPanel.js';
import { renderShipPanel, refreshShipPanel } from './maritimePanel.js';

export const PANELS = {
  overview:  { label: 'OVERVIEW',    icon: '⛭', title: 'INTEL FEED',     render: renderNews,       refresh: refreshNewsPanel },
  flights:   { label: 'AIR TRAFFIC', icon: '✈', title: 'AIR TRAFFIC',    render: renderFlightsPanel, refresh: refreshFlightsPanel },
  cyber:     { label: 'CYBER',       icon: '💻', title: 'CYBER OPS',      render: renderCyberPanel,  refresh: refreshCyberPanel },
  ships:     { label: 'MARITIME',    icon: '⚓', title: 'VESSELS (AIS)', render: renderShipPanel, refresh: refreshShipPanel },
  disasters: { label: 'DISASTERS',   icon: '⚡', title: 'DISASTER EVENTS', render: renderDisasterPanel, refresh: refreshDisasterPanel },
  news:      { label: 'INTEL FEEDS', icon: '📡', title: 'INTEL FEED',     render: renderNews,       refresh: refreshNewsPanel },
  cctv:      { label: 'CCTV',        icon: '📷', title: 'CCTV FEEDS',     render: renderCCTVPanel,  refresh: refreshCCTVPanel },
};

export const DEFAULT_TAB = 'overview';

export function getPanel(tab) {
  return PANELS[tab] || PANELS[DEFAULT_TAB];
}

/**
 * Re-render a panel only when its tab is currently visible.
 * S.activeTab is the single source of truth — no second copy to desync.
 */
export function refreshPanel(tab) {
  if (!tab || tab !== S.activeTab) return;
  getPanel(tab).refresh();
}

export function setCurrentTab(tab) { S.activeTab = tab; }
