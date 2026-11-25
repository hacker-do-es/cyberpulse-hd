/* CVE affected-version data, normalised from two sources:
   - CVE.org (CVE JSON 5): the CNA's own "affected" list, available the day
     the CVE is published, plus ADP enrichments (CISA adds CPEs);
   - NVD: CPE match configurations, added when NVD analyses the CVE.
   and the evaluation of one installed version against it. */

import { atLeast, atMost, compareVersions, parseBound, parseVersion, sameBranch, type Version } from './version';

export type EntryStatus = 'affected' | 'unaffected';

export interface AffectedEntry {
  status: EntryStatus;
  /* A single version... */
  exact?: string;
  /* ...or a range. Missing start = from the beginning. */
  start?: string;
  startIncl?: boolean;
  end?: string;
  endIncl?: boolean;
  /* CVE JSON 5 "changes": status switches inside the range (fix per branch). */
  changes?: Array<{ at: string; status: EntryStatus }>;
}

export interface AffectedProduct {
  source: 'cna' | 'adp' | 'nvd';
  vendor: string;
  product: string;
  /* What versions not listed are. null = not stated. */
  defaultStatus: 'affected' | 'unaffected' | 'unknown' | null;
  entries: AffectedEntry[];
}

export interface CveData {
  products: AffectedProduct[];
  /* Highest CVSS base score found (v4, v3.1, v3.0). */
  cvss: number | null;
  published: string | null;
  /* NVD returned CPE configurations (otherwise it may add them later). */
  nvdHasConfig?: boolean;
}

/* ------------------------------------------------------------------ */
/*  Normalisation                                                      */
/* ------------------------------------------------------------------ */

function asStatus(s: unknown): EntryStatus | null {
  return s === 'affected' || s === 'unaffected' ? s : null;
}

function asDefault(s: unknown): AffectedProduct['defaultStatus'] {
  return s === 'affected' || s === 'unaffected' || s === 'unknown' ? s : null;
}

function cvssFrom(metrics: any): number | null {
  let best: number | null = null;
  const consider = (score: unknown) => {
    if (typeof score === 'number' && Number.isFinite(score)) best = best === null ? score : Math.max(best, score);
  };
  for (const m of Array.isArray(metrics) ? metrics : []) {
    for (const key of ['cvssV4_0', 'cvssV3_1', 'cvssV3_0']) consider(m?.[key]?.baseScore);
  }
  return best;
}

/* CVE JSON 5 record (https://cveawg.mitre.org/api/cve/<id>). */
export function normaliseCveOrg(record: any): CveData {
  const containers = record?.containers ?? {};
  const blocks: Array<{ source: 'cna' | 'adp'; c: any }> = [
    { source: 'cna', c: containers.cna },
    ...(Array.isArray(containers.adp) ? containers.adp.map((c: any) => ({ source: 'adp' as const, c })) : []),
  ];
  const products: AffectedProduct[] = [];
  let cvss: number | null = null;
  for (const { source, c } of blocks) {
    if (!c) continue;
    const score = cvssFrom(c.metrics);
    if (score !== null) cvss = cvss === null ? score : Math.max(cvss, score);
    for (const a of Array.isArray(c.affected) ? c.affected : []) {
      const vendor = typeof a?.vendor === 'string' ? a.vendor : '';
      const product = typeof a?.product === 'string' ? a.product : (typeof a?.packageName === 'string' ? a.packageName : '');
      if (!product || product.toLowerCase() === 'n/a') continue;
      const entries: AffectedEntry[] = [];
      for (const v of Array.isArray(a.versions) ? a.versions : []) {
        const status = asStatus(v?.status);
        if (!status || typeof v?.version !== 'string') continue;
        if (v.versionType === 'git') continue;
        const changes = Array.isArray(v.changes)
          ? v.changes
            .map((ch: any) => ({ at: String(ch?.at ?? ''), status: asStatus(ch?.status) }))
            .filter((ch: any): ch is { at: string; status: EntryStatus } => !!ch.at && !!ch.status)
          : undefined;
        if (typeof v.lessThan === 'string') {
          entries.push({ status, start: v.version, startIncl: true, end: v.lessThan, endIncl: false, ...(changes?.length ? { changes } : {}) });
        } else if (typeof v.lessThanOrEqual === 'string') {
          entries.push({ status, start: v.version, startIncl: true, end: v.lessThanOrEqual, endIncl: true, ...(changes?.length ? { changes } : {}) });
        } else {
          entries.push({ status, exact: v.version });
        }
      }
      products.push({ source, vendor, product, defaultStatus: asDefault(a.defaultStatus), entries });
    }
  }
  const published = typeof record?.cveMetadata?.datePublished === 'string' ? record.cveMetadata.datePublished : null;
  return { products, cvss, published };
}

