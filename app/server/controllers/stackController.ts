import type express from 'express';
import { config } from '../config';
import type { StackRow } from '../db/schema';
import { badRequest, conflict, idParam, notFound, optStr, str, tenantOf } from '../lib/http';
import { assetRepository, type AssetRef } from '../repositories/assetRepository';
import { stackRepository, type StackValues } from '../repositories/stackRepository';
import { CSV_TEMPLATE, stackKey, toStackCsv } from '../services/csv';
import { getStackNewsWithAssets } from '../services/stackNews';
import { importStack } from '../useCases/importStack';

function stackItem(row: StackRow, assets: AssetRef[] = []) {
  return {
    id: row.id,
    technology: row.technology,
    version: row.version || undefined,
    vendor: row.vendor || undefined,
    category: row.category || undefined,
    assets,
    createdAt: row.createdAt,
  };
}

/* Optional `assetIds`: when present, replaces the row's assets. Ids from
   another company are rejected. */
function assetIdsOf(body: any, tenantId: number): number[] | undefined {
  if (body?.assetIds === undefined) return undefined;
  if (!Array.isArray(body.assetIds) || body.assetIds.length > 500) throw badRequest('assetIds must be a list of ids');
  const ids = Array.from(new Set<number>(body.assetIds.map(Number).filter((n: number) => Number.isInteger(n) && n > 0)));
  const valid = assetRepository.idsInTenant(tenantId, ids);
  if (valid.length !== ids.length) throw badRequest('Unknown asset');
  return valid;
}

/* Shared by create and edit. `exceptId` excludes the row being edited from
   the duplicate check. */
function parseStackValues(body: any, tenantId: number, exceptId?: number): StackValues {
  const technology = str(body?.technology, 100);
  if (!technology) throw badRequest('technology is required (max 100 characters)');
  const version = optStr(body?.version, 100);
  const key = stackKey({ technology, version });
  if (stackRepository.keys(tenantId, exceptId).some((r) => stackKey(r) === key)) {
    throw conflict('That technology and version are already in the stack');
  }
  return { technology, version, vendor: optStr(body?.vendor, 100), category: optStr(body?.category, 100) };
}

function csvDownload(res: express.Response, filename: string, body: string) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  /* BOM so Excel opens UTF-8 correctly. */
  res.send('﻿' + body);
}

export const stackController = {
  list(req: express.Request, res: express.Response) {
    const tid = tenantOf(req);
    const links = assetRepository.linksByStackItem(tid);
    res.json({ stack: stackRepository.listByTenant(tid).map((r) => stackItem(r, links.get(r.id) ?? [])) });
  },

  create(req: express.Request, res: express.Response) {
    const tid = tenantOf(req);
    const values = parseStackValues(req.body, tid);
    const assetIds = assetIdsOf(req.body, tid);
    const row = stackRepository.create(tid, values);
    if (assetIds) assetRepository.setLinks(row.id, assetIds);
    res.status(201).json({ item: stackItem(row, assetRepository.linksByStackItem(tid).get(row.id) ?? []) });
  },

  /* Edits one row in place; empty optional fields are cleared. */
  update(req: express.Request, res: express.Response) {
    const id = idParam(req);
    const tid = tenantOf(req);
    const technology = str(req.body?.technology, 100);
    if (!technology) throw badRequest('technology is required (max 100 characters)');
    if (!stackRepository.findInTenant(id, tid)) throw notFound('Tech stack item not found');
    const values = parseStackValues(req.body, tid, id);
    const assetIds = assetIdsOf(req.body, tid);
    const row = stackRepository.update(id, tid, values);
    if (assetIds) assetRepository.setLinks(id, assetIds);
    res.json({ item: stackItem(row!, assetRepository.linksByStackItem(tid).get(id) ?? []) });
  },

  remove(req: express.Request, res: express.Response) {
    if (!stackRepository.delete(idParam(req), tenantOf(req))) throw notFound('Tech stack item not found');
    res.json({ success: true });
  },

  import(req: express.Request, res: express.Response) {
    const csv = typeof req.body === 'string' ? req.body : req.body?.csv;
    if (typeof csv !== 'string') throw badRequest('Send the CSV as text/csv or as {"csv": "..."}');
    const mode = (req.query.mode ?? req.body?.mode) === 'replace' ? 'replace' : 'append';
    const dryRun = String(req.query.dryRun ?? req.body?.dryRun) === 'true';
    res.json(importStack(tenantOf(req), csv, mode, dryRun));
  },

  exportCsv(req: express.Request, res: express.Response) {
    const tid = tenantOf(req);
    const links = assetRepository.linksByStackItem(tid);
    csvDownload(res, 'tech-stack.csv', toStackCsv(stackRepository.listByTenant(tid).map((r) => ({
      ...r, assets: (links.get(r.id) ?? []).map((a) => a.name),
    }))));
  },

  template(_req: express.Request, res: express.Response) {
    csvDownload(res, 'tech-stack-template.csv', CSV_TEMPLATE);
  },

  /* My Stack: the corpus matched against the company's stack. */
  async news(req: express.Request, res: express.Response) {
    const limit = Math.min(Number(req.query.limit) || 1000, config.maxNews);
    res.json(await getStackNewsWithAssets(tenantOf(req), limit));
  },
};
