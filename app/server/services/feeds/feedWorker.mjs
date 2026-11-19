/* Worker thread: downloads and parses RSS/Atom feeds.

   XML parsing (rss-parser -> xml2js) is synchronous CPU work that took up to
   ~250 ms per feed on the main thread, stalling every request during each
   scrape. Here it runs on its own thread; the main thread only receives the
   few fields it stores.

   Plain JavaScript on purpose: a worker does not inherit TypeScript loaders
   in every environment (Vitest, plain node), and this file has no types to
   check beyond the message shape documented in feedFetcher.ts. */

import { parentPort } from 'node:worker_threads';
import Parser from 'rss-parser';

const MAX_ITEMS = 10;

const parser = new Parser({
  timeout: 15000,
  headers: { 'User-Agent': 'CyberPulse-RSS-Scraper/1.0' },
});

const text = (v) => (typeof v === 'string' ? v : undefined);

parentPort.on('message', async ({ id, url }) => {
  try {
    const feed = await parser.parseURL(url);
    const items = (feed.items || []).slice(0, MAX_ITEMS).map((it) => ({
      title: text(it.title),
      link: text(it.link),
      contentSnippet: text(it.contentSnippet),
      content: text(it.content),
      isoDate: text(it.isoDate),
      pubDate: text(it.pubDate),
    }));
    parentPort.postMessage({ id, items });
  } catch (err) {
    parentPort.postMessage({ id, error: (err && err.message) || String(err) });
  }
});
