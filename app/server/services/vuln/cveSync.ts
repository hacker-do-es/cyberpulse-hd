/* Fetches and caches CVE affected-version data.

   CVE.org has no published rate limit and answers fast; NVD allows 5
   requests per 30 s without an API key (50 with NVD_API_KEY), so NVD calls
   are serialised through a limiter and run after CVE.org. Everything is
   best effort: a CVE without data simply stays "unverified". */

import { toSqlUtc } from '../schedule';
import { cveRepository, type CveParts, type CveRecord } from '../../repositories/cveRepository';
import { articleRepository } from '../../repositories/articleRepository';
import { extractCves, normaliseCveOrg, normaliseNvd } from './cveData';

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
let doFetch: Fetch = (url, init) => fetch(url, init);
let nvdMinIntervalMs = process.env.NVD_API_KEY ? 700 : 6500;

/* Tests swap the network and the NVD pacing. */
export function setCveTransport(f: Fetch | null, nvdIntervalMs?: number): void {
  doFetch = f ?? ((url, init) => fetch(url, init));
  if (nvdIntervalMs !== undefined) nvdMinIntervalMs = nvdIntervalMs;
}

const CVE_ORG = 'https://cveawg.mitre.org/api/cve/';
const NVD = 'https://services.nvd.nist.gov/rest/json/cves/2.0?cveId=';
const TIMEOUT_MS = 15_000;
const HOUR = 3600_000;
const DAY = 24 * HOUR;

class HttpStatusError extends Error {
  constructor(public status: number) {
    super(`HTTP ${status}`);
  }
}

async function getJson(url: string, headers: Record<string, string> = {}): Promise<any | null> {
  const res = await doFetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'CyberPulse/1.0', ...headers },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new HttpStatusError(res.status);
  return res.json();
}

function age(ts: string | null | undefined, now: number): number {
  if (!ts) return Infinity;
  const t = Date.parse(ts.includes('T') ? ts : ts.replace(' ', 'T') + 'Z');
  return Number.isFinite(t) ? now - t : Infinity;
}

function isRecent(r: CveRecord, now: number): boolean {
  return age(r.data?.published ?? null, now) < 60 * DAY;
}

export function needsCveOrg(r: CveRecord | undefined, now = Date.now()): boolean {
  if (!r) return true;
  const a = age(r.fetchedAt, now);
  if (r.status === 'error') return a > HOUR;
  if (r.status === 'not_found') return a > DAY;
  /* Young CVEs get enriched (CNA updates, CISA ADP): refresh daily. */
  return a > DAY && (isRecent(r, now) || !r.parts.cveOrg?.products.length);
}

export function needsNvd(r: CveRecord | undefined, now = Date.now()): boolean {
  if (!r) return true;
  if (r.status === 'not_found') return false;
  if (!r.nvdFetchedAt) return true;
  /* NVD adds CPE configurations days or weeks after publication. */
  return !r.parts.nvd?.nvdHasConfig && age(r.nvdFetchedAt, now) > DAY && isRecent(r, now);
}

let nvdNextAt = 0;
let nvdBackoffUntil = 0;

async function nvdSlot(deadline: number): Promise<boolean> {
  const wait = Math.max(nvdNextAt, nvdBackoffUntil) - Date.now();
  if (Date.now() + Math.max(0, wait) > deadline) return false;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  nvdNextAt = Date.now() + nvdMinIntervalMs;
  return true;
}

async function fetchCveOrg(id: string, prev: CveRecord | undefined): Promise<void> {
  const now = toSqlUtc(new Date());
  const parts: CveParts = { cveOrg: prev?.parts.cveOrg ?? null, nvd: prev?.parts.nvd ?? null };
  try {
    const json = await getJson(CVE_ORG + encodeURIComponent(id));
    if (!json || json?.cveMetadata?.state === 'REJECTED') {
      cveRepository.upsert({ cveId: id, status: 'not_found', parts: { cveOrg: null, nvd: parts.nvd }, fetchedAt: now, nvdFetchedAt: prev?.nvdFetchedAt ?? null });
      return;
    }
    parts.cveOrg = normaliseCveOrg(json);
    cveRepository.upsert({ cveId: id, status: 'ok', parts, fetchedAt: now, nvdFetchedAt: prev?.nvdFetchedAt ?? null });
  } catch (err: any) {
    cveRepository.upsert({ cveId: id, status: prev?.status === 'ok' ? 'ok' : 'error', parts, fetchedAt: now, nvdFetchedAt: prev?.nvdFetchedAt ?? null, error: String(err?.message || err).slice(0, 200) });
  }
}

