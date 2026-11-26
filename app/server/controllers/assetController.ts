import type express from 'express';
import { ASSET_CRITICALITIES, ASSET_TYPES, type AssetCriticality, type AssetRow, type AssetType } from '../db/schema';
import { badRequest, conflict, idParam, isUniqueViolation, notFound, optStr, str, tenantOf } from '../lib/http';
import { assetRepository, type AssetValues } from '../repositories/assetRepository';
import { parseHostname, parseIps } from '../services/assetValidation';
import { ASSET_CSV_TEMPLATE, toAssetCsv } from '../services/assetCsv';
import { importAssets } from '../useCases/importAssets';
import { stackRepository } from '../repositories/stackRepository';
import { defaultMergedValues, findDuplicates, FIELDS, loadMerge, mergeAssets } from '../useCases/mergeAssets';
import { audit } from '../services/logs/logStore';

function csvDownload(res: express.Response, filename: string, body: string) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  /* BOM so Excel opens UTF-8 correctly. */
  res.send('\uFEFF' + body);
}

function assetItem(row: AssetRow, stackItemIds: number[] = [], stackVersions: Record<number, string | null> = {}) {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    criticality: row.criticality,
    environment: row.environment ?? undefined,
    hostname: row.hostname ?? undefined,
    ip: row.ip ?? undefined,
    brand: row.brand ?? undefined,
    model: row.model ?? undefined,
    owner: row.owner ?? undefined,
    notes: row.notes ?? undefined,
    stackItemIds,
    /* Inventory agent: kept up to date automatically; containers point to their host. */
    agent: row.agentId !== null,
    parentAssetId: row.parentAssetId ?? undefined,
    osName: row.osName ?? undefined,
    lastReportAt: row.lastReportAt ?? undefined,
    /* stack row id → version installed on this asset (absent = the row's). */
    stackVersions: Object.fromEntries(Object.entries(stackVersions).filter(([, v]) => v)),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function parseAssetValues(body: any): AssetValues {
  const name = str(body?.name, 100);
  if (!name) throw badRequest('name is required (max 100 characters)');
  const type = (body?.type ?? 'other') as AssetType;
  if (!(ASSET_TYPES as readonly string[]).includes(type)) throw badRequest('Unknown asset type');
  const criticality = (body?.criticality ?? 'medium') as AssetCriticality;
  if (!(ASSET_CRITICALITIES as readonly string[]).includes(criticality)) throw badRequest('Unknown criticality');
  return {
    name,
    type,
    criticality,
    environment: optStr(body?.environment, 50),
    hostname: parseHostname(body?.hostname),
    ip: parseIps(body?.ip),
    brand: optStr(body?.brand, 100),
    model: optStr(body?.model, 100),
    owner: optStr(body?.owner, 100),
    notes: optStr(body?.notes, 1000),
  };
}

function stackItemIdsOf(body: any): number[] | undefined {
  if (body?.stackItemIds === undefined) return undefined;
  if (!Array.isArray(body.stackItemIds) || body.stackItemIds.length > 2000) throw badRequest('stackItemIds must be a list of ids');
  return body.stackItemIds.map(Number).filter((n: number) => Number.isInteger(n) && n > 0);
}

/* Optional {stackRowId: "1.2.3" | null}: versions installed on the asset. */
function stackVersionsOf(body: any): Record<number, string | null> | undefined {
  const v = body?.stackVersions;
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'object' || Array.isArray(v) || Object.keys(v).length > 2000) throw badRequest('stackVersions must be an object of id → version');
  const out: Record<number, string | null> = {};
  for (const [k, raw] of Object.entries(v)) {
    const id = Number(k);
    if (!Number.isInteger(id) || id <= 0) continue;
    if (raw !== null && typeof raw !== 'string') throw badRequest('Versions must be text');
    const s = typeof raw === 'string' ? raw.trim() : '';
    if (s.length > 100) throw badRequest('Version too long (max 100 characters)');
    out[id] = s || null;
  }
  return out;
}

function save<T>(fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict('An asset with that name already exists');
    throw err;
  }
}

