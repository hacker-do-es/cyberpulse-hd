import type express from 'express';
import fs from 'fs';
import { randomBytes } from 'crypto';
import { fileURLToPath } from 'url';
import { badRequest, conflict, HttpError, idParam, notFound, str, tenantOf } from '../lib/http';
import { agentAssets, inventoryTokenRepository } from '../repositories/inventoryRepository';
import { audit } from '../services/logs/logStore';
import { ReportError } from '../services/inventory/report';
import { toSqlUtc } from '../services/schedule';
import { runOsvJob } from '../services/vuln/osv';
import { hashToken, ingestInventoryReport } from '../useCases/ingestInventoryReport';

const TOKEN_RE = /^cpi_[A-Za-z0-9_-]{40,60}$/;
const MAX_TOKENS = 20;
/* An asset whose agent has not reported for this long is shown as stale. */
export const STALE_AFTER_DAYS = 7;

const AGENTS_DIR = fileURLToPath(new URL('../agents/', import.meta.url));
const SCRIPTS: Record<string, { file: string; type: string }> = {
  linux: { file: 'cyberpulse-agent.sh', type: 'text/x-shellscript; charset=utf-8' },
  windows: { file: 'cyberpulse-agent.ps1', type: 'text/plain; charset=utf-8' },
};

function tokenItem(t: ReturnType<typeof inventoryTokenRepository.listByTenant>[number]) {
  return {
    id: t.id,
    name: t.name,
    prefix: t.prefix,
    createdAt: t.createdAt,
    expiresAt: t.expiresAt,
    lastUsedAt: t.lastUsedAt,
    lastUsedIp: t.lastUsedIp,
    revokedAt: t.revokedAt,
  };
}

export const inventoryController = {
  /* Agents: Authorization: Bearer cpi_… ; body = the text report. */
  report(req: express.Request, res: express.Response) {
    const auth = String(req.headers.authorization ?? '');
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (!TOKEN_RE.test(token)) throw new HttpError(401, 'Invalid inventory token');
    const row = inventoryTokenRepository.findActiveByHash(hashToken(token), toSqlUtc(new Date()));
    if (!row) {
      audit({ action: 'inventory.report', detail: 'denied: unknown or revoked token', level: 'warn', ip: req.ip ?? null });
      throw new HttpError(401, 'Invalid inventory token');
    }
    if (typeof req.body !== 'string' || !req.body.trim()) throw badRequest('Send the report as text/plain');

    let result;
    try {
      result = ingestInventoryReport(row.tenantId, req.body);
    } catch (err) {
      if (err instanceof ReportError) throw badRequest(err.message);
      throw err;
    }
    inventoryTokenRepository.markUsed(row.id, req.ip ?? null);
    audit({
      action: 'inventory.report',
      detail: `ok asset=${result.assetName}${result.created ? ' (new)' : ''} tech=${result.technologies} removed=${result.removed} token=${row.prefix}`,
      tenantId: row.tenantId,
      ip: req.ip ?? null,
    });
    res.json({ ok: true, asset: result.assetName, created: result.created, technologies: result.technologies, removed: result.removed });
    /* Distro packages are checked against OSV in the background. */
    setImmediate(() => void runOsvJob(result.assetId));
  },

  script(req: express.Request, res: express.Response) {
    const s = SCRIPTS[String(req.params.os)];
    if (!s) throw notFound('Unknown agent');
    res.setHeader('Content-Type', s.type);
    res.setHeader('Content-Disposition', `attachment; filename="${s.file}"`);
    res.setHeader('Cache-Control', 'no-cache');
    res.send(fs.readFileSync(AGENTS_DIR + s.file, 'utf8'));
  },

  listTokens(req: express.Request, res: express.Response) {
    res.json({ tokens: inventoryTokenRepository.listByTenant(tenantOf(req)).map(tokenItem) });
  },

  createToken(req: express.Request, res: express.Response) {
    const tid = tenantOf(req);
    const name = str(req.body?.name, 80);
    if (!name) throw badRequest('Name is required (max 80 characters)');
    const days = req.body?.expiresInDays === undefined || req.body.expiresInDays === null ? 0 : Number(req.body.expiresInDays);
    if (!Number.isInteger(days) || days < 0 || days > 3650) throw badRequest('expiresInDays must be 0 (never) to 3650');
    if (inventoryTokenRepository.countActive(tid) >= MAX_TOKENS) throw conflict(`At most ${MAX_TOKENS} active tokens per company`);
    const token = `cpi_${randomBytes(32).toString('base64url')}`;
    const row = inventoryTokenRepository.create({
      tenantId: tid,
      name,
      tokenHash: hashToken(token),
      prefix: token.slice(0, 10),
      createdBy: req.auth?.user.id ?? null,
      expiresAt: days ? toSqlUtc(new Date(Date.now() + days * 86400_000)) : null,
    });
    /* The only time the token is returned. */
    res.status(201).json({ token, item: tokenItem(row) });
  },

  revokeToken(req: express.Request, res: express.Response) {
    if (!inventoryTokenRepository.revoke(idParam(req), tenantOf(req))) throw notFound('Token not found');
    res.json({ success: true });
  },

  agents(req: express.Request, res: express.Response) {
    const staleBefore = Date.now() - STALE_AFTER_DAYS * 86400_000;
    res.json({
      staleAfterDays: STALE_AFTER_DAYS,
      agents: agentAssets(tenantOf(req)).map(({ asset, technologies }) => {
        const last = asset.lastReportAt ? Date.parse(asset.lastReportAt.replace(' ', 'T') + 'Z') : 0;
        return {
          assetId: asset.id,
          name: asset.name,
          hostname: asset.hostname,
          ip: asset.ip,
          osName: asset.osName,
          osVersion: asset.osVersion,
          agentVersion: asset.agentVersion,
          lastReportAt: asset.lastReportAt,
          stale: last < staleBefore,
          technologies,
        };
      }),
    });
  },
};
