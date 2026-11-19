import { and, asc, count, eq, ne, sql } from 'drizzle-orm';
import { getDb } from '../db/client';
import { techStack, type StackRow } from '../db/schema';

export interface StackValues {
  technology: string;
  version: string | null;
  vendor: string | null;
  category: string | null;
}

export const stackRepository = {
  listByTenant(tenantId: number): StackRow[] {
    return getDb().select().from(techStack)
      .where(eq(techStack.tenantId, tenantId))
      .orderBy(asc(sql`${techStack.technology} COLLATE NOCASE`), asc(techStack.version))
      .all();
  },

  findInTenant(id: number, tenantId: number): StackRow | undefined {
    return getDb().select().from(techStack).where(and(eq(techStack.id, id), eq(techStack.tenantId, tenantId))).get();
  },

  /* technology + version of every row, optionally leaving one out (for edits). */
  keys(tenantId: number, exceptId?: number) {
    return getDb().select({ technology: techStack.technology, version: techStack.version }).from(techStack)
      .where(exceptId === undefined
        ? eq(techStack.tenantId, tenantId)
        : and(eq(techStack.tenantId, tenantId), ne(techStack.id, exceptId)))
      .all();
  },

  count(tenantId: number): number {
    return getDb().select({ n: count() }).from(techStack).where(eq(techStack.tenantId, tenantId)).get()?.n ?? 0;
  },

  create(tenantId: number, values: StackValues): StackRow {
    return getDb().insert(techStack).values({ tenantId, ...values }).returning().get();
  },

  update(id: number, tenantId: number, values: StackValues): StackRow | undefined {
    return getDb().update(techStack).set(values)
      .where(and(eq(techStack.id, id), eq(techStack.tenantId, tenantId)))
      .returning().get();
  },

  delete(id: number, tenantId: number): boolean {
    return getDb().delete(techStack).where(and(eq(techStack.id, id), eq(techStack.tenantId, tenantId))).run().changes > 0;
  },

  /* One transaction: either the whole import lands or nothing does. */
  import(tenantId: number, rows: StackValues[], replace: boolean): void {
    getDb().transaction((tx) => {
      if (replace) tx.delete(techStack).where(eq(techStack.tenantId, tenantId)).run();
      if (rows.length) tx.insert(techStack).values(rows.map((r) => ({ tenantId, ...r }))).run();
    });
  },
};
