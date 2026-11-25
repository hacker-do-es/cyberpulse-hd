import type { NewsArticle } from '@/data/mockNews';

export interface SourceInfo {
  id: string;
  name: string;
  category: string;
  active: boolean;
  custom: boolean;
  count: number;
}

export interface ApiNewsResponse {
  articles: NewsArticle[];
  count: number;
}

export interface ApiSourceResponse {
  sources: {
    id: string;
    name: string;
    category: string;
    active: boolean;
    custom: boolean;
    count: number;
    lastFetch?: string;
  }[];
}

/* Session cookie travels automatically (same origin); writes also carry the
   CSRF header the server requires. */
function cyberpulseHeaders(): Record<string, string> {
  return { 'X-Requested-With': 'cyberpulse' };
}

export async function fetchApiNews(): Promise<NewsArticle[]> {
  const res = await fetch('/api/news?limit=20000');
  if (!res.ok) throw new Error(`News API error: ${res.status}`);
  const data: ApiNewsResponse = await res.json();
  return data.articles || [];
}

export async function fetchApiSources(): Promise<SourceInfo[]> {
  const res = await fetch('/api/sources');
  if (!res.ok) throw new Error(`Sources API error: ${res.status}`);
  const data: ApiSourceResponse = await res.json();
  return (data.sources || []).map((s) => ({
    id: s.id,
    name: s.name,
    category: s.category,
    active: s.active,
    custom: s.custom,
    count: s.count,
  }));
}

export interface CreateSourceParams {
  name: string;
  rssUrl: string;
  category: string;
}

export interface SourceRecord {
  id: string;
  name: string;
  rssUrl: string;
  category: string;
  active: boolean;
  custom: boolean;
}

export async function createSource(source: CreateSourceParams): Promise<SourceRecord> {
  const res = await fetch('/api/sources', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...cyberpulseHeaders(),
    },
    body: JSON.stringify(source),
  });
  const data = (await res.json().catch(() => ({}))) as { source?: SourceRecord; error?: string };
  if (!res.ok) {
    throw new Error(data.error || `Create source failed (${res.status})`);
  }
  if (!data.source) {
    throw new Error('Invalid create source response');
  }
  return data.source;
}

export async function deleteSource(id: string): Promise<void> {
  const res = await fetch(`/api/sources/${id}`, {
    method: 'DELETE',
    headers: cyberpulseHeaders(),
  });
  const data = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string };
  if (!res.ok || !data.success) {
    throw new Error(data.error || `Delete source failed (${res.status})`);
  }
}

