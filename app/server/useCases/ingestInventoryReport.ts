import { and, eq, sql } from 'drizzle-orm';
import { createHash } from 'crypto';
import { getDb } from '../db/client';
import { assets, stackItemAssets, techStack, type AssetRow } from '../db/schema';
import { mapContainer, mapReport, parseReport, type MappedTech, type ParsedReport } from '../services/inventory/report';
import { parseIps } from '../services/assetValidation';

/* Applies one agent report to the company's inventory, in one transaction:
   - the asset is found by machine id, else claimed by host name / asset
     name, else created;
   - each mapped technology is linked with the reported version (the stack
     row is created when the company does not have it yet);
   - technologies the agent added earlier and no longer reports are removed
     after two consecutive reports without them. Links someone added by hand
     are updated but never removed. */

export const MISSING_REPORTS_TO_REMOVE = 2;

export interface IngestResult {
  assetId: number;
  assetName: string;
  created: boolean;
  technologies: number;
  stackRowsCreated: number;
  removed: number;
  containers: number;
  containersCreated: number;
}

function safeIps(ips: string[]): string | null {
  for (let n = ips.length; n > 0; n--) {
    try {
      return parseIps(ips.slice(0, n).join(', '));
    } catch {
      /* drop the last one and retry: an odd address must not lose the report */
    }
  }
  return null;
}

function techKey(s: string): string {
  return s.toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
}

/* The company's stack row for a catalog technology: same name, or a name
   that starts with it as whole words ("Windows 11 Pro" for "Windows 11"). */
function findRow(rows: Array<{ id: number; technology: string }>, tech: string): number | undefined {
  const t = techKey(tech);
  return rows.find((r) => techKey(r.technology) === t)?.id
    ?? rows.find((r) => techKey(r.technology).startsWith(`${t} `))?.id;
}

export function ingestInventoryReport(tenantId: number, text: string): IngestResult {
  const report: ParsedReport = parseReport(text);
  const mapped: MappedTech[] = mapReport(report);
  const db = getDb();

  return db.transaction((tx) => {
    /* ---- asset ---- */
    let asset: AssetRow | undefined = tx.select().from(assets)
      .where(and(eq(assets.tenantId, tenantId), eq(assets.agentId, report.machineId!))).get();
    let created = false;
    if (!asset) {
      const host = report.hostname!;
      const short = host.split('.')[0];
      asset = tx.select().from(assets).where(and(
        eq(assets.tenantId, tenantId),
        sql`${assets.agentId} IS NULL`,
        sql`(${assets.hostname} = ${report.fqdn ?? host} COLLATE NOCASE OR ${assets.hostname} = ${host} COLLATE NOCASE OR ${assets.name} = ${short} COLLATE NOCASE OR ${assets.name} = ${host} COLLATE NOCASE)`,
      )).get();
    }
    const osName = report.winOs?.caption || report.os?.pretty || null;
    const osVersion = report.winOs?.build || report.os?.versionId || null;
    const common = {
      agentId: report.machineId!,
      agentVersion: report.agentVersion,
      osName: osName?.slice(0, 100) ?? null,
      osVersion: osVersion?.slice(0, 50) ?? null,
      lastReportAt: sql`CURRENT_TIMESTAMP`,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    };
    const ip = safeIps(report.ips);
    if (asset) {
      tx.update(assets).set({
        ...common,
        hostname: (report.fqdn || report.hostname!).slice(0, 253),
        ...(ip ? { ip } : {}),
        ...(!asset.brand && report.vendor ? { brand: report.vendor.slice(0, 100) } : {}),
        ...(!asset.model && report.model ? { model: report.model.slice(0, 100) } : {}),
      }).where(eq(assets.id, asset.id)).run();
    } else {
      /* A new host. Keep the name unique within the company. */
      const base = report.hostname!.split('.')[0].slice(0, 90) || 'host';
      let name = base;
      for (let i = 2; tx.select({ id: assets.id }).from(assets).where(and(eq(assets.tenantId, tenantId), sql`${assets.name} = ${name} COLLATE NOCASE`)).get(); i++) {
        name = `${base}-${i}`;
      }
      asset = tx.insert(assets).values({
        tenantId,
        name,
        type: report.type ?? (report.winOs ? 'workstation' : 'server'),
        criticality: 'medium',
        hostname: (report.fqdn || report.hostname!).slice(0, 253),
        ip,
        brand: report.vendor?.slice(0, 100) ?? null,
        model: report.model?.slice(0, 100) ?? null,
        notes: 'Created by the CyberPulse inventory agent.',
        ...common,
      }).returning().get();
      created = true;
    }
    const assetId = asset!.id;

    const rows = tx.select({ id: techStack.id, technology: techStack.technology }).from(techStack).where(eq(techStack.tenantId, tenantId)).all();
    const counters = { stackRowsCreated: 0 };
    const host = applyTechnologies(tx, tenantId, assetId, mapped, rows, counters);

    /* ---- containers: one asset each, linked to this host ---- */
    let containersCreated = 0;
    for (const c of report.containers) {
      const agentId = createHash('sha256').update(`${report.machineId}|container|${c.name}`).digest('hex');
      const osName = c.os?.pretty || null;
      const fields = {
        agentId,
        agentVersion: report.agentVersion,
        osName: osName?.slice(0, 100) ?? null,
        osVersion: c.os?.versionId?.slice(0, 50) || null,
        parentAssetId: assetId,
        model: c.image.slice(0, 100),
        lastReportAt: sql`CURRENT_TIMESTAMP`,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      };
      let ca = tx.select().from(assets).where(and(eq(assets.tenantId, tenantId), eq(assets.agentId, agentId))).get();
      if (ca) {
        tx.update(assets).set(fields).where(eq(assets.id, ca.id)).run();
      } else {
        const base = `${c.name} (${asset!.name})`.slice(0, 96);
        let name = base;
        for (let i = 2; tx.select({ id: assets.id }).from(assets).where(and(eq(assets.tenantId, tenantId), sql`${assets.name} = ${name} COLLATE NOCASE`)).get(); i++) {
          name = `${base}-${i}`;
        }
        ca = tx.insert(assets).values({
          tenantId,
          name,
          type: 'container',
          criticality: asset!.criticality,
          environment: asset!.environment,
          brand: 'Docker',
          notes: `Docker container on ${asset!.name}. Created by the CyberPulse inventory agent.`,
          ...fields,
        }).returning().get();
        containersCreated++;
      }
      applyTechnologies(tx, tenantId, ca!.id, mapContainer(c), rows, counters);
    }

    return {
      assetId, assetName: asset!.name, created, technologies: host.technologies, stackRowsCreated: counters.stackRowsCreated, removed: host.removed,
      containers: report.containers.length, containersCreated,
    };
  });
}

