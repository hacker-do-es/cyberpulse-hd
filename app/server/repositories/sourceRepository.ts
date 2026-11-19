import { and, asc, count, desc, eq, max, ne, sql } from 'drizzle-orm';
import { getDb } from '../db/client';
import { fetchLog, sources, type SourceRow } from '../db/schema';

export interface SeedSource {
  name: string;
  rssUrl: string;
  category: string;
  active?: boolean;
}

export const sourceRepository = {
  listAll(): SourceRow[] {
    return getDb().select().from(sources).orderBy(asc(sources.name)).all();
  },

  listActive(): SourceRow[] {
    return getDb().select().from(sources).where(eq(sources.active, true)).orderBy(asc(sources.name)).all();
  },

  countActive(): number {
    return getDb().select({ n: count() }).from(sources).where(eq(sources.active, true)).get()?.n ?? 0;
  },

  findById(id: number): SourceRow | undefined {
    return getDb().select().from(sources).where(eq(sources.id, id)).get();
  },

  createCustom(name: string, rssUrl: string, category: string): SourceRow {
    return getDb().insert(sources)
      .values({ name, rssUrl, category, active: true, custom: true })
      .returning().get();
  },

  setActive(id: number, active: boolean): SourceRow | undefined {
    return getDb().update(sources).set({ active }).where(eq(sources.id, id)).returning().get();
  },

  /* Only user-added sources can be removed. */
  deleteCustom(id: number): boolean {
    return getDb().delete(sources).where(and(eq(sources.id, id), eq(sources.custom, true))).run().changes > 0;
  },

  updateStats(name: string, articleCount: number): void {
    getDb().update(sources)
      .set({ articleCount, lastFetch: sql`CURRENT_TIMESTAMP` })
      .where(eq(sources.name, name)).run();
  },

  /* Built-in feeds move and break, so the shipped URL wins over whatever the
     database holds. User-added sources are untouched, and `active` is only
     set on insert so an operator's enable/disable choice sticks. */
  seed(list: SeedSource[]): { inserted: number; updated: number } {
    return getDb().transaction((tx) => {
      let inserted = 0;
      let updated = 0;
      for (const s of list) {
        const ins = tx.insert(sources)
          .values({ name: s.name, rssUrl: s.rssUrl, category: s.category, active: s.active !== false, custom: false })
          .onConflictDoNothing().run();
        if (ins.changes > 0) {
          inserted++;
          continue;
        }
        updated += tx.update(sources)
          .set({ rssUrl: s.rssUrl, category: s.category })
          .where(and(eq(sources.name, s.name), eq(sources.custom, false), ne(sources.rssUrl, s.rssUrl)))
          .run().changes;
      }
      return { inserted, updated };
    });
  },
};

export const fetchLogRepository = {
  record(source: string, found: number, added: number, error?: string): void {
    getDb().insert(fetchLog).values({ source, articlesFound: found, articlesNew: added, error: error ?? null }).run();
  },

  lastFetch(): string | null {
    return getDb().select({ last: max(fetchLog.fetchedAt) }).from(fetchLog).get()?.last ?? null;
  },

  recent(limit = 10) {
    return getDb().select({
      source: fetchLog.source,
      articles_new: fetchLog.articlesNew,
      error: fetchLog.error,
      fetched_at: fetchLog.fetchedAt,
    }).from(fetchLog).orderBy(desc(fetchLog.fetchedAt), desc(fetchLog.id)).limit(limit).all();
  },
};
