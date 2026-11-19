import { asc, eq, sql } from 'drizzle-orm';
import { getDb } from '../db/client';
import { channels, techStack, tenants, users, type TenantRow } from '../db/schema';

export type TenantUpdate = Partial<Pick<TenantRow,
  'name' | 'language' | 'timezone' | 'aiProvider' | 'aiModel' | 'aiKey' | 'aiBaseUrl' | 'active'>>;

const byName = sql`${tenants.name} COLLATE NOCASE`;

export const tenantRepository = {
  findById(id: number): TenantRow | undefined {
    return getDb().select().from(tenants).where(eq(tenants.id, id)).get();
  },

  listBasic(onlyId?: number | null) {
    return getDb().select({ id: tenants.id, name: tenants.name, active: tenants.active })
      .from(tenants)
      .where(onlyId !== undefined ? eq(tenants.id, onlyId ?? -1) : undefined)
      .orderBy(byName)
      .all();
  },

  /* Companies with user / stack / channel counts, for the superadmin list. */
  summaries(id?: number) {
    return getDb().select({
      id: tenants.id,
      name: tenants.name,
      language: tenants.language,
      timezone: tenants.timezone,
      active: tenants.active,
      aiProvider: tenants.aiProvider,
      createdAt: tenants.createdAt,
      users: sql<number>`(SELECT COUNT(*) FROM ${users} WHERE ${users.tenantId} = ${tenants.id})`,
      stack: sql<number>`(SELECT COUNT(*) FROM ${techStack} WHERE ${techStack.tenantId} = ${tenants.id})`,
      channels: sql<number>`(SELECT COUNT(*) FROM ${channels} WHERE ${channels.tenantId} = ${tenants.id})`,
    }).from(tenants)
      .where(id !== undefined ? eq(tenants.id, id) : undefined)
      .orderBy(asc(byName))
      .all();
  },

  create(values: { name: string; language: 'en' | 'es'; timezone: string }): TenantRow {
    return getDb().insert(tenants).values(values).returning().get();
  },

  update(id: number, values: TenantUpdate): void {
    if (Object.keys(values).length === 0) return;
    getDb().update(tenants).set(values).where(eq(tenants.id, id)).run();
  },

  /* Cascades to users, sessions, stack, channels and delivery history. */
  delete(id: number): boolean {
    return getDb().delete(tenants).where(eq(tenants.id, id)).run().changes > 0;
  },
};
