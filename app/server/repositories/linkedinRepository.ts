import { eq } from 'drizzle-orm';
import { getDb } from '../db/client';
import { linkedinAccounts, linkedinPosts, type LinkedinAccountRow } from '../db/schema';

export const linkedinRepository = {
  find(userId: number): LinkedinAccountRow | undefined {
    return getDb().select().from(linkedinAccounts).where(eq(linkedinAccounts.userId, userId)).get();
  },

  upsert(row: Omit<LinkedinAccountRow, 'connectedAt'>): void {
    const { userId, ...rest } = row;
    getDb().insert(linkedinAccounts).values({ userId, ...rest })
      .onConflictDoUpdate({ target: linkedinAccounts.userId, set: { ...rest, connectedAt: new Date().toISOString().slice(0, 19).replace('T', ' ') } })
      .run();
  },

  delete(userId: number): boolean {
    return getDb().delete(linkedinAccounts).where(eq(linkedinAccounts.userId, userId)).run().changes > 0;
  },

  logPost(userId: number, tenantId: number | null, postUrn: string, chars: number): void {
    getDb().insert(linkedinPosts).values({ userId, tenantId, postUrn, chars }).run();
  },
};
