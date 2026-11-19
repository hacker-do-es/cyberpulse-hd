import type express from 'express';
import { config } from '../config';
import type { StackRow } from '../db/schema';
import { badRequest, conflict, idParam, notFound, optStr, str, tenantOf } from '../lib/http';
import { stackRepository, type StackValues } from '../repositories/stackRepository';
import { CSV_TEMPLATE, stackKey, toStackCsv } from '../services/csv';
import { getStackNews } from '../services/stackNews';
import { importStack } from '../useCases/importStack';

function stackItem(row: StackRow) {
  return {
    id: row.id,
    technology: row.technology,
    version: row.version || undefined,
    vendor: row.vendor || undefined,
    category: row.category || undefined,
    createdAt: row.createdAt,
  };
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
    res.json({ stack: stackRepository.listByTenant(tenantOf(req)).map(stackItem) });
  },

  create(req: express.Request, res: express.Response) {
    const tid = tenantOf(req);
    const row = stackRepository.create(tid, parseStackValues(req.body, tid));
    res.status(201).json({ item: stackItem(row) });
  },

  /* Edits one row in place; empty optional fields are cleared. */
  update(req: express.Request, res: express.Response) {
    const id = idParam(req);
    const tid = tenantOf(req);
    const technology = str(req.body?.technology, 100);
    if (!technology) throw badRequest('technology is required (max 100 characters)');
    if (!stackRepository.findInTenant(id, tid)) throw notFound('Tech stack item not found');
    const row = stackRepository.update(id, tid, parseStackValues(req.body, tid, id));
    res.json({ item: stackItem(row!) });
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
    csvDownload(res, 'tech-stack.csv', toStackCsv(stackRepository.listByTenant(tenantOf(req))));
  },

  template(_req: express.Request, res: express.Response) {
    csvDownload(res, 'tech-stack-template.csv', CSV_TEMPLATE);
  },

  /* My Stack: the corpus matched against the company's stack. */
  async news(req: express.Request, res: express.Response) {
    const limit = Math.min(Number(req.query.limit) || 1000, config.maxNews);
    res.json(await getStackNews(tenantOf(req), limit));
  },
};
