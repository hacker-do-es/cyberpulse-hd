/* Distro packages are judged by OSV (osv.dev), which imports the Debian,
   Ubuntu and Alpine security trackers: they know which CVEs a given
   package build still has, backported fixes included. Comparing upstream
   numbers instead would flag every patched Debian package as vulnerable. */

import { linksNeedingOsv, saveOsvResult } from '../../repositories/inventoryRepository';
import { toSqlUtc } from '../schedule';

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
let doFetch: Fetch = (url, init) => fetch(url, init);

export function setOsvTransport(f: Fetch | null): void {
  doFetch = f ?? ((url, init) => fetch(url, init));
}

const QUERYBATCH = 'https://api.osv.dev/v1/querybatch';
const BATCH = 500;
const TIMEOUT_MS = 30_000;

/* Ecosystems whose OSV ids embed the CVE id (DEBIAN-CVE-…, UBUNTU-CVE-…,
   ALPINE-CVE-…), so no per-vulnerability lookups are needed. */
export function osvSupported(pkg: string | null | undefined): boolean {
  return !!pkg && /^(Debian:|Ubuntu:|Alpine:)/.test(pkg);
}

export function splitPackage(pkg: string): { ecosystem: string; name: string; version: string } | null {
  const [ecosystem, name, version] = pkg.split('|');
  return ecosystem && name && version ? { ecosystem, name, version } : null;
}

const CVE_IN_ID = /CVE-\d{4}-\d{4,7}/;
const VULN_URL = 'https://api.osv.dev/v1/vulns/';

/* Advisory ids without a CVE in them (DLA-…, DSA-…, USN-…) are resolved to
   the CVEs they fix through their "upstream"/"aliases"/"related" fields.
   Advisories never change their CVE list in practice: cached for the
   process lifetime (bounded). */
const advisoryCves = new Map<string, string[]>();

async function cvesOfAdvisory(id: string): Promise<string[]> {
  const hit = advisoryCves.get(id);
  if (hit) return hit;
  const res = await doFetch(VULN_URL + encodeURIComponent(id), {
    headers: { Accept: 'application/json', 'User-Agent': 'CyberPulse/1.0' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`OSV ${id}: HTTP ${res.status}`);
  const json: any = await res.json();
  const ids = [...(json?.upstream ?? []), ...(json?.aliases ?? []), ...(json?.related ?? [])].map(String);
  const cves = Array.from(new Set(ids.map((x) => x.match(CVE_IN_ID)?.[0]).filter((x): x is string => !!x)));
  if (advisoryCves.size > 20000) advisoryCves.clear();
  advisoryCves.set(id, cves);
  return cves;
}

async function resolveAdvisories(ids: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  let i = 0;
  const worker = async () => {
    while (i < ids.length) {
      const id = ids[i++];
      out.set(id, await cvesOfAdvisory(id));
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, ids.length) }, worker));
  return out;
}

async function post(body: unknown): Promise<any> {
  const res = await doFetch(QUERYBATCH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'CyberPulse/1.0' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`OSV HTTP ${res.status}`);
  return res.json();
}

/* CVE ids affecting each package (same order as the input). */
export async function osvCvesFor(pkgs: Array<{ ecosystem: string; name: string; version: string }>): Promise<string[][]> {
  const out: string[][] = [];
  for (let i = 0; i < pkgs.length; i += BATCH) {
    const chunk = pkgs.slice(i, i + BATCH);
    let queries = chunk.map((p) => ({ package: { name: p.name, ecosystem: p.ecosystem }, version: p.version }));
    const acc: Array<Set<string>> = chunk.map(() => new Set());
    const advisories: Array<Set<string>> = chunk.map(() => new Set());
    let pending = queries.map((_, idx) => idx);
    /* Results are paginated per query; follow page tokens (bounded). */
    for (let page = 0; page < 10 && pending.length; page++) {
      const json = await post({ queries: pending.map((idx) => queries[idx]) });
      const next: number[] = [];
      (json?.results ?? []).forEach((r: any, k: number) => {
        const idx = pending[k];
        for (const v of r?.vulns ?? []) {
          const id = String(v?.id ?? '');
          const m = id.match(CVE_IN_ID);
          if (m) acc[idx].add(m[0]);
          else if (id) advisories[idx].add(id);
        }
        if (r?.next_page_token) {
          queries[idx] = { ...queries[idx], page_token: r.next_page_token } as any;
          next.push(idx);
        }
      });
      pending = next;
    }
    /* A failed advisory lookup fails the whole check (retried later):
       silently dropping it would turn "affected" into "not affected". */
    const resolved = await resolveAdvisories(Array.from(new Set(advisories.flatMap((a) => Array.from(a)))));
    advisories.forEach((set, idx) => set.forEach((id) => (resolved.get(id) ?? []).forEach((c) => acc[idx].add(c))));
    out.push(...acc.map((s) => Array.from(s).sort()));
    queries = [];
  }
  return out;
}

/* Re-checks agent-reported packages that changed or were checked more
   than a day ago (all assets, or one). */
export async function refreshOsv(assetId?: number): Promise<number> {
  const cutoff = toSqlUtc(new Date(Date.now() - 24 * 3600_000));
  const links = linksNeedingOsv(cutoff, assetId).filter((l) => osvSupported(l.package));
  if (!links.length) return 0;
  const parsed = links.map((l) => splitPackage(l.package!)!);
  const cves = await osvCvesFor(parsed);
  links.forEach((l, i) => saveOsvResult(l.stackItemId, l.assetId, l.package!, cves[i]));
  return links.length;
}

let running = false;
let again = false;

/* One check at a time; a request while one runs schedules one more pass
   (which covers whatever arrived meanwhile). */
export async function runOsvJob(assetId?: number): Promise<void> {
  if (running) {
    again = true;
    return;
  }
  running = true;
  try {
    let target = assetId;
    do {
      again = false;
      const n = await refreshOsv(target);
      if (n) console.log(`[OSV] checked ${n} distro package(s)`);
      target = undefined;
    } while (again);
  } catch (err) {
    console.error('[OSV] check failed:', err);
  } finally {
    running = false;
  }
}
