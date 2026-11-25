/* Does a news item's vulnerability really affect this company?

   The keyword matcher (techMatcher.ts) only says an article talks about a
   technology in the stack. Here each CVE the article cites is checked
   against the version actually installed on every asset running that
   technology (or the stack row's version when it has no assets):

     affected      a CVE's affected ranges contain an installed version
     not_affected  every CVE was checked and none contains any version
     pending       CVE data not downloaded yet
     unverified    no version, no usable data, or undecidable versions
     no_cve        the article cites no CVE

   Only "affected" counts as a confirmed vulnerability. */

import type { StackRow } from '../../db/schema';
import type { AssetRef } from '../../repositories/assetRepository';
import type { CveRecord } from '../../repositories/cveRepository';
import { evaluateCve, extractCves, keyOf, matchingProducts } from './cveData';

export type ArticleVulnStatus = 'affected' | 'not_affected' | 'pending' | 'unverified' | 'no_cve';
export type UnitStatus = 'affected' | 'not_affected' | 'not_listed' | 'unknown' | 'no_version' | 'pending';

/* One place a technology runs: an asset, or the stack row itself. */
export interface Unit {
  stackId: number;
  technology: string;
  version: string | null;
  asset: AssetRef | null;
}

export interface UnitVerdict {
  stackId: number;
  technology: string;
  version: string | null;
  assetId: number | null;
  status: UnitStatus;
  /* The CVE that makes it affected, and the first fixed version if known. */
  cve?: string;
  fixedIn?: string;
}

export interface ArticleVuln {
  status: ArticleVulnStatus;
  cves: string[];
  units: UnitVerdict[];
}

/* Extra product names CVE records use for a technology (normalised). The
   stack row's `cpe` field covers anything not listed here. */
const PRODUCT_ALIASES: Record<string, string[]> = {
  node: ['nodejs'],
  nodejs: ['nodejs'],
  postgres: ['postgresql'],
  linuxkernel: ['linuxkernel', 'linux'],
  dockerengine: ['docker', 'dockerengine', 'moby'],
  docker: ['docker', 'dockerengine'],
  apachehttpserver: ['httpserver', 'apachehttpserver'],
  apachehttpd: ['httpserver', 'apachehttpserver'],
  vuejs: ['vue', 'vuejs'],
  openssh: ['openssh'],
  windows11pro: ['windows11'],
  windows11: ['windows11'],
};

/* "LiteLLM (LLM proxy)" → ["litellm"]; "Cloud Functions / Cloud Run" → both. */
export function techKeys(technology: string): string[] {
  const base = technology.replace(/\([^)]*\)?/g, ' ').replace(/\s+/g, ' ').trim();
  const keys = new Set<string>([keyOf(base)]);
  for (const part of base.split(/\s+[/+&]\s+|\s*,\s*/)) keys.add(keyOf(part));
  for (const k of Array.from(keys)) for (const a of PRODUCT_ALIASES[k] ?? []) keys.add(a);
  keys.delete('');
  return Array.from(keys);
}

export function buildUnits(
  rows: Pick<StackRow, 'id' | 'technology' | 'version'>[],
  software: Map<number, Array<{ asset: AssetRef; version: string | null }>>,
): Map<number, Unit[]> {
  const out = new Map<number, Unit[]>();
  for (const r of rows) {
    const links = software.get(r.id) ?? [];
    out.set(r.id, links.length
      ? links.map((l) => ({ stackId: r.id, technology: r.technology, version: l.version || r.version || null, asset: l.asset }))
      : [{ stackId: r.id, technology: r.technology, version: r.version || null, asset: null }]);
  }
  return out;
}

export interface VerdictContext {
  units: Map<number, Unit[]>;
  /* stack row id → its explicit "vendor:product", if any */
  cpe: Map<number, string | null>;
  records: Map<string, CveRecord>;
}

export function articleCves(article: { title: string; summary?: string | null }): string[] {
  return extractCves(`${article.title} ${article.summary ?? ''}`);
}

const MAX_UNITS = 60;

export function evaluateArticle(cves: string[], matchedStackIds: number[], ctx: VerdictContext): ArticleVuln {
  if (!cves.length) return { status: 'no_cve', cves, units: [] };
  const units: UnitVerdict[] = [];
  const keysCache = new Map<number, string[]>();
  for (const stackId of Array.from(new Set(matchedStackIds))) {
    for (const u of ctx.units.get(stackId) ?? []) {
      const base = { stackId, technology: u.technology, version: u.version, assetId: u.asset?.id ?? null };
      let keys = keysCache.get(stackId);
      if (!keys) {
        keys = techKeys(u.technology);
        keysCache.set(stackId, keys);
      }
      if (!u.version) {
        /* Without a version we can still tell a CVE is about another product. */
        const elsewhere = cves.every((cve) => {
          const data = ctx.records.get(cve)?.data;
          return !!data && data.products.length > 0 && matchingProducts(data, keys!, ctx.cpe.get(stackId)).length === 0;
        });
        units.push({ ...base, status: elsewhere ? 'not_listed' : 'no_version' });
        continue;
      }
      let affected: UnitVerdict | null = null;
      let pending = false;
      let unknown = false;
      let notAffected = false;
      for (const cve of cves) {
        const rec = ctx.records.get(cve);
        if (!rec) {
          pending = true;
          continue;
        }
        if (!rec.data) {
          unknown = true;
          continue;
        }
        const v = evaluateCve(rec.data, keys, ctx.cpe.get(stackId), u.version);
        if (v.status === 'affected') {
          affected = { ...base, status: 'affected', cve, ...(v.fixedIn ? { fixedIn: v.fixedIn } : {}) };
          break;
        }
        if (v.status === 'not_affected') notAffected = true;
        else if (v.status === 'unknown') unknown = true;
      }
      units.push(affected
        ?? { ...base, status: pending ? 'pending' : unknown ? 'unknown' : notAffected ? 'not_affected' : 'not_listed' });
    }
  }
  const capped = units.length > MAX_UNITS
    ? [...units.filter((u) => u.status === 'affected'), ...units.filter((u) => u.status !== 'affected')].slice(0, MAX_UNITS)
    : units;

  let status: ArticleVulnStatus;
  if (units.some((u) => u.status === 'affected')) status = 'affected';
  else if (units.some((u) => u.status === 'pending')) status = 'pending';
  else if (units.length && units.every((u) => u.status === 'not_affected' || u.status === 'not_listed')) status = 'not_affected';
  else status = 'unverified';
  return { status, cves, units: capped };
}

/* Affected assets (most critical first) and technology labels of a verdict. */
export function affectedAssetIds(v: ArticleVuln): Set<number> {
  return new Set(v.units.filter((u) => u.status === 'affected' && u.assetId !== null).map((u) => u.assetId!));
}
