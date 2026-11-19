import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import { closeFeedWorkers, fetchFeed } from '../services/feeds/feedFetcher';

/* Feeds are downloaded and parsed on worker threads; these run the real
   worker against a local HTTP server. */

const items = Array.from({ length: 12 }, (_, i) => `
  <item>
    <title>Advisory ${i + 1} &amp; patch</title>
    <link>https://example.com/a/${i + 1}</link>
    <description>&lt;p&gt;Details for advisory ${i + 1}&lt;/p&gt;</description>
    <pubDate>Fri, 23 Oct 2026 16:36:26 GMT</pubDate>
  </item>`).join('');
const RSS = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>T</title>${items}</channel></rss>`;

let server: http.Server;
let base = '';

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/feed.xml') {
      res.writeHead(200, { 'content-type': 'application/rss+xml; charset=utf-8' });
      return res.end(RSS);
    }
    if (req.url === '/broken.xml') {
      res.writeHead(200, { 'content-type': 'application/xml' });
      return res.end('<rss><channel><item><title>unclosed');
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await closeFeedWorkers();
  await new Promise((r) => server.close(r));
});

describe('feed worker', () => {
  it('downloads and parses a feed off the main thread, newest 10 items', async () => {
    const got = await fetchFeed(`${base}/feed.xml`);
    expect(got).toHaveLength(10);
    expect(got[0]).toMatchObject({
      title: 'Advisory 1 & patch',
      link: 'https://example.com/a/1',
      contentSnippet: 'Details for advisory 1',
      isoDate: '2026-10-23T16:36:26.000Z',
    });
  });

  it('reports HTTP errors and invalid XML as rejections', async () => {
    await expect(fetchFeed(`${base}/missing.xml`)).rejects.toThrow(/404/);
    await expect(fetchFeed(`${base}/broken.xml`)).rejects.toThrow();
  });

  it('keeps working for many feeds in parallel', async () => {
    const all = await Promise.all(Array.from({ length: 20 }, () => fetchFeed(`${base}/feed.xml`)));
    expect(all.every((list) => list.length === 10)).toBe(true);
  });
});
