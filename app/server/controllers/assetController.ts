import type express from 'express';
import { isIP } from 'net';
import { ASSET_CRITICALITIES, ASSET_TYPES, type AssetCriticality, type AssetRow, type AssetType } from '../db/schema';
import { badRequest, conflict, idParam, isUniqueViolation, notFound, optStr, str, tenantOf } from '../lib/http';
import { assetRepository, type AssetValues } from '../repositories/assetRepository';

const MAX_IPS = 10;

function assetItem(row: AssetRow, stackItemIds: number[] = []) {
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
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/* One or more IPv4/IPv6 addresses, comma or space separated. */
export function parseIps(v: unknown): string | null {
  const raw = optStr(v, 500);
  if (!raw) return null;
  const ips = Array.from(new Set(raw.split(/[\s,;]+/).filter(Boolean)));
  if (ips.length > MAX_IPS) throw badRequest(`At most ${MAX_IPS} IP addresses per asset`);
  const bad = ips.find((ip) => isIP(ip) === 0);
  if (bad) throw badRequest(`Invalid IP address: ${bad.slice(0, 50)}`);
  return ips.join(', ');
}

const HOSTNAME_RE = /^[A-Za-z0-9_](?:[A-Za-z0-9_.-]{0,252}[A-Za-z0-9_])?$/;

export function parseHostname(v: unknown): string | null {
  const h = optStr(v, 300);
  if (!h) return null;
  if (h.length > 253 || !HOSTNAME_RE.test(h) || h.includes('..')) throw badRequest('Invalid hostname');
  return h;
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
    res.json({
      assets: assetRepository.listByTenant(tid).map((a) => assetItem(a, links.get(a.id) ?? [])),
      types: ASSET_TYPES,
      criticalities: ASSET_CRITICALITIES,
    });
  },

  create(req: express.Request, res: express.Response) {
    const tid = tenantOf(req);
    const values = parseAssetValues(req.body);
    const ids = stackItemIdsOf(req.body);
    const row = save(() => assetRepository.create(tid, values));
    if (ids) assetRepository.setStackItems(row.id, tid, ids);
    res.status(201).json({ item: assetItem(row, assetRepository.stackItemsByAsset(tid).get(row.id) ?? []) });
  },

  update(req: express.Request, res: express.Response) {
    const id = idParam(req);
    const tid = tenantOf(req);
    if (!assetRepository.findInTenant(id, tid)) throw notFound('Asset not found');
    const values = parseAssetValues(req.body);
    const ids = stackItemIdsOf(req.body);
    const row = save(() => assetRepository.update(id, tid, values))!;
    if (ids) assetRepository.setStackItems(id, tid, ids);
    res.json({ item: assetItem(row, assetRepository.stackItemsByAsset(tid).get(id) ?? []) });
  },

  remove(req: express.Request, res: express.Response) {
    if (!assetRepository.delete(idParam(req), tenantOf(req))) throw notFound('Asset not found');
    res.json({ success: true });
  },
};
