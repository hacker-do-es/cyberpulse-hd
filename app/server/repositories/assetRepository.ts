import { and, asc, eq, inArray, notInArray, sql } from 'drizzle-orm';
import { getDb } from '../db/client';
import { assets, stackItemAssets, techStack, type AssetCriticality, type AssetRow, type AssetType, type SoftwareSource } from '../db/schema';

export interface AssetValues {
  name: string;
  type: AssetType;
  criticality: AssetCriticality;
  environment: string | null;
  hostname: string | null;
  ip: string | null;
  brand: string | null;
  model: string | null;
  owner: string | null;
  notes: string | null;
}

/* The minimum a digest or a stack row needs to show an asset. */
export interface AssetRef {
  id: number;
  name: string;
  criticality: AssetCriticality;
  environment: string | null;
  hostname: string | null;
  ip: string | null;
}

function ref(a: AssetRow): AssetRef {
  return { id: a.id, name: a.name, criticality: a.criticality, environment: a.environment, hostname: a.hostname, ip: a.ip };
}

export const assetRepository = {
  listByTenant(tenantId: number): AssetRow[] {
    return getDb().select().from(assets)
      .where(eq(assets.tenantId, tenantId))
      .orderBy(asc(sql`${assets.name} COLLATE NOCASE`))
      .all();
  },

  findInTenant(id: number, tenantId: number): AssetRow | undefined {
    return getDb().select().from(assets).where(and(eq(assets.id, id), eq(assets.tenantId, tenantId))).get();
  },

  /* Case-insensitive, like the unique index. */
  findByName(tenantId: number, name: string): AssetRow | undefined {
    return getDb().select().from(assets)
      .where(and(eq(assets.tenantId, tenantId), sql`${assets.name} = ${name} COLLATE NOCASE`))
      .get();
  },

  /* The subset of `ids` that belong to the company (guards cross-tenant links). */
  idsInTenant(tenantId: number, ids: number[]): number[] {
    if (ids.length === 0) return [];
    return getDb().select({ id: assets.id }).from(assets)
      .where(and(eq(assets.tenantId, tenantId), inArray(assets.id, ids)))
      .all().map((r) => r.id);
  },

  create(tenantId: number, values: AssetValues): AssetRow {
    return getDb().insert(assets).values({ tenantId, ...values }).returning().get();
  },

  update(id: number, tenantId: number, values: AssetValues): AssetRow | undefined {
    return getDb().update(assets).set({ ...values, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(and(eq(assets.id, id), eq(assets.tenantId, tenantId)))
      .returning().get();
  },

  delete(id: number, tenantId: number): boolean {
    return getDb().delete(assets).where(and(eq(assets.id, id), eq(assets.tenantId, tenantId))).run().changes > 0;
  },

  /* stack row id → the assets linked to it, for one company. */
  linksByStackItem(tenantId: number): Map<number, AssetRef[]> {
    const rows = getDb().select({ stackItemId: stackItemAssets.stackItemId, asset: assets })
      .from(stackItemAssets)
      .innerJoin(assets, eq(assets.id, stackItemAssets.assetId))
      .where(eq(assets.tenantId, tenantId))
      .orderBy(asc(sql`${assets.name} COLLATE NOCASE`))
      .all();
    const map = new Map<number, AssetRef[]>();
    for (const r of rows) {
      const list = map.get(r.stackItemId) ?? [];
      list.push(ref(r.asset));
      map.set(r.stackItemId, list);
    }
    return map;
  },

  /* stack row id → the assets running it with the version installed on
     each (NULL = the stack row's own version), for one company. */
  softwareByStackItem(tenantId: number): Map<number, Array<{ asset: AssetRef; version: string | null; package?: string | null; osvCves?: string | null; osvCheckedAt?: string | null }>> {
    const rows = getDb().select({
      stackItemId: stackItemAssets.stackItemId, version: stackItemAssets.version, asset: assets,
      package: stackItemAssets.package, osvCves: stackItemAssets.osvCves, osvCheckedAt: stackItemAssets.osvCheckedAt,
    })
      .from(stackItemAssets)
      .innerJoin(assets, eq(assets.id, stackItemAssets.assetId))
      .where(eq(assets.tenantId, tenantId))
      .orderBy(asc(sql`${assets.name} COLLATE NOCASE`))
      .all();
    const map = new Map<number, Array<{ asset: AssetRef; version: string | null; package?: string | null; osvCves?: string | null; osvCheckedAt?: string | null }>>();
    for (const r of rows) {
      const list = map.get(r.stackItemId) ?? [];
      list.push({ asset: ref(r.asset), version: r.version, package: r.package, osvCves: r.osvCves, osvCheckedAt: r.osvCheckedAt });
      map.set(r.stackItemId, list);
    }
    return map;
  },

  /* asset id → { stack row id → installed version (NULL = row's) }. */
  versionsByAsset(tenantId: number): Map<number, Record<number, string | null>> {
    const rows = getDb().select({ assetId: stackItemAssets.assetId, stackItemId: stackItemAssets.stackItemId, version: stackItemAssets.version })
      .from(stackItemAssets)
      .innerJoin(assets, eq(assets.id, stackItemAssets.assetId))
      .where(eq(assets.tenantId, tenantId))
      .all();
    const map = new Map<number, Record<number, string | null>>();
    for (const r of rows) map.set(r.assetId, { ...(map.get(r.assetId) ?? {}), [r.stackItemId]: r.version });
    return map;
  },

  /* asset id → ids of the stack rows linked to it, for one company. */
  stackItemsByAsset(tenantId: number): Map<number, number[]> {
    const rows = getDb().select({ assetId: stackItemAssets.assetId, stackItemId: stackItemAssets.stackItemId })
      .from(stackItemAssets)
      .innerJoin(assets, eq(assets.id, stackItemAssets.assetId))
      .where(eq(assets.tenantId, tenantId))
      .all();
    const map = new Map<number, number[]>();
    for (const r of rows) map.set(r.assetId, [...(map.get(r.assetId) ?? []), r.stackItemId]);
    return map;
  },

  /* Replaces the assets of one stack row. Callers pass ids already checked
     with idsInTenant. */
  setLinks(stackItemId: number, assetIds: number[]): void {
    getDb().transaction((tx) => {
      const unique = Array.from(new Set(assetIds));
      /* Links that stay keep their per-asset version. */
      tx.delete(stackItemAssets).where(and(
        eq(stackItemAssets.stackItemId, stackItemId),
        unique.length ? notInArray(stackItemAssets.assetId, unique) : undefined,
      )).run();
      if (unique.length) {
        tx.insert(stackItemAssets).values(unique.map((assetId) => ({ stackItemId, assetId, updatedAt: sql`CURRENT_TIMESTAMP` })))
          .onConflictDoNothing().run();
      }
    });
  },

  /* Replaces the stack rows linked to one asset (both in the company).
     `versions` (stack row id → installed version, '' or null = the row's
     own) replaces the versions given; links kept without an entry in
     `versions` keep the version they had. */
  setStackItems(assetId: number, tenantId: number, stackItemIds: number[], versions?: Record<number, string | null>, source: SoftwareSource = 'manual'): void {
    const db = getDb();
    const valid = stackItemIds.length
      ? db.select({ id: techStack.id }).from(techStack)
        .where(and(eq(techStack.tenantId, tenantId), inArray(techStack.id, stackItemIds))).all().map((r) => r.id)
      : [];
    db.transaction((tx) => {
      const before = new Map(tx.select({ id: stackItemAssets.stackItemId, version: stackItemAssets.version, source: stackItemAssets.source })
        .from(stackItemAssets).where(eq(stackItemAssets.assetId, assetId)).all().map((r) => [r.id, r]));
      tx.delete(stackItemAssets).where(eq(stackItemAssets.assetId, assetId)).run();
      const unique = Array.from(new Set(valid));
      if (unique.length) {
        tx.insert(stackItemAssets).values(unique.map((stackItemId) => {
          const prev = before.get(stackItemId);
          const given = versions && Object.prototype.hasOwnProperty.call(versions, stackItemId);
          const version = given ? (versions![stackItemId] || null) : (prev?.version ?? null);
          const changed = !prev || (given && (prev.version ?? null) !== version);
          return {
            stackItemId,
            assetId,
            version,
            source: changed ? source : (prev?.source ?? source),
            updatedAt: sql`CURRENT_TIMESTAMP`,
          };
        })).run();
      }
    });
  },
};
