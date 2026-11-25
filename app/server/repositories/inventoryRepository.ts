import { and, desc, eq, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';
import { getDb } from '../db/client';
import { assets, inventoryTokens, stackItemAssets, techStack, type InventoryTokenRow } from '../db/schema';

export const inventoryTokenRepository = {
  listByTenant(tenantId: number): InventoryTokenRow[] {
    return getDb().select().from(inventoryTokens)
      .where(eq(inventoryTokens.tenantId, tenantId))
      .orderBy(desc(inventoryTokens.createdAt), desc(inventoryTokens.id))
      .all();
  },

  countActive(tenantId: number): number {
    return getDb().select({ n: sql<number>`count(*)` }).from(inventoryTokens)
      .where(and(eq(inventoryTokens.tenantId, tenantId), isNull(inventoryTokens.revokedAt))).get()?.n ?? 0;
  },

  create(v: { tenantId: number; name: string; tokenHash: string; prefix: string; createdBy: number | null; expiresAt: string | null }): InventoryTokenRow {
    return getDb().insert(inventoryTokens).values(v).returning().get();
  },

  /* Active (not revoked, not expired) token by hash. */
  findActiveByHash(hash: string, nowSql: string): InventoryTokenRow | undefined {
    return getDb().select().from(inventoryTokens)
      .where(and(
        eq(inventoryTokens.tokenHash, hash),
        isNull(inventoryTokens.revokedAt),
        or(isNull(inventoryTokens.expiresAt), sql`${inventoryTokens.expiresAt} > ${nowSql}`),
      ))
      .get();
  },

  markUsed(id: number, ip: string | null): void {
    getDb().update(inventoryTokens).set({ lastUsedAt: sql`CURRENT_TIMESTAMP`, lastUsedIp: ip }).where(eq(inventoryTokens.id, id)).run();
  },

  revoke(id: number, tenantId: number): boolean {
    return getDb().update(inventoryTokens).set({ revokedAt: sql`CURRENT_TIMESTAMP` })
      .where(and(eq(inventoryTokens.id, id), eq(inventoryTokens.tenantId, tenantId), isNull(inventoryTokens.revokedAt)))
      .run().changes > 0;
  },
};

/* Assets that report through an agent, with how many technologies the
   agent maintains on each. */
export function agentAssets(tenantId: number) {
  const db = getDb();
  const rows = db.select().from(assets)
    .where(and(eq(assets.tenantId, tenantId), isNotNull(assets.agentId)))
    .orderBy(sql`${assets.name} COLLATE NOCASE`)
    .all();
  const counts = new Map<number, number>();
  for (const r of db.select({ assetId: stackItemAssets.assetId, n: sql<number>`count(*)` })
    .from(stackItemAssets).innerJoin(assets, eq(assets.id, stackItemAssets.assetId))
    .where(and(eq(assets.tenantId, tenantId), eq(stackItemAssets.source, 'script')))
    .groupBy(stackItemAssets.assetId).all()) counts.set(r.assetId, r.n);
  return rows.map((a) => ({ asset: a, technologies: counts.get(a.id) ?? 0 }));
}

/* Agent-maintained links whose distro package needs an OSV (re)check. */
export function linksNeedingOsv(olderThanSql: string, assetId?: number, limit = 2000) {
  return getDb().select({
    stackItemId: stackItemAssets.stackItemId,
    assetId: stackItemAssets.assetId,
    package: stackItemAssets.package,
  }).from(stackItemAssets)
    .where(and(
      isNotNull(stackItemAssets.package),
      or(isNull(stackItemAssets.osvCheckedAt), lt(stackItemAssets.osvCheckedAt, olderThanSql)),
      assetId === undefined ? undefined : eq(stackItemAssets.assetId, assetId),
    ))
    .limit(limit)
    .all();
}

export function saveOsvResult(stackItemId: number, assetId: number, pkg: string, cves: string[]): void {
  /* Only if the package did not change meanwhile (a newer report). */
  getDb().update(stackItemAssets)
    .set({ osvCves: JSON.stringify(cves), osvCheckedAt: sql`CURRENT_TIMESTAMP` })
    .where(and(eq(stackItemAssets.stackItemId, stackItemId), eq(stackItemAssets.assetId, assetId), eq(stackItemAssets.package, pkg)))
    .run();
}

export { techStack };
