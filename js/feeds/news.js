/* ══════════════════════════════════════════════════════════════
   FEED: NEWS — free key-less RSS feeds, parsed in the browser via the proxy
   ══════════════════════════════════════════════════════════════ */
import { S } from '../state.js';
import { RSS_FEEDS, REFRESH_MS } from '../config.js';
import { getText, getJSON } from '../utils.js';
import { logEv } from '../ui/eventLog.js';
import { refreshPanel } from '../ui/panels/registry.js';

export async function fetchNews() {
  const token = Symbol(); S.fetchId.news = token;
  if (S.lock.news) return;
  S.lock.news = true;

  let all = [];
  const results = await Promise.allSettled(RSS_FEEDS.map(async f => {
    const xml = await getText(f.url, 15000);
    return parseRSS(xml, f.name);
  }));
  if (S.fetchId.news !== token) { S.lock.news = false; return; }
  results.forEach(r => { if (r.status === 'fulfilled') all.push(...r.value); });

  // rss2json (free, key-less tier) as a secondary route if XML parsing found nothing
  if (!all.length) {
    const alt = await Promise.allSettled(RSS_FEEDS.map(async f => {
      const url = 'https://api.rss2json.com/v1/api.json?rss_url=' + encodeURIComponent(f.url) + '&count=12&_t=' + Date.now();
      const data = await getJSON(url, 15000);
      if (data?.status === 'ok' && data.items?.length) {
        return data.items.map(i => ({ title: i.title, link: i.link, pubDate: i.pubDate, src: f.name }));
      }
      return [];
    }));
    if (S.fetchId.news !== token) { S.lock.news = false; return; }
    alt.forEach(r => { if (r.status === 'fulfilled') all.push(...r.value); });
  }

  if (all.length) {
    all.sort((a, b) => new Date(b.pubDate || 0) - new Date(a.pubDate || 0));
    S.news = all.slice(0, 60);
    logEv('NEWS', S.news.length + ' articles refreshed from ' + RSS_FEEDS.length + ' live feeds');
  } else if (!S.news.length) {
    logEv('NEWS', 'All RSS feeds unavailable — start the local server (serve.py)');
  }
  refreshPanel('overview');
  refreshPanel('news');
  S.lock.news = false;
}

export function parseRSS(xml, src) {
  const items = [];
  try {
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    doc.querySelectorAll('item, entry').forEach(item => {
      const title = item.querySelector('title')?.textContent?.trim() || '';
      const linkEl = item.querySelector('link');
      const link = linkEl?.getAttribute('href') || linkEl?.textContent?.trim() || '';
      const date = item.querySelector('pubDate, published, updated')?.textContent?.trim() || '';
      if (title) items.push({ title, link, pubDate: date, src });
    });
  } catch (_) { /* malformed feed — skip */ }
  return items.slice(0, 12);
}

export const schedNews = () =>
  setTimeout(async () => { await fetchNews(); schedNews(); }, REFRESH_MS.news);