export async function toggleSourceActive(id: string, active: boolean): Promise<SourceRecord> {
  const res = await fetch(`/api/sources/${id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...cyberpulseHeaders(),
    },
    body: JSON.stringify({ active }),
  });
  const data = (await res.json().catch(() => ({}))) as { source?: SourceRecord; error?: string };
  if (!res.ok) {
    throw new Error(data.error || `Update source failed (${res.status})`);
  }
  if (!data.source) {
    throw new Error('Invalid update source response');
  }
  return data.source;
}

export interface ScrapeResponse {
  success: boolean;
  message: string;
}

export async function scrapeSources(): Promise<ScrapeResponse> {
  const res = await fetch('/api/scrape', {
    method: 'POST',
    headers: cyberpulseHeaders(),
  });
  const data = (await res.json().catch(() => ({}))) as ScrapeResponse & { error?: string };
  if (!res.ok) {
    throw new Error(data.error || `Scrape failed (${res.status})`);
  }
  return {
    success: data.success ?? true,
    message: data.message || 'Scraping started',
  };
}

export interface ScrapeStatusResponse {
  scraping: boolean;
  startedAt: string | null;
  lastFetch: string | null;
  lastResult: {
    totalNew: number;
    errors: string[];
    finishedAt: string | null;
  };
}

export async function fetchScrapeStatus(): Promise<ScrapeStatusResponse> {
  const res = await fetch('/api/scrape/status');
  if (!res.ok) throw new Error(`Scrape status error: ${res.status}`);
  return res.json();
}

export interface GenerateAiPostParams {
  title: string;
  summary: string;
  source: string;
  category: string;
  severity: string;
  url: string;
  tone: string;
  format: string;
  length: string;
  language: string;
}

export interface GenerateAiPostResponse {
  post: string;
}

export async function generateAiPost(params: GenerateAiPostParams): Promise<string> {
  const res = await fetch('/api/generate-ai', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...cyberpulseHeaders(),
    },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(data.error || `AI request failed (${res.status})`);
  }

  const data = (await res.json()) as GenerateAiPostResponse;
  if (typeof data.post !== 'string') {
    throw new Error('Invalid AI response format');
  }
  return data.post;
}

/* ------------------------------------------------------------------ */
/*  Tech Stack                                                         */
/* ------------------------------------------------------------------ */

export type AssetCriticality = 'low' | 'medium' | 'high';

/* The short form of an asset shown next to stack rows and news. */
export interface AssetRef {
  id: number;
  name: string;
  criticality: AssetCriticality;
  environment: string | null;
}

export interface TechStackItem {
  id: number;
  technology: string;
  version?: string;
  vendor?: string;
  category?: string;
  /* "vendor:product" as CVE records name it, when the name is not enough. */
  cpe?: string;
  /* Each asset with the version installed on it (null = the row's). */
  assets?: Array<AssetRef & { version?: string | null }>;
  createdAt?: string;
}

/* Is the article's CVE confirmed against installed versions? */
export type VulnStatus = 'affected' | 'not_affected' | 'pending' | 'unverified' | 'no_cve';
export type VulnUnitStatus = 'affected' | 'not_affected' | 'not_listed' | 'unknown' | 'no_version' | 'pending';

export interface VulnUnit {
  stackId: number;
  technology: string;
  version: string | null;
  assetId: number | null;
  status: VulnUnitStatus;
  cve?: string;
  fixedIn?: string;
}

export interface ArticleVuln {
  status: VulnStatus;
  cves: string[];
  units: VulnUnit[];
}

export interface TechStackResponse {
  stack: TechStackItem[];
}

export interface TechStackNewsArticle extends NewsArticle {
  matchScore: number;
  matchedTechnologies: string[];
  matchedStackIds?: number[];
  affectedAssets?: AssetRef[];
  vuln?: ArticleVuln;
}

export interface TechStackNewsResponse {
  news: TechStackNewsArticle[];
  statistics: {
    totalArticles: number;
    matchedArticles: number;
    byTechnology: Record<string, number>;
    bySeverity: Record<string, number>;
  };
}

export async function fetchTechStack(): Promise<TechStackItem[]> {
  const res = await fetch('/api/tech-stack');
  if (!res.ok) throw new Error(`Tech stack API error: ${res.status}`);
  const data: TechStackResponse = await res.json();
  return data.stack || [];
}

export interface CreateTechStackParams {
  technology: string;
  version?: string;
  vendor?: string;
  category?: string;
  /* "vendor:product"; '' clears it, absent keeps it. */
  cpe?: string;
  /* When present, replaces the row's assets. */
  assetIds?: number[];
}

export async function createTechStackItem(item: CreateTechStackParams): Promise<TechStackItem> {
  const res = await fetch('/api/tech-stack', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...cyberpulseHeaders(),
    },
    body: JSON.stringify(item),
  });
  const data = (await res.json().catch(() => ({}))) as { item?: TechStackItem; error?: string };
  if (!res.ok) {
    throw new Error(data.error || `Create tech stack item failed (${res.status})`);
  }
  if (!data.item) {
    throw new Error('Invalid create tech stack response');
  }
  return data.item;
}

export async function updateTechStackItem(id: number, item: CreateTechStackParams): Promise<TechStackItem> {
  const res = await fetch(`/api/tech-stack/${id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...cyberpulseHeaders(),
    },
    body: JSON.stringify(item),
  });
  const data = (await res.json().catch(() => ({}))) as { item?: TechStackItem; error?: string };
  if (!res.ok) {
    throw new Error(data.error || `Update tech stack item failed (${res.status})`);
  }
  if (!data.item) {
    throw new Error('Invalid update tech stack response');
  }
  return data.item;
}

export async function deleteTechStackItem(id: number): Promise<void> {
  const res = await fetch(`/api/tech-stack/${id}`, {
    method: 'DELETE',
    headers: cyberpulseHeaders(),
  });
  const data = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string };
  if (!res.ok || !data.success) {
    throw new Error(data.error || `Delete tech stack item failed (${res.status})`);
  }
}

export async function fetchTechStackNews(): Promise<TechStackNewsResponse> {
  const res = await fetch('/api/tech-stack/news');
  if (!res.ok) throw new Error(`Tech stack news API error: ${res.status}`);
  return res.json();
}
