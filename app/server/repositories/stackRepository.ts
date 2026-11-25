import { and, asc, count, eq, ne, sql } from 'drizzle-orm';
import { getDb } from '../db/client';
import { assets, stackItemAssets, techStack, type StackRow } from '../db/schema';

export interface StackValues {
  technology: string;
  version: string | null;
  vendor: string | null;
  category: string | null;
  cpe?: string | null;
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

  /* One transaction: either the whole import lands or nothing does.
     `assets` are asset names: missing ones are created with defaults
     (type other, medium criticality) and linked to the row. `link` adds
     assets to rows that already exist (append mode). */
  import(
    tenantId: number,
    rows: Array<StackValues & { assets?: string[] }>,
    replace: boolean,
    link: Array<{ id: number; assets: string[] }> = [],
  ): { assetsCreated: number } {
    let assetsCreated = 0;
    getDb().transaction((tx) => {
      const assetIds = new Map<string, number>();
      for (const a of tx.select({ id: assets.id, name: assets.name }).from(assets).where(eq(assets.tenantId, tenantId)).all()) {
        assetIds.set(a.name.toLowerCase(), a.id);
      }
      const assetId = (name: string): number => {
        const key = name.toLowerCase();
        let id = assetIds.get(key);
        if (id === undefined) {
          id = tx.insert(assets).values({ tenantId, name }).returning({ id: assets.id }).get().id;
          assetIds.set(key, id);
          assetsCreated++;
        }
        return id;
      };
      const linkRow = (stackItemId: number, names: string[] | undefined) => {
        const ids = Array.from(new Set((names ?? []).map(assetId)));
        if (ids.length) tx.insert(stackItemAssets).values(ids.map((id) => ({ stackItemId, assetId: id }))).onConflictDoNothing().run();
      };

      if (replace) tx.delete(techStack).where(eq(techStack.tenantId, tenantId)).run();
      for (const { assets: names, ...values } of rows) {
        const id = tx.insert(techStack).values({ tenantId, ...values }).returning({ id: techStack.id }).get().id;
        linkRow(id, names);
      }
      for (const l of link) linkRow(l.id, l.assets);
    });
    return { assetsCreated };
  },

  /* technology|version key → row id, to link assets to rows already present. */
  idsByKey(tenantId: number): Array<{ id: number; technology: string; version: string | null }> {
    return getDb().select({ id: techStack.id, technology: techStack.technology, version: techStack.version })
      .from(techStack).where(eq(techStack.tenantId, tenantId)).all();
  },
};
