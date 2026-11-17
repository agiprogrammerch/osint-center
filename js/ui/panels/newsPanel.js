/* ══════════════════════════════════════════════════════════════
   PANEL: INTEL FEEDS — headlines from free key-less RSS feeds
   ══════════════════════════════════════════════════════════════ */
import { S } from '../../state.js';
import { RSS_FEEDS } from '../../config.js';
import { h, setHeaderCount, timeSince } from '../../utils.js';

export function renderNews() {
  const c = document.getElementById('rpbody');
  if (!c) return;
  setHeaderCount((S.news.length || '--') + ' ITEMS');

  if (!S.news.length) {
    c.replaceChildren(
      h('div', { style: { padding: '10px', fontSize: '10px', color: 'var(--gm)', borderBottom: '1px solid var(--b1)' },
                 text: 'DIRECT SOURCES:' }),
    );
    RSS_FEEDS.forEach(f => c.append(
      h('div', {
        class: 'ni', onclick: () => window.open(f.url, '_blank', 'noopener'),
      }, [
        h('div', { class: 'ni-s', text: f.name + ' // LIVE RSS' }),
        h('div', { class: 'ni-h', style: { fontSize: '10px' }, text: '→ OPEN ' + f.name }),
      ])
    ));
    return;
  }

  const nodes = S.news.slice(0, 35).map((item, i) => {
    const ago = item.pubDate ? timeSince(item.pubDate) : 'recent';
    const d = h('div', { class: 'ni' + (i < 2 ? ' brk' : '') }, [
      h('div', { class: 'ni-s', text: item.src + ' // ' + ago }),
      h('div', { class: 'ni-h', text: item.title }),
    ]);
    if (item.link) d.addEventListener('click', () => window.open(item.link, '_blank', 'noopener'));
    return d;
  });
  c.replaceChildren(...nodes);
}

export function refreshNewsPanel() { renderNews(); }
