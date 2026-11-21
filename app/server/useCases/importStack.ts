import { badRequest } from '../lib/http';
import { assetRepository } from '../repositories/assetRepository';
import { stackRepository } from '../repositories/stackRepository';
import { parseStackCsv, stackKey } from '../services/csv';

/* Preview (dryRun) and import share one parser, so what the admin sees in the
   preview is exactly what gets written. */
export function importStack(tenantId: number, csv: string, mode: 'append' | 'replace', dryRun: boolean) {
  const parsed = parseStackCsv(csv);

  const existing = new Map<string, number>();
  if (mode === 'append') {
    for (const r of stackRepository.idsByKey(tenantId)) existing.set(stackKey(r), r.id);
  }
  const toInsert = parsed.rows.filter((r) => !existing.has(stackKey(r)));
  /* Rows already in the stack still get the assets the file lists for them. */
  const toLink = parsed.rows
    .filter((r) => existing.has(stackKey(r)) && r.assets?.length)
    .map((r) => ({ id: existing.get(stackKey(r))!, assets: r.assets! }));

  const knownAssets = new Set(assetRepository.listByTenant(tenantId).map((a) => a.name.toLowerCase()));
  const newAssets = new Map<string, string>();
  for (const r of [...toInsert, ...toLink]) {
    for (const name of r.assets ?? []) {
      if (!knownAssets.has(name.toLowerCase()) && !newAssets.has(name.toLowerCase())) newAssets.set(name.toLowerCase(), name);
    }
  }

  const summary = {
    mode,
    valid: parsed.rows.length,
    toInsert: toInsert.length,
    alreadyPresent: parsed.rows.length - toInsert.length,
    assetLinksToExisting: toLink.length,
    duplicatesInFile: parsed.duplicates,
    errors: parsed.errors.slice(0, 100),
    errorCount: parsed.errors.length,
    willRemove: mode === 'replace' ? stackRepository.count(tenantId) : 0,
    assetsToCreate: Array.from(newAssets.values()).slice(0, 200),
    assetsToCreateCount: newAssets.size,
    preview: toInsert.slice(0, 200),
  };

  if (dryRun) return { dryRun: true, ...summary };
  if (parsed.rows.length === 0) throw badRequest('No valid rows to import', summary);

  const { assetsCreated } = stackRepository.import(tenantId, toInsert.map((r) => ({
    technology: r.technology,
    version: r.version ?? null,
    vendor: r.vendor ?? null,
    category: r.category ?? null,
    assets: r.assets,
  })), mode === 'replace', toLink);

  return { dryRun: false, imported: toInsert.length, assetsCreated, ...summary, preview: undefined };
}