export const assetController = {
  list(req: express.Request, res: express.Response) {
    const tid = tenantOf(req);
    const links = assetRepository.stackItemsByAsset(tid);
    const versions = assetRepository.versionsByAsset(tid);
    res.json({
      assets: assetRepository.listByTenant(tid).map((a) => assetItem(a, links.get(a.id) ?? [], versions.get(a.id))),
      types: ASSET_TYPES,
      criticalities: ASSET_CRITICALITIES,
    });
  },

  create(req: express.Request, res: express.Response) {
    const tid = tenantOf(req);
    const values = parseAssetValues(req.body);
    const ids = stackItemIdsOf(req.body);
    const versions = stackVersionsOf(req.body);
    const row = save(() => assetRepository.create(tid, values));
    if (ids) assetRepository.setStackItems(row.id, tid, ids, versions);
    res.status(201).json({ item: assetItem(row, assetRepository.stackItemsByAsset(tid).get(row.id) ?? [], assetRepository.versionsByAsset(tid).get(row.id)) });
  },

  update(req: express.Request, res: express.Response) {
    const id = idParam(req);
    const tid = tenantOf(req);
    if (!assetRepository.findInTenant(id, tid)) throw notFound('Asset not found');
    const values = parseAssetValues(req.body);
    const ids = stackItemIdsOf(req.body);
    const versions = stackVersionsOf(req.body);
    const row = save(() => assetRepository.update(id, tid, values))!;
    if (ids) assetRepository.setStackItems(id, tid, ids, versions);
    res.json({ item: assetItem(row, assetRepository.stackItemsByAsset(tid).get(id) ?? [], assetRepository.versionsByAsset(tid).get(id)) });
  },

  import(req: express.Request, res: express.Response) {
    const csv = typeof req.body === 'string' ? req.body : req.body?.csv;
    if (typeof csv !== 'string') throw badRequest('Send the CSV as text/csv or as {"csv": "..."}');
    const mode = (req.query.mode ?? req.body?.mode) === 'replace' ? 'replace' : 'merge';
    const dryRun = String(req.query.dryRun ?? req.body?.dryRun) === 'true';
    res.json(importAssets(tenantOf(req), csv, mode, dryRun));
  },

  exportCsv(req: express.Request, res: express.Response) {
    const tid = tenantOf(req);
    const links = assetRepository.stackItemsByAsset(tid);
    const versions = assetRepository.versionsByAsset(tid);
    const rows = new Map(stackRepository.listByTenant(tid).map((t) => [t.id, t]));
    const label = (assetId: number, id: number): string | null => {
      const t = rows.get(id);
      if (!t) return null;
      const v = versions.get(assetId)?.[id] || t.version;
      return v ? `${t.technology} ${v}` : t.technology;
    };
    csvDownload(res, 'assets.csv', toAssetCsv(assetRepository.listByTenant(tid).map((a) => ({
      ...a, technologies: (links.get(a.id) ?? []).map((id) => label(a.id, id)).filter((x): x is string => !!x),
    }))));
  },

  template(_req: express.Request, res: express.Response) {
    csvDownload(res, 'assets-template.csv', ASSET_CSV_TEMPLATE);
  },

  /* Likely duplicates, for the "review and merge" list. */
  duplicates(req: express.Request, res: express.Response) {
    res.json({ pairs: findDuplicates(assetRepository.listByTenant(tenantOf(req))) });
  },

  /* POST /assets/merge {targetId, sourceIds, values?, preview?}: with
     preview, returns the default merged values without changing anything. */
  merge(req: express.Request, res: express.Response) {
    const tid = tenantOf(req);
    const targetId = Number(req.body?.targetId);
    const sourceIds = Array.isArray(req.body?.sourceIds) ? req.body.sourceIds.map(Number).filter((n: number) => Number.isInteger(n) && n > 0) : [];
    if (!Number.isInteger(targetId) || targetId <= 0) throw badRequest('targetId is required');
    const plan = loadMerge(tid, targetId, sourceIds);
    const defaults = defaultMergedValues(plan.target, plan.sources);
    if (req.body?.preview === true) {
      res.json({ values: defaults, fields: FIELDS });
      return;
    }
    const chosen = req.body?.values && typeof req.body.values === 'object' ? req.body.values : {};
    const merged: Record<string, unknown> = { ...defaults };
    for (const f of FIELDS) if (Object.prototype.hasOwnProperty.call(chosen, f)) merged[f] = chosen[f];
    const values = parseAssetValues(merged);
    const row = save(() => mergeAssets(tid, plan, values));
    audit({
      action: 'asset.merge',
      detail: `ok into #${row.id} "${row.name}" from ${plan.sources.map((s) => `#${s.id} "${s.name}"`).join(', ')}`,
      userId: req.auth?.user.id ?? null,
      username: req.auth?.user.username ?? null,
      tenantId: tid,
      ip: req.ip ?? null,
    });
    res.json({ item: assetItem(row, assetRepository.stackItemsByAsset(tid).get(row.id) ?? [], assetRepository.versionsByAsset(tid).get(row.id)) });
  },

  remove(req: express.Request, res: express.Response) {
    if (!assetRepository.delete(idParam(req), tenantOf(req))) throw notFound('Asset not found');
    res.json({ success: true });
  },
};