async function fetchNvd(id: string, prev: CveRecord): Promise<void> {
  const headers: Record<string, string> = process.env.NVD_API_KEY ? { apiKey: process.env.NVD_API_KEY } : {};
  try {
    const json = await getJson(NVD + encodeURIComponent(id), headers);
    const nvd = json && json.totalResults !== 0 ? normaliseNvd(json) : null;
    cveRepository.upsert({ cveId: id, status: prev.status, parts: { cveOrg: prev.parts.cveOrg, nvd }, fetchedAt: prev.fetchedAt, nvdFetchedAt: toSqlUtc(new Date()) });
  } catch (err: any) {
    /* 403/429/503: NVD is throttling us; pause NVD for a while. */
    if (err instanceof HttpStatusError && [403, 429, 503].includes(err.status)) nvdBackoffUntil = Date.now() + 60_000;
    throw err;
  }
}

export interface SyncResult {
  cveOrg: number;
  nvd: number;
  errors: number;
}

/* Fetches whatever `ids` still need, in the given order, until `deadline`
   (epoch ms). Safe to call concurrently for different ids. */
export async function syncCves(ids: string[], deadline: number): Promise<SyncResult> {
  const result: SyncResult = { cveOrg: 0, nvd: 0, errors: 0 };
  const unique = Array.from(new Set(ids));
  if (!unique.length) return result;
  const now = Date.now();

  let records = cveRepository.getMany(unique);
  const orgQueue = unique.filter((id) => needsCveOrg(records.get(id), now));
  let cursor = 0;
  const worker = async () => {
    while (cursor < orgQueue.length && Date.now() < deadline) {
      const id = orgQueue[cursor++];
      await fetchCveOrg(id, records.get(id));
      result.cveOrg++;
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, orgQueue.length) }, worker));

  records = cveRepository.getMany(unique);
  for (const id of unique) {
    const r = records.get(id);
    if (!r || !needsNvd(r)) continue;
    if (!(await nvdSlot(deadline))) break;
    try {
      await fetchNvd(id, r);
      result.nvd++;
    } catch {
      result.errors++;
    }
  }
  return result;
}

/* ------------------------------------------------------------------ */
/*  Background job                                                     */
/* ------------------------------------------------------------------ */

const LOOKBACK_DAYS = 30;
let jobRunning = false;

/* CVE ids in the news of the last 30 days, newest articles first. */
export function recentCveIds(now = new Date()): string[] {
  const since = toSqlUtc(new Date(now.getTime() - LOOKBACK_DAYS * DAY));
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const a of articleRepository.textsSince(since)) {
    for (const id of extractCves(`${a.title} ${a.summary ?? ''}`)) {
      if (!seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    }
  }
  return ids;
}

export async function runCveJob(budgetMs = 15 * 60_000): Promise<SyncResult | null> {
  if (jobRunning) return null;
  jobRunning = true;
  try {
    const result = await syncCves(recentCveIds(), Date.now() + budgetMs);
    if (result.cveOrg || result.nvd || result.errors) {
      console.log(`[CVE] synced: ${result.cveOrg} CVE.org, ${result.nvd} NVD, ${result.errors} errors (${cveRepository.count()} cached)`);
    }
    return result;
  } finally {
    jobRunning = false;
  }
}

/* ------------------------------------------------------------------ */
/*  On demand (My Stack)                                               */
/* ------------------------------------------------------------------ */

const wanted = new Set<string>();
let pumping = false;

/* Queues CVEs to fetch in the background; returns immediately. Pages that
   show "pending" verdicts call this so the next refresh has the data. */
export function requestCves(ids: string[]): void {
  for (const id of ids) if (wanted.size < 5000) wanted.add(id);
  if (pumping || wanted.size === 0) return;
  pumping = true;
  void (async () => {
    try {
      while (wanted.size) {
        const batch = Array.from(wanted).slice(0, 50);
        batch.forEach((id) => wanted.delete(id));
        await syncCves(batch, Date.now() + 5 * 60_000);
      }
    } catch (err) {
      console.error('[CVE] on-demand sync failed:', err);
    } finally {
      pumping = false;
    }
  })();
}
