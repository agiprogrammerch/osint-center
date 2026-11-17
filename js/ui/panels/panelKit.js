/* ══════════════════════════════════════════════════════════════
   PANEL KIT — shared shell for right-hand data panels
   Panels pass their own refresh()/onSearch() callbacks so the kit
   stays presentation-only.
   ══════════════════════════════════════════════════════════════ */
import { h, clear } from '../../utils.js';

/**
 * makePanel({ chips, searchPlaceholder, refresh, onSearch })
 *   chips:      [{ key, label, on, onClick }]  (on = selected)
 *   refresh:    redraw the list (called after chip clicks)
 *   onSearch:   receives the raw input value
 * Returns { root, metaEl, listEl, setMeta, summaryEl, query }
 */
export function makePanel({ chips = [], searchPlaceholder = '', refresh = () => {}, onSearch = null } = {}) {
  const metaEl = h('div', { class: 'pmeta' });
  const listEl = h('div', { class: 'plist' });
  const state = { query: '' };

  const chipEls = chips.map(c => h('button', {
    class: 'chip' + (c.on ? ' on' : ''),
    text: c.label,
    onclick: () => { c.onClick(); refreshChips(); refresh(); },
  }));

  function refreshChips() {
    chipEls.forEach((el, i) => el.classList.toggle('on', !!chips[i].on));
  }

  const toolsEl = h('div', { class: 'ptools' }, [
    searchPlaceholder ? h('input', {
      class: 'psearch', placeholder: searchPlaceholder,
      oninput: (e) => {
        state.query = e.target.value.trim();
        onSearch ? onSearch(state.query) : refresh();
      },
    }) : null,
    chipEls.length ? h('div', { class: 'pchips' }, chipEls) : null,
  ]);

  const root = h('div', { class: 'pwrap' }, [toolsEl, metaEl, listEl]);

  const setMeta = (parts) => {
    clear(metaEl);
    parts.filter(Boolean).forEach(p => metaEl.append(h('span', {}, [
      h('b', { text: p[0] + ': ' }), document.createTextNode(p[1]),
    ])));
  };

  return {
    root, metaEl, listEl, setMeta, refreshChips,
    /** Replace the filter chips (panels whose filters change with the data). */
    setChips(nodes) {
      const wrap = root.querySelector('.pchips') || h('div', { class: 'pchips' });
      wrap.replaceChildren(...nodes.filter(Boolean));
      if (!wrap.parentNode) toolsEl.appendChild(wrap);
    },
    query: () => state.query,
  };
}

/** One list row. `tag` = {text, cls}; `onClick` optional. */
export function makeRow({ icon, title, sub, value, tag, onClick, extraClass = '' }) {
  return h('div', { class: 'row ' + extraClass, onclick: onClick }, [
    icon ? h('span', { class: 'row-ico', text: icon }) : null,
    h('div', { class: 'row-main' }, [
      h('div', { class: 'row-title', text: title ?? '' }),
      sub ? h('div', { class: 'row-sub', text: sub }) : null,
    ]),
    (value || tag) ? h('div', { class: 'row-meta' }, [
      value ? h('div', { class: 'row-val', text: value }) : null,
      tag ? h('div', { class: 'row-tag ' + (tag.cls || ''), text: tag.text }) : null,
    ]) : null,
  ]);
}

/** Small summary strip (counts, breakdowns). */
export function makeSummary(items) {
  return h('div', { class: 'psum' }, items.map(([k, v]) => h('span', { class: 'pnum', text: k + ' ' + v })));
}
