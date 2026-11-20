import { eq } from 'drizzle-orm';
import type { LinkedInSlot } from '../config';
import { getDb } from '../db/client';
import { linkedinAccounts, linkedinPageAccounts, linkedinPosts, type LinkedinAccountRow } from '../db/schema';

/* One LinkedIn connection per user and app: 'main' (own profile, or both in
   single-app setups) and 'pages' (separate Community Management app). */
const table = (slot: LinkedInSlot) => (slot === 'pages' ? linkedinPageAccounts : linkedinAccounts);

export const linkedinRepository = {
  find(userId: number, slot: LinkedInSlot = 'main'): LinkedinAccountRow | undefined {
    const t = table(slot);
    return getDb().select().from(t).where(eq(t.userId, userId)).get();
  },

  upsert(slot: LinkedInSlot, row: Omit<LinkedinAccountRow, 'connectedAt'>): void {
    const t = table(slot);
    const { userId, ...rest } = row;
    getDb().insert(t).values({ userId, ...rest })
      .onConflictDoUpdate({ target: t.userId, set: { ...rest, connectedAt: new Date().toISOString().slice(0, 19).replace('T', ' ') } })
      .run();
  },

  delete(userId: number, slot: LinkedInSlot = 'main'): boolean {
    const t = table(slot);
    return getDb().delete(t).where(eq(t.userId, userId)).run().changes > 0;
  },

  setOrganizations(userId: number, slot: LinkedInSlot, organizationsJson: string | null): void {
    const t = table(slot);
    getDb().update(t).set({ organizations: organizationsJson }).where(eq(t.userId, userId)).run();
  },

  logPost(userId: number, tenantId: number | null, postUrn: string, chars: number, author: string): void {
    getDb().insert(linkedinPosts).values({ userId, tenantId, postUrn, chars, author }).run();
  },
};