/* "cpe:2.3:a:f5:nginx_open_source:1.27.0:*:..." → parts, unescaped. */
export function parseCpe(cpe: string): { vendor: string; product: string; version: string } | null {
  const parts = cpe.split(/(?<!\\):/);
  if (parts.length < 6 || parts[0] !== 'cpe' || parts[1] !== '2.3') return null;
  const un = (s: string) => s.replace(/\\(.)/g, '$1');
  return { vendor: un(parts[3]), product: un(parts[4]), version: un(parts[5]) };
}

/* NVD API 2.0 response for one CVE. */
export function normaliseNvd(response: any): CveData {
  const cve = response?.vulnerabilities?.[0]?.cve;
  const byProduct = new Map<string, AffectedProduct>();
  let hasConfig = false;
  for (const config of Array.isArray(cve?.configurations) ? cve.configurations : []) {
    for (const node of Array.isArray(config?.nodes) ? config.nodes : []) {
      for (const m of Array.isArray(node?.cpeMatch) ? node.cpeMatch : []) {
        if (!m?.vulnerable || typeof m.criteria !== 'string') continue;
        const cpe = parseCpe(m.criteria);
        if (!cpe) continue;
        hasConfig = true;
        const key = `${cpe.vendor}:${cpe.product}`;
        let p = byProduct.get(key);
        if (!p) {
          /* NVD lists vulnerable configurations explicitly: anything not
             listed is not vulnerable. */
          p = { source: 'nvd', vendor: cpe.vendor, product: cpe.product, defaultStatus: 'unaffected', entries: [] };
          byProduct.set(key, p);
        }
        if (cpe.version === '-') continue;
        if (cpe.version !== '*') {
          p.entries.push({ status: 'affected', exact: cpe.version });
          continue;
        }
        const start = m.versionStartIncluding ?? m.versionStartExcluding;
        const end = m.versionEndIncluding ?? m.versionEndExcluding;
        p.entries.push({
          status: 'affected',
          ...(start ? { start, startIncl: m.versionStartIncluding !== undefined } : {}),
          end: end ?? '*',
          endIncl: end ? m.versionEndIncluding !== undefined : true,
        });
      }
    }
  }
  const metrics = cve?.metrics ?? {};
  let cvss: number | null = null;
  for (const key of ['cvssMetricV40', 'cvssMetricV31', 'cvssMetricV30']) {
    for (const m of Array.isArray(metrics[key]) ? metrics[key] : []) {
      const s = m?.cvssData?.baseScore;
      if (typeof s === 'number') cvss = cvss === null ? s : Math.max(cvss, s);
    }
  }
  return { products: Array.from(byProduct.values()), cvss, published: typeof cve?.published === 'string' ? cve.published : null, nvdHasConfig: hasConfig };
}

export function mergeCveData(a: CveData | null, b: CveData | null): CveData {
  const cvss = [a?.cvss, b?.cvss].filter((x): x is number => typeof x === 'number');
  return {
    products: [...(a?.products ?? []), ...(b?.products ?? [])],
    cvss: cvss.length ? Math.max(...cvss) : null,
    published: a?.published ?? b?.published ?? null,
    nvdHasConfig: Boolean(a?.nvdHasConfig || b?.nvdHasConfig),
  };
}

/* ------------------------------------------------------------------ */
/*  Product identification                                             */
/* ------------------------------------------------------------------ */

export function keyOf(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');
}

function productKeys(p: AffectedProduct): string[] {
  const keys = new Set<string>();
  keys.add(keyOf(p.product));
  keys.add(keyOf(`${p.vendor} ${p.product}`));
  /* WordPress plugin titles: "LearnPress – WordPress LMS Plugin for ..." */
  const head = p.product.split(/\s+[–—|-]\s+|:\s/)[0];
  if (head) keys.add(keyOf(head));
  keys.delete('');
  return Array.from(keys);
}

/* How well a CVE product names this technology: 4 = the stack row's own
   CPE, 3 = same name, 2 = the product name starts with the technology's
   ("Elementor" → "Elementor Website Builder"), 1 = the other way round
   ("Linux Kernel" → "Linux"). 0 = unrelated. */
