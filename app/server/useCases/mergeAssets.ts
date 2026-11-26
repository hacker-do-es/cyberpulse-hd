import { and, eq, inArray, sql } from 'drizzle-orm';
import { getDb } from '../db/client';
import { assets, stackItemAssets, type AssetRow } from '../db/schema';
import { badRequest, notFound } from '../lib/http';
import type { AssetValues } from '../repositories/assetRepository';

/* Merges duplicate assets into one: the target keeps its id (and so its
   history), takes the field values chosen by the user, the union of the
   technologies, the sources' child containers and, if a source is reported
   by an inventory agent, that agent's identity, so future reports keep
   updating the merged asset. The sources are deleted. One transaction. */

export const FIELDS = ['name', 'type', 'criticality', 'environment', 'hostname', 'ip', 'brand', 'model', 'owner', 'notes'] as const;

const AGENT_NOTE = /^(Created by the CyberPulse inventory agent\.|Docker container on .*Created by the CyberPulse inventory agent\.)$/s;

function present(v: unknown): boolean {
  return v !== null && v !== undefined && String(v).trim() !== '';
}

/* Default merged values: the target's, filling its blanks from the sources
   in order; notes are combined (agent boilerplate left out when there is
   anything else). */
export function defaultMergedValues(target: AssetRow, sources: AssetRow[]): AssetValues {
  const all = [target, ...sources];
  const out: Record<string, unknown> = {};
  for (const f of FIELDS) {
    if (f === 'notes') continue;
    out[f] = all.map((a) => a[f as keyof AssetRow]).find(present) ?? null;
  }
  const notes = Array.from(new Set(all.map((a) => (a.notes ?? '').trim()).filter(Boolean)));
  const human = notes.filter((n) => !AGENT_NOTE.test(n));
  out.notes = (human.length ? human : notes).join('\n\n').slice(0, 1000) || null;
  return out as unknown as AssetValues;
}

export interface MergePlan {
  target: AssetRow;
  sources: AssetRow[];
}

export function loadMerge(tenantId: number, targetId: number, sourceIds: number[]): MergePlan {
  const ids = Array.from(new Set(sourceIds.filter((id) => id !== targetId)));
  if (!ids.length) throw badRequest('Pick at least one other asset to merge');
  if (ids.length > 20) throw badRequest('At most 20 assets per merge');
  const db = getDb();
  const target = db.select().from(assets).where(and(eq(assets.id, targetId), eq(assets.tenantId, tenantId))).get();
  if (!target) throw notFound('Asset not found');
  const sources = db.select().from(assets).where(and(inArray(assets.id, ids), eq(assets.tenantId, tenantId))).all();
  if (sources.length !== ids.length) throw notFound('Asset not found');
  const agents = [target, ...sources].filter((a) => a.agentId);
  if (agents.length > 1) {
    throw badRequest('Two of these assets are reported by inventory agents (different machines or containers): they cannot be merged');
  }
  return { target, sources: ids.map((id) => sources.find((s) => s.id === id)!) };
}

