import { and, eq, inArray, sql } from 'drizzle-orm';
import { getDb } from '../db/client';
import { assets, stackItemAssets, type AssetRow } from '../db/schema';
import { badRequest } from '../lib/http';
import { assetRepository } from '../repositories/assetRepository';
import { stackRepository } from '../repositories/stackRepository';
import { parseAssetCsv, type AssetCsvRow } from '../services/assetCsv';

/* "PHP 8.2" matches the row PHP / 8.2; "PHP" matches every PHP row.
   "nginx 1.22.1" with no such row but an "nginx" row links that row with
   1.22.1 as the version installed on this asset. */
type TechLink = { id: number; version: string | null };

function techResolver(tenantId: number) {
  const rows = stackRepository.idsByKey(tenantId);
  const exact = new Map<string, number[]>();
  const byName = new Map<string, number[]>();
  for (const r of rows) {
    const name = r.technology.trim().toLowerCase();
    byName.set(name, [...(byName.get(name) ?? []), r.id]);
    if (r.version) {
      const full = `${name} ${r.version.trim().toLowerCase()}`;
      exact.set(full, [...(exact.get(full) ?? []), r.id]);
    }
  }
  const names = Array.from(byName.keys()).sort((a, b) => b.length - a.length);
  return (label: string): TechLink[] => {
    const raw = label.trim();
    const k = raw.toLowerCase();
    const hit = exact.get(k) ?? byName.get(k);
    if (hit) return hit.map((id) => ({ id, version: null }));
    /* Longest known name followed by a version: "WordPress 6.2.2". */
    for (const name of names) {
      if (!k.startsWith(`${name} `)) continue;
      const version = raw.slice(name.length).trim();
      if (!/^v?\d/i.test(version) || version.length > 100) continue;
      return [{ id: byName.get(name)![0], version }];
    }
    return [];
  };
}

/* Preview (dryRun) and import share the parser and the plan, so the preview
   shows exactly what will be written. `merge` creates new assets and updates
   existing ones (matched by name, case-insensitive); `replace` also deletes
   the company's assets that are not in the file. */
export function importAssets(tenantId: number, csv: string, mode: 'merge' | 'replace', dryRun: boolean) {
  const parsed = parseAssetCsv(csv);
  const existing = new Map<string, AssetRow>(assetRepository.listByTenant(tenantId).map((a) => [a.name.toLowerCase(), a]));
  const resolve = techResolver(tenantId);

  const toCreate: AssetCsvRow[] = [];
  const toUpdate: Array<AssetCsvRow & { id: number }> = [];
  const unknownTech = new Set<string>();
  const links = new Map<string, TechLink[]>();

  for (const r of parsed.rows) {
    const hit = existing.get(r.name.toLowerCase());
    if (hit) toUpdate.push({ ...r, id: hit.id });
    else toCreate.push(r);
    if (r.technologies) {
      const byId = new Map<number, string | null>();
      for (const t of r.technologies) {
        const found = resolve(t);
        if (found.length === 0) unknownTech.add(t);
        for (const f of found) if (!byId.has(f.id) || f.version) byId.set(f.id, f.version);
      }
      links.set(r.name.toLowerCase(), Array.from(byId, ([id, version]) => ({ id, version })));
    }
  }

  const inFile = new Set(parsed.rows.map((r) => r.name.toLowerCase()));
  const toDelete = mode === 'replace' ? Array.from(existing.values()).filter((a) => !inFile.has(a.name.toLowerCase())) : [];

  const summary = {
    mode,
    valid: parsed.rows.length,
    toCreate: toCreate.length,
    toUpdate: toUpdate.length,
    toDelete: toDelete.length,
    deleteNames: toDelete.slice(0, 50).map((a) => a.name),
    duplicatesInFile: parsed.duplicates,
    columns: parsed.columns,
    unknownTechnologies: Array.from(unknownTech).slice(0, 50),
    errors: parsed.errors.slice(0, 100),
    errorCount: parsed.errors.length,
    preview: parsed.rows.slice(0, 200).map((r) => ({
      name: r.name,
      action: existing.has(r.name.toLowerCase()) ? 'update' : 'create',
      ...r.values,
      technologies: r.technologies,
    })),
  };

  if (dryRun) return { dryRun: true, ...summary };
  if (parsed.rows.length === 0) throw badRequest('No valid rows to import', summary);

  getDb().transaction((tx) => {
    if (toDelete.length) {
      tx.delete(assets).where(and(eq(assets.tenantId, tenantId), inArray(assets.id, toDelete.map((a) => a.id)))).run();
    }
    const setLinks = (assetId: number, list: TechLink[] | undefined) => {
      if (list === undefined) return;
      tx.delete(stackItemAssets).where(eq(stackItemAssets.assetId, assetId)).run();
      if (list.length) {
        tx.insert(stackItemAssets).values(list.map((l) => ({
          stackItemId: l.id, assetId, version: l.version, source: 'csv', updatedAt: sql`CURRENT_TIMESTAMP`,
        }))).run();
      }
    };
    for (const r of toCreate) {
      const id = tx.insert(assets).values({ tenantId, name: r.name, ...r.values }).returning({ id: assets.id }).get().id;
      setLinks(id, links.get(r.name.toLowerCase()));
    }
    for (const r of toUpdate) {
      if (Object.keys(r.values).length) {
        tx.update(assets).set({ ...r.values, updatedAt: sql`CURRENT_TIMESTAMP` })
          .where(and(eq(assets.id, r.id), eq(assets.tenantId, tenantId))).run();
      }
      setLinks(r.id, links.get(r.name.toLowerCase()));
    }
  });

  return { dryRun: false, created: toCreate.length, updated: toUpdate.length, deleted: toDelete.length, ...summary, preview: undefined };
}