export function productScore(p: AffectedProduct, techKeys: string[], cpe?: string | null): number {
  if (cpe) {
    const [v, prod] = cpe.split(':');
    if (v && prod && keyOf(v) === keyOf(p.vendor) && keyOf(prod) === keyOf(p.product)) return 4;
  }
  let best = 0;
  const pks = productKeys(p);
  for (const tk of techKeys) {
    if (tk.length < 2) continue;
    for (const pk of pks) {
      if (pk === tk) return 3;
      if (tk.length >= 4 && pk.startsWith(tk)) best = Math.max(best, 2);
      else if (pk.length >= 4 && tk.startsWith(pk)) best = Math.max(best, 1);
    }
  }
  return best;
}

/* The products of a CVE that name this technology (only the best match level). */
/* The best match level is chosen per source (the CNA says "Linux", CISA's
   ADP and NVD say "linux_kernel"), so each source gets its say. */
export function matchingProducts(data: CveData, techKeys: string[], cpe?: string | null): AffectedProduct[] {
  const out: AffectedProduct[] = [];
  for (const source of ['cna', 'adp', 'nvd'] as const) {
    let best = 0;
    const scored = data.products.filter((p) => p.source === source).map((p) => {
      const s = productScore(p, techKeys, cpe);
      if (s > best) best = s;
      return { p, s };
    });
    /* With an explicit CPE, only that product counts. */
    if (best === 0 || (cpe && best < 4)) continue;
    /* One product split over several blocks (an ADP block per PHP branch,
       each "default affected") is one product: merge before evaluating. */
    const merged = new Map<string, AffectedProduct>();
    for (const { p } of scored.filter((x) => x.s === best)) {
      /* Blocks with a different default (the kernel's git-only block vs its
         semver block) say different things and stay apart. */
      const key = `${keyOf(p.vendor)}:${keyOf(p.product)}:${p.defaultStatus}`;
      const prev = merged.get(key);
      if (!prev) merged.set(key, { ...p, entries: [...p.entries] });
      else prev.entries.push(...p.entries);
    }
    out.push(...merged.values());
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  Evaluation                                                         */
/* ------------------------------------------------------------------ */

export type ProductVerdict = { status: 'affected'; fixedIn?: string } | { status: 'unaffected' } | { status: 'unknown' };

function startNums(e: AffectedEntry): number[] {
  const b = parseBound(e.exact ?? e.start ?? '0');
  if (!b || b.kind === 'any') return [];
  return b.kind === 'prefix' ? b.nums : b.v.nums;
}

function cmpNums(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/* Status inside a range with "changes" (e.g. affected from 1.5.13, fixed at
   1.26.2 and at 1.27.1). A change applies to its own release branch, and the
   highest one to everything after it: 1.26.5 and 1.28.0 are fixed, 1.27.0
   is not. */
function applyChanges(v: Version, e: AffectedEntry): { status: EntryStatus; fixedIn?: string } | null {
  const changes = (e.changes ?? [])
    .map((c) => ({ ...c, v: parseVersion(c.at) }))
    .filter((c): c is { at: string; status: EntryStatus; v: Version } => c.v !== null)
    .sort((a, b) => cmpNums(a.v.nums, b.v.nums));
  if (!changes.length) return { status: e.status, ...(e.status === 'affected' && e.end && e.end !== '*' && !e.endIncl ? { fixedIn: e.end } : {}) };
  const last = changes[changes.length - 1];
  let status = e.status;
  for (const c of changes) {
    const cmp = compareVersions(v, c.v);
    if (cmp === null) return null;
    if (cmp >= 0 && (sameBranch(v, c.v) || c === last)) status = c.status;
  }
  if (status !== 'affected') return { status };
  const fix = changes.find((c) => c.status === 'unaffected' && sameBranch(v, c.v) && (compareVersions(c.v, v) ?? 0) > 0)
    ?? (last.status === 'unaffected' ? last : undefined);
  return { status, ...(fix ? { fixedIn: fix.at } : {}) };
}

/* Is `version` of this product affected? "unknown" whenever the data does
   not let us decide. */
export function evaluateProduct(p: AffectedProduct, version: string): ProductVerdict {
  const v = parseVersion(version);
  if (!v) return { status: 'unknown' };

  const hits: Array<{ status: EntryStatus; start: number[]; fixedIn?: string }> = [];
  let comparable = 0;
  let affectedRanges = 0;
  for (const e of p.entries) {
    if (e.exact !== undefined) {
      const ev = parseVersion(e.exact);
      if (!ev) continue;
      comparable++;
      const c = compareVersions(v, ev);
      if (c === null) return { status: 'unknown' };
      if (c === 0) hits.push({ status: e.status, start: ev.nums });
      continue;
    }
    const lo = parseBound(e.start ?? '0');
    const hi = parseBound(e.end ?? '*');
    if (!lo || !hi) continue;
    comparable++;
    if (e.status === 'affected') affectedRanges++;
    const a = atLeast(v, lo, e.startIncl !== false);
    const b = atMost(v, hi, e.endIncl === true);
    if (a === null || b === null) return { status: 'unknown' };
    /* At or past this branch's fix ("1.31.0 ≤ v < 1.31.9" and v = 1.31.9):
       counts as an "unaffected" entry as specific as the branch range, so
       it beats a broad "1.9.5 ≤ v < *" listed for unpatched old branches. */
    if (a && b === false && e.status === 'affected' && e.end && e.end !== '*' && !e.endIncl) {
      const end = parseVersion(e.end);
      if (end && sameBranch(v, end)) hits.push({ status: 'unaffected', start: startNums(e) });
    }
    if (a && b) {
      const r = applyChanges(v, e);
      if (!r) return { status: 'unknown' };
      hits.push({ status: r.status, start: startNums(e), ...(r.fixedIn ? { fixedIn: r.fixedIn } : {}) });
    }
  }
  if (comparable === 0) return { status: 'unknown' };

  if (hits.length) {
    /* The most specific entry (highest start) wins; a tie with different
       statuses is contradictory data. */
    hits.sort((x, y) => cmpNums(y.start, x.start));
    const top = hits.filter((h) => cmpNums(h.start, hits[0].start) === 0);
    if (top.some((h) => h.status !== top[0].status)) return { status: 'unknown' };
    return top[0].status === 'affected' ? { status: 'affected', ...(top[0].fixedIn ? { fixedIn: top[0].fixedIn } : {}) } : { status: 'unaffected' };
  }

  /* Past the fix of its own release branch (8.1.29 for "8.1.* < 8.1.29"). */
  for (const e of p.entries) {
    if (e.status !== 'affected' || !e.end || e.end === '*' || e.endIncl) continue;
    const end = parseVersion(e.end);
    if (end && sameBranch(v, end) && (compareVersions(v, end) ?? -1) >= 0) return { status: 'unaffected' };
  }

  if (p.defaultStatus === 'affected') {
    /* "Everything else is affected" cannot speak for releases newer than
       anything the record mentions (PHP 8.5 in a 2024 CVE about 8.1-8.3). */
    const bounds = p.entries.flatMap((e) => [e.exact, e.start, e.end]).map((b) => parseVersion(b)).filter((b): b is Version => b !== null);
    if (bounds.length && bounds.every((b) => (compareVersions(v, b) ?? 0) > 0)) return { status: 'unknown' };
    return { status: 'affected' };
  }
  if (p.defaultStatus === 'unaffected') return { status: 'unaffected' };
  /* No default: a list of affected ranges that does not contain the
     version means it is outside them. A list of loose versions says
     nothing about the others. */
  return affectedRanges > 0 ? { status: 'unaffected' } : { status: 'unknown' };
}

export type CveVerdict =
  | { status: 'affected'; fixedIn?: string }
  | { status: 'not_affected' }
  /* The CVE names other products, not this technology. */
  | { status: 'not_listed' }
  | { status: 'unknown' };

export function evaluateCve(data: CveData, techKeys: string[], cpe: string | null | undefined, version: string): CveVerdict {
  if (!data.products.length) return { status: 'unknown' };
  const products = matchingProducts(data, techKeys, cpe);
  if (!products.length) return { status: 'not_listed' };
  const results = products.map((p) => evaluateProduct(p, version));
  const affected = results.find((r) => r.status === 'affected') as { status: 'affected'; fixedIn?: string } | undefined;
  if (affected) {
    const fixedIn = results.map((r) => (r.status === 'affected' ? r.fixedIn : undefined)).find(Boolean);
    return { status: 'affected', ...(fixedIn ? { fixedIn } : {}) };
  }
  if (results.some((r) => r.status === 'unaffected')) return { status: 'not_affected' };
  return { status: 'unknown' };
}

const CVE_RE = /\bCVE-(\d{4})-(\d{4,7})\b/gi;

/* CVE ids mentioned in a text, upper case, de-duplicated, at most 20. */
export function extractCves(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(CVE_RE)) {
    out.add(`CVE-${m[1]}-${m[2]}`);
    if (out.size >= 20) break;
  }
  return Array.from(out);
}
