import { and, count, desc, eq, gte, inArray, isNull, like, max, notExists, or, sql, type SQL } from 'drizzle-orm';
import { getDb } from '../db/client';
import { articles, channelSentArticles, type ArticleRow, type NewArticle } from '../db/schema';

export const articleRepository = {
  list(opts: { sources?: string[]; search?: string; limit: number }): ArticleRow[] {
    const conditions: (SQL | undefined)[] = [];
    if (opts.sources?.length) conditions.push(inArray(articles.source, opts.sources));
    if (opts.search) {
      const term = `%${opts.search}%`;
      conditions.push(or(like(articles.title, term), like(articles.summary, term)));
    }
    return getDb().select().from(articles)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(articles.publishedAt))
      .limit(opts.limit)
      .all();
  },

  findById(id: number): ArticleRow | undefined {
    return getDb().select().from(articles).where(eq(articles.id, id)).get();
  },

  latestFetched(limit: number): ArticleRow[] {
    return getDb().select().from(articles).orderBy(desc(articles.fetchedAt), desc(articles.id)).limit(limit).all();
  },

  /* Cheap fingerprint of the corpus: changes whenever articles are added or
     pruned. Used to invalidate cached stack matches. */
  corpusVersion(): string {
    const row = getDb().select({ n: count(), last: max(articles.id) }).from(articles).get();
    return `${row?.n ?? 0}:${row?.last ?? 0}`;
  },

  count(): number {
    return getDb().select({ n: count() }).from(articles).get()?.n ?? 0;
  },

  countBySource(source: string): number {
    return getDb().select({ n: count() }).from(articles).where(eq(articles.source, source)).get()?.n ?? 0;
  },

  /* Articles fetched since `since` that this channel has not delivered yet. */
  undeliveredForChannel(channelId: number, since: string, publishedAfter: string, limit = 5000): ArticleRow[] {
    const db = getDb();
    return db.select().from(articles)
      .where(and(
        gte(articles.fetchedAt, since),
        or(isNull(articles.publishedAt), gte(articles.publishedAt, publishedAfter)),
        notExists(
          db.select({ one: sql`1` }).from(channelSentArticles)
            .where(and(eq(channelSentArticles.channelId, channelId), eq(channelSentArticles.articleId, articles.id))),
        ),
      ))
      .orderBy(desc(articles.fetchedAt))
      .limit(limit)
      .all();
  },

  /* Inserts a feed's items in one transaction (one commit per feed instead of
     one per article). Existing URLs are ignored. Returns how many were new. */
  insertMany(rows: NewArticle[], onRowError?: (err: unknown) => void): number {
    const db = getDb();
    return db.transaction((tx) => {
      let added = 0;
      for (const row of rows) {
        try {
          added += tx.insert(articles).values(row).onConflictDoNothing().run().changes;
        } catch (err) {
          onRowError?.(err);
        }
      }
      return added;
    });
  },

  /* Retention: keep the newest `keep` articles per source. */
  pruneKeepPerSource(keep = 100): void {
    getDb().run(sql`
      DELETE FROM articles WHERE id NOT IN (
        SELECT id FROM (
          SELECT id, ROW_NUMBER() OVER (PARTITION BY source ORDER BY published_at DESC) AS rn FROM articles
        ) WHERE rn <= ${keep}
      )`);
  },
};
