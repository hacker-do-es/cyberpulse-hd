/* Shared shape of a digest for every channel renderer (chat and email):
   items grouped by the most critical asset they affect, critical assets
   first, and within a group the most severe news first. */

export type Tier = 'high' | 'medium' | 'low' | 'none';
export const TIER_ORDER: Tier[] = ['high', 'medium', 'low', 'none'];
export const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low'];

export interface ReportItem {
  title: string;
  url: string;
  source: string;
  severity: string;
  /* Technologies matched (shown when there is no confirmed fix data). */
  matchedTech: string[];
  /* Version-verified items: the CVEs, best CVSS, and what to upgrade. */
  cves?: string[];
  cvss?: number | null;
  fixes?: Array<{ technology: string; version: string | null; fixedIn?: string }>;
  /* Affected assets, formatted; only on channels that include them. */
  assets?: string[];
  /* Most critical asset affected ('none' = no linked asset). */
  tier?: Tier;
}

export interface ReportLabels {
  severity: Record<string, string>;
  affects: string;
  assets?: string;
  tiers?: Record<Tier, string>;
  updateTo?: string;
  inCritical?: string;
  severityCount?: Record<string, [string, string]>;
}

function sevRank(s: string): number {
  const i = SEVERITY_ORDER.indexOf((s || 'low').toLowerCase());
  return i === -1 ? SEVERITY_ORDER.length : i;
}

export function sortItems<T extends ReportItem>(items: T[]): T[] {
  return [...items].sort((a, b) => sevRank(a.severity) - sevRank(b.severity) || (b.cvss ?? -1) - (a.cvss ?? -1));
}

/* Groups by tier. When no item has a linked asset there is nothing to
   group by: one unnamed group, most severe first. */
export function groupByTier<T extends ReportItem>(items: T[]): Array<{ tier: Tier | null; items: T[] }> {
  if (!items.some((i) => i.tier && i.tier !== 'none')) return items.length ? [{ tier: null, items: sortItems(items) }] : [];
  return TIER_ORDER
    .map((tier) => ({ tier, items: sortItems(items.filter((i) => (i.tier ?? 'none') === tier)) }))
    .filter((g) => g.items.length > 0);
}

export function severityCounts(items: ReportItem[]): Array<[string, number]> {
  return SEVERITY_ORDER
    .map((s) => [s, items.filter((i) => (i.severity || 'low').toLowerCase() === s).length] as [string, number])
    .filter(([, n]) => n > 0);
}

/* "2 críticas" / "1 crítica" */
export function countLabel(labels: ReportLabels, sev: string, n: number): string {
  const forms = labels.severityCount?.[sev];
  if (forms) return `${n} ${n === 1 ? forms[0] : forms[1]}`;
  return `${n} ${(labels.severity[sev] ?? sev).toLowerCase()}`;
}
