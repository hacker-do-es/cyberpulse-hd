import { badRequest } from '../lib/http';
import { stackRepository } from '../repositories/stackRepository';
import { parseStackCsv, stackKey } from '../services/csv';

/* Preview (dryRun) and import share one parser, so what the admin sees in the
   preview is exactly what gets written. */
export function importStack(tenantId: number, csv: string, mode: 'append' | 'replace', dryRun: boolean) {
  const parsed = parseStackCsv(csv);

  const existing = mode === 'append'
    ? new Set(stackRepository.keys(tenantId).map(stackKey))
    : new Set<string>();
  const toInsert = parsed.rows.filter((r) => !existing.has(stackKey(r)));

  const summary = {
    mode,
    valid: parsed.rows.length,
    toInsert: toInsert.length,
    alreadyPresent: parsed.rows.length - toInsert.length,
    duplicatesInFile: parsed.duplicates,
    errors: parsed.errors.slice(0, 100),
    errorCount: parsed.errors.length,
    willRemove: mode === 'replace' ? stackRepository.count(tenantId) : 0,
    preview: toInsert.slice(0, 200),
  };

  if (dryRun) return { dryRun: true, ...summary };
  if (parsed.rows.length === 0) throw badRequest('No valid rows to import', summary);

  stackRepository.import(tenantId, toInsert.map((r) => ({
    technology: r.technology,
    version: r.version ?? null,
    vendor: r.vendor ?? null,
    category: r.category ?? null,
  })), mode === 'replace');

  return { dryRun: false, imported: toInsert.length, ...summary, preview: undefined };
}