export function mergeAssets(tenantId: number, plan: MergePlan, values: AssetValues): AssetRow {
  const { target, sources } = plan;
  const sourceIds = sources.map((s) => s.id);
  const agent = [target, ...sources].find((a) => a.agentId) ?? null;

  return getDb().transaction((tx) => {
    /* Technologies: one link per stack row. The agent's measured version
       wins, then any link with a version, then the target's. */
    const links = tx.select().from(stackItemAssets).where(inArray(stackItemAssets.assetId, [target.id, ...sourceIds])).all();
    const rank = (l: typeof links[number]) =>
      (l.source === 'script' ? 4 : 0) + (l.version ? 2 : 0) + (l.assetId === target.id ? 1 : 0);
    const best = new Map<number, typeof links[number]>();
    for (const l of links) {
      const prev = best.get(l.stackItemId);
      if (!prev || rank(l) > rank(prev)) best.set(l.stackItemId, l);
    }

    /* Children (containers) of the sources now belong to the target. */
    tx.update(assets).set({ parentAssetId: target.id })
      .where(and(eq(assets.tenantId, tenantId), inArray(assets.parentAssetId, sourceIds))).run();

    /* Sources go first: frees their unique name and agent id. */
    tx.delete(assets).where(and(eq(assets.tenantId, tenantId), inArray(assets.id, sourceIds))).run();
    tx.delete(stackItemAssets).where(eq(stackItemAssets.assetId, target.id)).run();
    if (best.size) {
      tx.insert(stackItemAssets).values(Array.from(best.values()).map((l) => ({
        stackItemId: l.stackItemId,
        assetId: target.id,
        version: l.version,
        source: l.source,
        lastSeenAt: l.lastSeenAt,
        updatedAt: sql`CURRENT_TIMESTAMP`,
        package: l.package,
        osvCves: l.osvCves,
        osvCheckedAt: l.osvCheckedAt,
        missingCount: l.missingCount,
      }))).run();
    }

    const parent = agent?.parentAssetId ?? target.parentAssetId;
    const row = tx.update(assets).set({
      ...values,
      agentId: agent?.agentId ?? null,
      agentVersion: agent?.agentVersion ?? null,
      osName: agent?.osName ?? target.osName,
      osVersion: agent?.osVersion ?? target.osVersion,
      lastReportAt: agent?.lastReportAt ?? target.lastReportAt,
      parentAssetId: parent && !sourceIds.includes(parent) && parent !== target.id ? parent : null,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    }).where(eq(assets.id, target.id)).returning().get();
    return row!;
  });
}

/* ------------------------------------------------------------------ */
/*  Likely duplicates                                                  */
/* ------------------------------------------------------------------ */

export type DuplicateReason = 'same-hostname' | 'name-is-hostname' | 'notes-mention-container' | 'similar-name';

export interface DuplicatePair {
  ids: [number, number];
  reason: DuplicateReason;
}

const key = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/* "plex (MG-SERVER (NUC))" → "plex" */
function containerName(a: AssetRow): string | null {
  if (a.type !== 'container' || !a.parentAssetId) return null;
  const m = a.name.match(/^(.+?) \(/);
  return m ? m[1] : a.name;
}

export function findDuplicates(rows: AssetRow[]): DuplicatePair[] {
  const out: DuplicatePair[] = [];
  const seen = new Set<string>();
  const add = (a: AssetRow, b: AssetRow, reason: DuplicateReason) => {
    if (a.id === b.id || (a.agentId && b.agentId)) return;
    /* A host and its own containers are not duplicates. */
    if (a.parentAssetId === b.id || b.parentAssetId === a.id) return;
    const k = [Math.min(a.id, b.id), Math.max(a.id, b.id)].join('-');
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ ids: [Math.min(a.id, b.id), Math.max(a.id, b.id)], reason });
  };
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i];
      const b = rows[j];
      const ha = (a.hostname ?? '').toLowerCase();
      const hb = (b.hostname ?? '').toLowerCase();
      if (ha && ha === hb) add(a, b, 'same-hostname');
      else if ((ha && ha === b.name.toLowerCase()) || (hb && hb === a.name.toLowerCase())) add(a, b, 'name-is-hostname');
    }
  }
  for (const c of rows) {
    const cn = containerName(c);
    if (!cn) continue;
    const word = new RegExp(`(^|[^a-z0-9-])${cn.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9-]|$)`);
    const ck = key(cn);
    for (const m of rows) {
      if (m.agentId || m.id === c.id) continue;
      if (word.test((m.notes ?? '').toLowerCase())) add(c, m, 'notes-mention-container');
      else if (ck.length >= 4 && (key(m.name).startsWith(ck) || (key(m.name).length >= 4 && ck.startsWith(key(m.name))))) add(c, m, 'similar-name');
    }
  }
  return out;
}
