import { and, asc, count, desc, eq, isNotNull, lte, lt, sql } from 'drizzle-orm';
import { getDb } from '../db/client';
import {
  channelSentArticles, channels, deliveries, tenants,
  type ChannelRow, type DeliveryStatus, type NewChannel,
} from '../db/schema';

export type ChannelValues = Omit<NewChannel, 'id' | 'tenantId' | 'createdAt' | 'lastRunAt' | 'lastSentAt' | 'nextRunAt'>;

export const channelRepository = {
  findById(id: number): ChannelRow | undefined {
    return getDb().select().from(channels).where(eq(channels.id, id)).get();
  },

  findInTenant(id: number, tenantId: number): ChannelRow | undefined {
    return getDb().select().from(channels).where(and(eq(channels.id, id), eq(channels.tenantId, tenantId))).get();
  },

  listByTenant(tenantId: number): ChannelRow[] {
    return getDb().select().from(channels).where(eq(channels.tenantId, tenantId)).orderBy(asc(channels.name)).all();
  },

  idsByTenant(tenantId: number): number[] {
    return getDb().select({ id: channels.id }).from(channels).where(eq(channels.tenantId, tenantId)).all().map((r) => r.id);
  },

  count(tenantId: number): number {
    return getDb().select({ n: count() }).from(channels).where(eq(channels.tenantId, tenantId)).get()?.n ?? 0;
  },

  create(tenantId: number, values: ChannelValues): ChannelRow {
    return getDb().insert(channels).values({ ...values, tenantId }).returning().get();
  },

  update(id: number, tenantId: number, values: Partial<ChannelValues>): ChannelRow | undefined {
    return getDb().update(channels).set(values)
      .where(and(eq(channels.id, id), eq(channels.tenantId, tenantId)))
      .returning().get();
  },

  delete(id: number, tenantId: number): boolean {
    return getDb().delete(channels).where(and(eq(channels.id, id), eq(channels.tenantId, tenantId))).run().changes > 0;
  },

  /* The channel's schedule plus its company's time zone. */
  scheduleOf(id: number) {
    return getDb().select({
      scheduleType: channels.scheduleType,
      intervalHours: channels.intervalHours,
      timeOfDay: channels.timeOfDay,
      weekdays: channels.weekdays,
      timezone: tenants.timezone,
    }).from(channels).innerJoin(tenants, eq(tenants.id, channels.tenantId)).where(eq(channels.id, id)).get();
  },

  setNextRun(id: number, nextRunAt: string): void {
    getDb().update(channels).set({ nextRunAt }).where(eq(channels.id, id)).run();
  },

  setLastRun(id: number, lastRunAt: string): void {
    getDb().update(channels).set({ lastRunAt }).where(eq(channels.id, id)).run();
  },

  /* Active channels of active companies whose slot is due. */
  dueIds(nowSql: string): number[] {
    return getDb().select({ id: channels.id }).from(channels)
      .innerJoin(tenants, eq(tenants.id, channels.tenantId))
      .where(and(
        eq(channels.active, true), eq(tenants.active, true),
        isNotNull(channels.nextRunAt), lte(channels.nextRunAt, nowSql),
      ))
      .orderBy(asc(channels.nextRunAt))
      .all().map((r) => r.id);
  },

  /* After a successful send: remember the articles and the send time together. */
  markSent(id: number, articleIds: number[], sentAt: string): void {
    getDb().transaction((tx) => {
      if (articleIds.length) {
        tx.insert(channelSentArticles)
          .values(articleIds.map((articleId) => ({ channelId: id, articleId })))
          .onConflictDoNothing().run();
      }
      tx.update(channels).set({ lastSentAt: sentAt }).where(eq(channels.id, id)).run();
    });
  },
};

export const deliveryRepository = {
  record(v: { channelId: number; tenantId: number; trigger: string; status: DeliveryStatus; articleCount: number; detail: string }): void {
    getDb().insert(deliveries).values({ ...v, detail: v.detail.slice(0, 1000) }).run();
  },

  listForChannel(channelId: number, limit = 50) {
    return getDb().select({
      id: deliveries.id,
      trigger: deliveries.trigger,
      status: deliveries.status,
      articleCount: deliveries.articleCount,
      detail: deliveries.detail,
      createdAt: deliveries.createdAt,
    }).from(deliveries).where(eq(deliveries.channelId, channelId)).orderBy(desc(deliveries.id)).limit(limit).all();
  },

  prune(): void {
    const db = getDb();
    db.delete(channelSentArticles).where(lt(channelSentArticles.sentAt, sql`datetime('now', '-60 days')`)).run();
    db.delete(deliveries).where(lt(deliveries.createdAt, sql`datetime('now', '-180 days')`)).run();
  },
};
