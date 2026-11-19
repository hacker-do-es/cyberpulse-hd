import { config } from '../config';
import type { NewArticle } from '../db/schema';
import { articleRepository } from '../repositories/articleRepository';
import { fetchLogRepository, sourceRepository } from '../repositories/sourceRepository';
import { fetchFeed, type FeedItem } from './feeds/feedFetcher';

function inferSeverity(title: string): 'critical' | 'high' | 'medium' | 'low' {
  const t = title.toLowerCase();
  if (/critical|0-day|zero-day|ransomware|breach|exploit|actively exploited|emergency/i.test(t)) return 'critical';
  if (/high|vulnerability|flaw|attack|malware|phishing|cve/i.test(t)) return 'high';
  if (/medium|warning|alert|advisory|patch/i.test(t)) return 'medium';
  return 'low';
}

export function timeAgo(dateStr: string | Date): string {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return 'UNKNOWN';
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHrs = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffMin < 1) return 'JUST NOW';
  if (diffMin < 60) return `${diffMin} MIN AGO`;
  if (diffHrs < 24) return `${diffHrs} HR${diffHrs > 1 ? 'S' : ''} AGO`;
  if (diffDays < 7) return `${diffDays} DAY${diffDays > 1 ? 'S' : ''} AGO`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase();
}

export function publishDate(dateStr: string | Date): string {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return 'UNKNOWN';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/* Feeds in the wild carry timezone abbreviations JS cannot parse (CERT-EU
   sends "Fri, 23 Oct 2026 16:36:26 CEST"). `new Date(...).toISOString()` throws
   on those, which used to abort every remaining item from that source. */
const TZ_ABBREVIATIONS: Record<string, string> = {
  CET: '+0100', CEST: '+0200', EET: '+0200', EEST: '+0300',
  WET: '+0000', WEST: '+0100', BST: '+0100', MSK: '+0300',
  IST: '+0530', JST: '+0900', KST: '+0900', AEST: '+1000', AEDT: '+1100',
};

export function parsePublishedAt(raw: string | undefined): string {
  if (!raw) return new Date().toISOString();

  const direct = new Date(raw);
  if (!isNaN(direct.getTime())) return direct.toISOString();

  /* Retry with the trailing abbreviation swapped for a numeric offset. */
  const match = raw.trim().match(/\s([A-Z]{2,4})$/);
  const offset = match ? TZ_ABBREVIATIONS[match[1]] : undefined;
  if (offset) {
    const retry = new Date(raw.trim().replace(/\s[A-Z]{2,4}$/, ` ${offset}`));
    if (!isNaN(retry.getTime())) return retry.toISOString();
  }

  return new Date().toISOString();
}

function readTime(description: string): string {
  const text = description.replace(/<[^>]*>/g, ' ');
  const words = text.split(/\s+/).filter(Boolean).length;
  return `${Math.max(2, Math.ceil(words / 200))} MIN READ`;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err ?? '');
}

function toArticle(item: FeedItem, source: { name: string; category: string }): NewArticle | null {
  if (!item.title || !item.link) return null;
  const summary = item.contentSnippet || item.content || '';
  const pubDate = parsePublishedAt(item.isoDate || item.pubDate);
  return {
    title: item.title,
    summary: summary.slice(0, 400),
    source: source.name,
    severity: inferSeverity(item.title),
    category: source.category,
    publishedAt: pubDate,
    publishDate: publishDate(pubDate),
    readTime: readTime(summary),
    url: item.link,
  };
}

export async function scrapeSource(source: { name: string; rssUrl: string; category: string }): Promise<{ found: number; new: number; error?: string }> {
  try {
    /* Download + XML parsing happen on a worker thread. */
    const items = await fetchFeed(source.rssUrl);
    const rows: NewArticle[] = [];
    for (const item of items) {
      try {
        const row = toArticle(item, source);
        if (row) rows.push(row);
      } catch (err) {
        /* One malformed entry costs that entry, not the whole feed. */
        console.warn(`[SCRAPER] ${source.name}: skipped an item — ${errorMessage(err)}`);
      }
    }
    const added = articleRepository.insertMany(rows, (err) =>
      console.warn(`[SCRAPER] ${source.name}: skipped an item — ${errorMessage(err)}`));
    sourceRepository.updateStats(source.name, articleRepository.countBySource(source.name));
    fetchLogRepository.record(source.name, items.length, added);
    return { found: items.length, new: added };
  } catch (err) {
    const error = errorMessage(err) || 'Unknown error';
    fetchLogRepository.record(source.name, 0, 0, error);
    return { found: 0, new: 0, error };
  }
}

/* Feeds are independent and the work is almost entirely network wait, so they
   are fetched through a small worker pool instead of one at a time. The old
   serial loop (plus a 500 ms sleep after every source) took ~3.6 min for 100+
   feeds, which meant a scrape was still running when the next one was due. */
const SCRAPE_CONCURRENCY = config.scrapeConcurrency;

export async function scrapeAll(): Promise<{ total: number; errors: string[] }> {
  const startedAt = Date.now();
  const rows = sourceRepository.listActive().map((s) => ({ name: s.name, rssUrl: s.rssUrl, category: s.category ?? 'GENERAL' }));

  console.log(`[SCRAPER] Starting full RSS scrape of ${rows.length} sources (concurrency ${SCRAPE_CONCURRENCY})...`);

  const errors: string[] = [];
  let totalNew = 0;
  let cursor = 0;

  async function worker() {
    while (cursor < rows.length) {
      const source = rows[cursor++];
      const result = await scrapeSource(source);
      if (result.error) {
        errors.push(`${source.name}: ${result.error}`);
      } else {
        console.log(`[SCRAPER] ${source.name}: ${result.new} new / ${result.found} found`);
        totalNew += result.new;
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(SCRAPE_CONCURRENCY, rows.length) }, () => worker())
  );

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`[SCRAPER] Done in ${elapsed}s. ${totalNew} new articles. ${errors.length} errors.`);
  return { total: totalNew, errors };
}

/* Retention: the newest 100 articles per source. */
export function cleanOldArticles(): void {
  articleRepository.pruneKeepPerSource(100);
  console.log('[SCRAPER] Cleaned old articles');
}
