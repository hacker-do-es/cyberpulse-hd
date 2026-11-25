import { forEachChunked } from '../lib/eventLoop';
import type { StackRow } from '../db/schema';
import { articleRepository } from '../repositories/articleRepository';
import { assetRepository, type AssetRef } from '../repositories/assetRepository';
import { stackRepository } from '../repositories/stackRepository';
import { verdictContext } from './vuln/context';
import { requestCves } from './vuln/cveSync';
import { articleCves, evaluateArticle } from './vuln/verdict';
import {
  compileStack, matchArticle, sortMatches, statisticsFromMatches,
  type Article, type StackMatch, type StackStatistics, type TechStackItem,
} from './techMatcher';

/* Matching the corpus against a stack is CPU work (~1 ms per 20 articles
   with a 50-technology stack). Two things keep it off the request path:
   - it runs in chunks that yield to the event loop, so other requests are
     served in between instead of waiting for the whole scan;
   - results are cached per company and reused until either the corpus
     (a scrape added or pruned articles) or the company's stack changes. */

export function toTechStackItems(rows: StackRow[]): TechStackItem[] {
  return rows.map((r) => ({
    id: r.id,
    technology: r.technology,
    version: r.version || undefined,
    vendor: r.vendor || undefined,
    category: r.category || undefined,
  }));
}

export function tenantStack(tenantId: number): TechStackItem[] {
  return toTechStackItems(stackRepository.listByTenant(tenantId));
}

/* Matches `articles` against `stack`, yielding to the event loop every chunk. */
export async function matchChunked<A extends Article>(articles: A[], stack: TechStackItem[]): Promise<StackMatch<A>[]> {
  if (stack.length === 0 || articles.length === 0) return [];
  const compiled = compileStack(stack);
  const matches: StackMatch<A>[] = [];
  await forEachChunked(articles, (article) => {
    const m = matchArticle(article, compiled);
    if (m) matches.push(m);
  }, { chunkSize: 50 });
  return sortMatches(matches);
}

/* ------------------------------------------------------------------ */
/*  My Stack                                                           */
/* ------------------------------------------------------------------ */

export interface StackNewsArticle extends Article {
  source: string;
  severity: string | null;
  publishedAt: string | null;
  publishDate: string | null;
  readTime: string | null;
  url: string;
  fetchedAt: string | null;
}

export interface StackNewsResult {
  news: Array<StackNewsArticle & { matchScore: number; matchedTechnologies: string[]; matchedStackIds: number[] }>;
  statistics: StackStatistics;
}

const EMPTY: StackNewsResult = {
  news: [],
  statistics: { totalArticles: 0, matchedArticles: 0, byTechnology: {}, bySeverity: {} },
};

interface CacheEntry {
  key: string;
  result: Promise<StackNewsResult>;
}

const cache = new Map<number, CacheEntry>();
const MAX_CACHED_TENANTS = 200;

function stackFingerprint(stack: TechStackItem[]): string {
  return stack.map((s) => `${s.id}|${s.technology}|${s.version ?? ''}|${s.vendor ?? ''}`).join(';');
}

async function compute(stack: TechStackItem[], limit: number): Promise<StackNewsResult> {
  const articles: StackNewsArticle[] = articleRepository.latestFetched(limit).map((row) => ({
    id: String(row.id),
    title: row.title,
    summary: row.summary || '',
    source: row.source,
    severity: row.severity,
    category: row.category ?? 'GENERAL',
    publishedAt: row.publishedAt,
    publishDate: row.publishDate,
    readTime: row.readTime,
    url: row.url,
    fetchedAt: row.fetchedAt,
  }));
  const matches = await matchChunked(articles, stack);
  return {
    news: matches.map(({ article, score, matchedTech, matchedIds }) => ({ ...article, matchScore: score, matchedTechnologies: matchedTech, matchedStackIds: matchedIds })),
    statistics: statisticsFromMatches(articles.length, matches),
  };
}

export function getStackNews(tenantId: number, limit: number): Promise<StackNewsResult> {
  const stack = tenantStack(tenantId);
  if (stack.length === 0) return Promise.resolve(EMPTY);

  const key = `${limit}#${articleRepository.corpusVersion()}#${stackFingerprint(stack)}`;
  const hit = cache.get(tenantId);
  if (hit && hit.key === key) return hit.result;

  /* Concurrent requests for the same company share one computation. */
  const result = compute(stack, limit);
  cache.set(tenantId, { key, result });
  result.catch(() => cache.delete(tenantId));
  if (cache.size > MAX_CACHED_TENANTS) cache.delete(cache.keys().next().value!);
  return result;
}

export function clearStackNewsCache(): void {
  cache.clear();
}

/* ------------------------------------------------------------------ */
/*  Affected assets                                                    */
/* ------------------------------------------------------------------ */

const CRITICALITY_RANK: Record<string, number> = { low: 0, medium: 1, high: 2 };

export function criticalityRank(c: string | null | undefined): number {
  return CRITICALITY_RANK[c ?? ''] ?? -1;
}

/* The distinct assets behind the matched stack rows, most critical first. */
export function assetsForStackIds(stackIds: number[], links: Map<number, AssetRef[]>): AssetRef[] {
  const byId = new Map<number, AssetRef>();
  for (const id of stackIds) for (const a of links.get(id) ?? []) byId.set(a.id, a);
  return Array.from(byId.values())
    .sort((a, b) => criticalityRank(b.criticality) - criticalityRank(a.criticality) || a.name.localeCompare(b.name));
}

/* My Stack with each article's affected assets. Assets are attached per
   request (cheap map lookups), so editing assets never invalidates the
   cached match results. */
export async function getStackNewsWithAssets(tenantId: number, limit: number) {
  const result = await getStackNews(tenantId, limit);
  const links = assetRepository.linksByStackItem(tenantId);
  /* Version verdicts are computed per request too (versions and CVE data
     change independently of the cached matches). */
  const cvesById = new Map(result.news.map((n) => [n.id, articleCves(n)]));
  const allCves = Array.from(new Set(Array.from(cvesById.values()).flat()));
  const ctx = verdictContext(tenantId, allCves);
  const missing = allCves.filter((id) => !ctx.records.has(id));
  if (missing.length) requestCves(missing);
  return {
    ...result,
    news: result.news.map((n) => ({
      ...n,
      affectedAssets: assetsForStackIds(n.matchedStackIds, links),
      vuln: evaluateArticle(cvesById.get(n.id) ?? [], n.matchedStackIds, ctx),
    })),
  };
}
