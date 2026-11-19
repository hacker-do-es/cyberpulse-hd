import { and, eq, gt, inArray, lt, sql } from 'drizzle-orm';
import { getDb } from '../db/client';
import { sessions, tenants, users } from '../db/schema';

export const sessionRepository = {
  create(id: string, userId: number, activeTenantId: number | null, hours: number): void {
    const db = getDb();
    db.insert(sessions).values({
      id, userId, activeTenantId,
      expiresAt: sql`datetime('now', ${`+${hours} hours`})`,
    }).run();
  },

  /* The session, its user and whether the user's company is active.
     Expired sessions are not returned. */
  findValid(id: string) {
    return getDb().select({
      sessionId: sessions.id,
      activeTenantId: sessions.activeTenantId,
      user: users,
      tenantActive: tenants.active,
    }).from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .leftJoin(tenants, eq(tenants.id, users.tenantId))
      .where(and(eq(sessions.id, id), gt(sessions.expiresAt, sql`CURRENT_TIMESTAMP`)))
      .get();
  },

  setActiveTenant(id: string, tenantId: number | null): void {
    getDb().update(sessions).set({ activeTenantId: tenantId }).where(eq(sessions.id, id)).run();
  },

  delete(id: string): void {
    getDb().delete(sessions).where(eq(sessions.id, id)).run();
  },

  deleteForUser(userId: number): void {
    getDb().delete(sessions).where(eq(sessions.userId, userId)).run();
  },

  deleteForTenant(tenantId: number): void {
    const db = getDb();
    db.delete(sessions)
      .where(inArray(sessions.userId, db.select({ id: users.id }).from(users).where(eq(users.tenantId, tenantId))))
      .run();
  },

  purgeExpired(): void {
    getDb().delete(sessions).where(lt(sessions.expiresAt, sql`CURRENT_TIMESTAMP`)).run();
  },
};
