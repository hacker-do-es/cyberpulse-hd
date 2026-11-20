import { describe, expect, it } from 'vitest';
import type { NewsArticle } from '@/data/mockNews';
import { distinctSorted, emptyFilter, filterArticles, isFiltered, matchesQuery } from './articleFilter';

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
const art = (id: string, over: Partial<NewsArticle> = {}): NewsArticle => ({
  id,
  title: `Title ${id}`,
  summary: '',
  source: 'BleepingComputer',
  severity: 'medium',
  category: 'Vulnerability',
  publishedAt: '',
  publishDate: '',
  readTime: '1 min read',
  url: `https://example.com/${id}`,
  ...over,
});

const list = [
  art('a', { title: 'Fortinet FortiOS RCE CVE-2026-1234 exploited', severity: 'critical', publishedAtIso: hoursAgo(2) }),
  art('b', { title: 'Microsoft Patch Tuesday', summary: 'Vulnerabilidád en Exchange', severity: 'high', source: 'The Hacker News', publishedAtIso: hoursAgo(30) }),
  art('c', { title: 'Ransomware gang hits hospital', category: 'Ransomware', severity: 'low', publishedAtIso: hoursAgo(24 * 10) }),
  art('d', { title: 'Mock article without timestamp' }),
];
const ids = (xs: NewsArticle[]) => xs.map((x) => x.id);

describe('articleFilter', () => {
  it('no filter: everything, newest first, untimed last', () => {
    expect(ids(filterArticles(list, emptyFilter))).toEqual(['a', 'b', 'c', 'd']);
    expect(isFiltered(emptyFilter)).toBe(false);
  });

  it('query: all words, case/accent-insensitive, CVE and summary', () => {
    expect(matchesQuery(list[0], 'cve-2026-1234')).toBe(true);
    expect(matchesQuery(list[0], 'fortinet rce')).toBe(true);
    expect(matchesQuery(list[0], 'fortinet exchange')).toBe(false);
    expect(ids(filterArticles(list, { ...emptyFilter, query: 'vulnerabilidad' }))).toEqual(['b']);
    expect(ids(filterArticles(list, { ...emptyFilter, query: 'hacker news' }))).toEqual(['b']);
  });

  it('severity, source, category and time range', () => {
    expect(ids(filterArticles(list, { ...emptyFilter, severities: ['critical', 'low'] }))).toEqual(['a', 'c']);
    expect(ids(filterArticles(list, { ...emptyFilter, source: 'The Hacker News' }))).toEqual(['b']);
    expect(ids(filterArticles(list, { ...emptyFilter, category: 'Ransomware' }))).toEqual(['c']);
    // Untimed (mock) articles are always in range, like the news feed.
    expect(ids(filterArticles(list, { ...emptyFilter, range: '24h' }))).toEqual(['a', 'd']);
    expect(ids(filterArticles(list, { ...emptyFilter, range: '7d' }))).toEqual(['a', 'b', 'd']);
  });

  it('stack filter is optional and combinable', () => {
    const stackIds = new Set(['a', 'c']);
    expect(ids(filterArticles(list, { ...emptyFilter, stackIds }))).toEqual(['a', 'c']);
    expect(ids(filterArticles(list, { ...emptyFilter, stackIds, severities: ['low'] }))).toEqual(['c']);
    expect(ids(filterArticles(list, { ...emptyFilter, stackIds: null }))).toHaveLength(4);
    expect(isFiltered({ ...emptyFilter, stackIds })).toBe(true);
  });

  it('distinct sources sorted', () => {
    expect(distinctSorted(list, 'source')).toEqual(['BleepingComputer', 'The Hacker News']);
  });
});