type Tx = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0];

/* Links the mapped technologies to one asset and retires what the agent no
   longer reports (agent-made links only). */
function applyTechnologies(
  tx: Tx,
  tenantId: number,
  assetId: number,
  mapped: MappedTech[],
  rows: Array<{ id: number; technology: string }>,
  counters: { stackRowsCreated: number },
): { technologies: number; removed: number } {
  /* ---- technologies ---- */
  const existing = new Map(tx.select().from(stackItemAssets).where(eq(stackItemAssets.assetId, assetId)).all().map((l) => [l.stackItemId, l]));
  const seen = new Set<number>();
  for (const m of mapped) {
    let rowId = findRow(rows, m.entry.tech);
    if (rowId === undefined) {
      rowId = tx.insert(techStack).values({ tenantId, technology: m.entry.tech, vendor: m.entry.vendor, category: m.entry.category })
        .returning({ id: techStack.id }).get().id;
      rows.push({ id: rowId, technology: m.entry.tech });
      counters.stackRowsCreated++;
    }
    if (seen.has(rowId)) continue;
    seen.add(rowId);
    const prev = existing.get(rowId);
    if (prev) {
      const changed = prev.version !== m.version || prev.package !== m.package;
      tx.update(stackItemAssets).set({
        version: m.version,
        package: m.package,
        lastSeenAt: sql`CURRENT_TIMESTAMP`,
        missingCount: 0,
        ...(changed ? { updatedAt: sql`CURRENT_TIMESTAMP`, osvCves: null, osvCheckedAt: null } : {}),
      }).where(and(eq(stackItemAssets.stackItemId, rowId), eq(stackItemAssets.assetId, assetId))).run();
    } else {
      tx.insert(stackItemAssets).values({
        stackItemId: rowId, assetId, version: m.version, package: m.package, source: 'script',
        lastSeenAt: sql`CURRENT_TIMESTAMP`, updatedAt: sql`CURRENT_TIMESTAMP`,
      }).run();
    }
  }

  /* ---- what the agent no longer reports ---- */
  let removed = 0;
  for (const [rowId, l] of existing) {
    if (seen.has(rowId) || l.source !== 'script') continue;
    if (l.missingCount + 1 >= MISSING_REPORTS_TO_REMOVE) {
      tx.delete(stackItemAssets).where(and(eq(stackItemAssets.stackItemId, rowId), eq(stackItemAssets.assetId, assetId))).run();
      removed++;
    } else {
      tx.update(stackItemAssets).set({ missingCount: l.missingCount + 1 })
        .where(and(eq(stackItemAssets.stackItemId, rowId), eq(stackItemAssets.assetId, assetId))).run();
    }
  }

  return { technologies: seen.size, removed };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
