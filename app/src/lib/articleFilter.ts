import type { NewsArticle } from '@/data/mockNews';
import { articleTime, isWithinRange, rangeCutoff, type TimeRange } from '@/lib/timeRange';

export type Severity = NewsArticle['severity'];
export const SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low'];

export interface ArticleFilter {
  query: string;
  /* Empty = every severity. */
  severities: Severity[];
  range: TimeRange;
  source: string; // '' = any
  category: string; // '' = any
  /* Only articles whose id is in this set; null = no stack filter. */
  stackIds: Set<string> | null;
}

export const emptyFilter: ArticleFilter = {
  query: '',
  severities: [],
  range: 'all',
  source: '',
  category: '',
  stackIds: null,
};

/* Lower-case and strip accents so "vulnerabilidad" finds "Vulnerabilidád"
   and "microsoft" finds "Microsoft". */
export function normalize(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/* Every word of the query must appear somewhere in title, summary, source or
   category (AND), so "fortinet rce" narrows instead of widening. */
export function matchesQuery(a: NewsArticle, query: string): boolean {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = normalize(`${a.title}\n${a.summary}\n${a.source}\n${a.category}`);
  return words.every((w) => hay.includes(w));
}

export function filterArticles(articles: NewsArticle[], f: ArticleFilter): NewsArticle[] {
  const cutoff = rangeCutoff(f.range);
  const out = articles.filter(
    (a) =>
      (f.severities.length === 0 || f.severities.includes(a.severity)) &&
      (!f.source || a.source === f.source) &&
      (!f.category || a.category === f.category) &&
      (!f.stackIds || f.stackIds.has(a.id)) &&
      isWithinRange(a, cutoff) &&
      matchesQuery(a, f.query)
  );
  /* Newest first; articles without a real timestamp keep their order at the end. */
  return out
    .map((a, i) => ({ a, i, t: articleTime(a) }))
    .sort((x, y) => {
      if (x.t === null && y.t === null) return x.i - y.i;
      if (x.t === null) return 1;
      if (y.t === null) return -1;
      return y.t - x.t || x.i - y.i;
    })
    .map((x) => x.a);
}

export function distinctSorted(articles: NewsArticle[], key: 'source' | 'category'): string[] {
  return [...new Set(articles.map((a) => a[key]).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' })
  );
}

export function isFiltered(f: ArticleFilter): boolean {
  return Boolean(f.query.trim() || f.severities.length || f.range !== 'all' || f.source || f.category || f.stackIds);
}
