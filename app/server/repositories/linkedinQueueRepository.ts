import { and, desc, eq, inArray, lte, sql } from 'drizzle-orm';
import { getDb } from '../db/client';
import { linkedinQueue, type LinkedinQueueRow, type LinkedinQueueStatus } from '../db/schema';

export type QueueInsert = Omit<typeof linkedinQueue.$inferInsert, 'id' | 'createdAt'>;

export const linkedinQueueRepository = {
  create(v: QueueInsert): LinkedinQueueRow {
    return getDb().insert(linkedinQueue).values(v).returning().get();
  },

  find(id: number): LinkedinQueueRow | undefined {
    return getDb().select().from(linkedinQueue).where(eq(linkedinQueue.id, id)).get();
  },

  findInTenant(id: number, tenantId: number): LinkedinQueueRow | undefined {
    return getDb().select().from(linkedinQueue).where(and(eq(linkedinQueue.id, id), eq(linkedinQueue.tenantId, tenantId))).get();
  },

  listByTenant(tenantId: number, statuses: LinkedinQueueStatus[] | null, limit = 200): LinkedinQueueRow[] {
    const where = statuses?.length
      ? and(eq(linkedinQueue.tenantId, tenantId), inArray(linkedinQueue.status, statuses))
      : eq(linkedinQueue.tenantId, tenantId);
    return getDb().select().from(linkedinQueue).where(where).orderBy(desc(linkedinQueue.id)).limit(limit).all();
  },

  update(id: number, v: Partial<QueueInsert>): void {
    getDb().update(linkedinQueue).set(v).where(eq(linkedinQueue.id, id)).run();
  },

  /* Atomically moves a row from one status to another; false if someone else got there first. */
  transition(id: number, from: LinkedinQueueStatus[], v: Partial<QueueInsert> & { status: LinkedinQueueStatus }): boolean {
    return getDb().update(linkedinQueue).set(v)
      .where(and(eq(linkedinQueue.id, id), inArray(linkedinQueue.status, from))).run().changes > 0;
  },

  /* Scheduled posts whose time has come (UTC 'YYYY-MM-DD HH:MM:SS'). */
  due(nowSql: string, limit = 20): LinkedinQueueRow[] {
    return getDb().select().from(linkedinQueue)
      .where(and(eq(linkedinQueue.status, 'scheduled'), lte(linkedinQueue.scheduledFor, nowSql)))
      .orderBy(linkedinQueue.scheduledFor).limit(limit).all();
  },

  /* Posts a channel produced since `sinceSql` that count against its daily limit. */
  countForChannelSince(channelId: number, sinceSql: string): number {
    const r = getDb().select({ n: sql<number>`count(*)` }).from(linkedinQueue)
      .where(and(
        eq(linkedinQueue.channelId, channelId),
        inArray(linkedinQueue.status, ['pending', 'scheduled', 'publishing', 'published']),
        sql`${linkedinQueue.createdAt} >= ${sinceSql}`,
      )).get();
    return Number(r?.n ?? 0);
  },

  /* A worker that died mid-publish leaves rows in 'publishing'. */
  recoverStuck(olderThanSql: string): number {
    return getDb().update(linkedinQueue)
      .set({ status: 'failed', error: 'Publishing was interrupted; check LinkedIn before retrying' })
      .where(and(eq(linkedinQueue.status, 'publishing'), lte(linkedinQueue.decidedAt, olderThanSql))).run().changes;
  },
};
