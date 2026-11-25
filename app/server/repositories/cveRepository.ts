import { inArray, sql } from 'drizzle-orm';
import { getDb } from '../db/client';
import { cveRecords, type CveRecordRow } from '../db/schema';
import { mergeCveData, type CveData } from '../services/vuln/cveData';

/* Each source is stored apart so one can be refreshed without the other. */
export interface CveParts {
  cveOrg: CveData | null;
  nvd: CveData | null;
}

export interface CveRecord {
  cveId: string;
  status: 'ok' | 'not_found' | 'error';
  parts: CveParts;
  /* Both sources merged; null when neither has data. */
  data: CveData | null;
  fetchedAt: string;
  nvdFetchedAt: string | null;
}

function toRecord(row: CveRecordRow): CveRecord {
  let parts: CveParts = { cveOrg: null, nvd: null };
  try {
    if (row.data) parts = { cveOrg: null, nvd: null, ...JSON.parse(row.data) };
  } catch {
    /* corrupt row: treated as no data, re-fetched later */
  }
  return {
    cveId: row.cveId,
    status: row.status as CveRecord['status'],
    parts,
    data: parts.cveOrg || parts.nvd ? mergeCveData(parts.cveOrg, parts.nvd) : null,
    fetchedAt: row.fetchedAt,
    nvdFetchedAt: row.nvdFetchedAt,
  };
}

export const cveRepository = {
  getMany(ids: string[]): Map<string, CveRecord> {
    const out = new Map<string, CveRecord>();
    const unique = Array.from(new Set(ids));
    /* SQLite caps bound parameters; chunk the lookup. */
    for (let i = 0; i < unique.length; i += 500) {
      const chunk = unique.slice(i, i + 500);
      for (const row of getDb().select().from(cveRecords).where(inArray(cveRecords.cveId, chunk)).all()) {
        out.set(row.cveId, toRecord(row));
      }
    }
    return out;
  },

  upsert(r: { cveId: string; status: CveRecord['status']; parts: CveParts; fetchedAt: string; nvdFetchedAt: string | null; error?: string | null }): void {
    const values = {
      cveId: r.cveId,
      status: r.status,
      data: JSON.stringify(r.parts),
      fetchedAt: r.fetchedAt,
      nvdFetchedAt: r.nvdFetchedAt,
      error: r.error ?? null,
    };
    getDb().insert(cveRecords).values(values)
      .onConflictDoUpdate({ target: cveRecords.cveId, set: values })
      .run();
  },

  /* Drop records nobody has needed for a long time (re-fetched on demand). */
  pruneOlderThan(cutoff: string): number {
    return getDb().delete(cveRecords).where(sql`${cveRecords.fetchedAt} < ${cutoff}`).run().changes;
  },

  count(): number {
    return getDb().select({ n: sql<number>`count(*)` }).from(cveRecords).get()?.n ?? 0;
  },
};
