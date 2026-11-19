import { and, asc, count, eq, ne, sql } from 'drizzle-orm';
import { getDb } from '../db/client';
import { tenants, users, type Role, type UserRow } from '../db/schema';

export type UserUpdate = Partial<Pick<UserRow,
  'role' | 'active' | 'displayName' | 'passwordHash' | 'totpSecret' | 'totpEnabled' | 'totpLastStep' |
  'failedLogins' | 'lockedUntil' | 'lastLoginAt'>>;

/* Usernames are matched regardless of case (backed by a lower() unique index). */
const usernameIs = (username: string) => sql`lower(${users.username}) = lower(${username})`;

export const userRepository = {
  findById(id: number): UserRow | undefined {
    return getDb().select().from(users).where(eq(users.id, id)).get();
  },

  findInTenant(id: number, tenantId: number): UserRow | undefined {
    return getDb().select().from(users).where(and(eq(users.id, id), eq(users.tenantId, tenantId))).get();
  },

  findByUsername(username: string): UserRow | undefined {
    return getDb().select().from(users).where(usernameIs(username)).get();
  },

  /* For login: the user and whether its company is active. */
  findForLogin(username: string) {
    return getDb().select({ user: users, tenantActive: tenants.active }).from(users)
      .leftJoin(tenants, eq(tenants.id, users.tenantId))
      .where(usernameIs(username))
      .get();
  },

  listByTenant(tenantId: number): UserRow[] {
    return getDb().select().from(users).where(eq(users.tenantId, tenantId)).orderBy(asc(sql`${users.username} COLLATE NOCASE`)).all();
  },

  create(values: { username: string; passwordHash: string; role: Role; tenantId: number | null; displayName?: string | null }): UserRow {
    return getDb().insert(users).values({ ...values, displayName: values.displayName ?? null }).returning().get();
  },

  update(id: number, values: UserUpdate): void {
    if (Object.keys(values).length === 0) return;
    getDb().update(users).set(values).where(eq(users.id, id)).run();
  },

  /* Reserves one login attempt atomically before the (async) password check,
     so concurrent requests cannot all read the same counter and slip past
     the lockout. Returns the attempt number, or null if the account is
     currently locked. */
  reserveLoginAttempt(id: number): number | null {
    const row = getDb().update(users)
      .set({ failedLogins: sql`${users.failedLogins} + 1` })
      .where(and(eq(users.id, id), sql`(${users.lockedUntil} IS NULL OR ${users.lockedUntil} <= CURRENT_TIMESTAMP)`))
      .returning({ attempt: users.failedLogins })
      .get();
    return row?.attempt ?? null;
  },

  /* Gives back an attempt that turned out not to be a failure. */
  releaseLoginAttempt(id: number): void {
    getDb().update(users)
      .set({ failedLogins: sql`max(${users.failedLogins} - 1, 0)` })
      .where(eq(users.id, id)).run();
  },

  /* Records a TOTP time step only if it is newer than the last one used, so
     the same code cannot be replayed, even by two concurrent requests. */
  claimTotpStep(id: number, step: number): boolean {
    return getDb().update(users).set({ totpLastStep: step })
      .where(and(eq(users.id, id), sql`(${users.totpLastStep} IS NULL OR ${users.totpLastStep} < ${step})`))
      .run().changes > 0;
  },

  lockFor(id: number, minutes: number): void {
    getDb().update(users)
      .set({ failedLogins: 0, lockedUntil: sql`datetime('now', ${`+${minutes} minutes`})` })
      .where(eq(users.id, id)).run();
  },

  recordLogin(id: number): void {
    getDb().update(users)
      .set({ failedLogins: 0, lockedUntil: null, lastLoginAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(users.id, id)).run();
  },

  delete(id: number): void {
    getDb().delete(users).where(eq(users.id, id)).run();
  },

  countSuperadmins(): number {
    return getDb().select({ n: count() }).from(users).where(eq(users.role, 'superadmin')).get()?.n ?? 0;
  },

  /* Active admins of a company other than `exceptUserId`. */
  countOtherActiveAdmins(tenantId: number, exceptUserId: number): number {
    return getDb().select({ n: count() }).from(users)
      .where(and(eq(users.tenantId, tenantId), eq(users.role, 'admin'), eq(users.active, true), ne(users.id, exceptUserId)))
      .get()?.n ?? 0;
  },

  listAll() {
    return getDb().select({
      username: users.username, role: users.role, active: users.active,
      totpEnabled: users.totpEnabled, company: tenants.name,
    }).from(users).leftJoin(tenants, eq(tenants.id, users.tenantId))
      .orderBy(asc(users.role), asc(users.username)).all();
  },
};
