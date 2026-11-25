import type express from 'express';
import { audit } from '../../services/logs/logStore';

/* Audit trail: every state-changing API call (and its outcome) goes to the
   application log with who, which company and from which IP. Bodies are
   never logged: they can carry passwords, keys and webhook URLs. Sign-in is
   audited by the auth controller, which knows the attempted username. */

const ACTIONS: Record<string, string> = {
  'POST /auth/logout': 'auth.logout',
  'POST /auth/active-tenant': 'auth.switch-company',
  'POST /auth/password': 'auth.password-change',
  'POST /auth/totp/setup': 'auth.2fa-setup',
  'POST /auth/totp/enable': 'auth.2fa-enable',
  'POST /auth/totp/disable': 'auth.2fa-disable',
  'POST /admin/tenants': 'company.create',
  'PATCH /admin/tenants/:id': 'company.update',
  'DELETE /admin/tenants/:id': 'company.delete',
  'POST /tech-stack': 'stack.create',
  'POST /tech-stack/import': 'stack.import',
  'PUT /tech-stack/:id': 'stack.update',
  'DELETE /tech-stack/:id': 'stack.delete',
  'POST /assets': 'asset.create',
  'POST /assets/import': 'asset.import',
  'PUT /assets/:id': 'asset.update',
  'DELETE /assets/:id': 'asset.delete',
  'PUT /tenant/settings': 'settings.update',
  'POST /tenant/ai/test': 'settings.ai-test',
  'POST /channels': 'channel.create',
  'PUT /channels/:id': 'channel.update',
  'DELETE /channels/:id': 'channel.delete',
  'POST /channels/:id/test': 'channel.test',
  'POST /channels/:id/run': 'channel.run',
  'POST /users': 'user.create',
  'PATCH /users/:id': 'user.update',
  'DELETE /users/:id': 'user.delete',
  'POST /sources': 'source.create',
  'PATCH /sources/:id': 'source.update',
  'DELETE /sources/:id': 'source.delete',
  'POST /scrape': 'scrape.start',
  'DELETE /linkedin': 'linkedin.disconnect',
  'POST /linkedin/posts': 'linkedin.publish',
  'POST /linkedin/queue': 'linkedin.schedule',
  'PUT /linkedin/queue/:id': 'linkedin.queue-edit',
  'POST /linkedin/queue/:id/approve': 'linkedin.approve',
  'POST /linkedin/queue/:id/reject': 'linkedin.reject',
  'POST /linkedin/queue/:id/cancel': 'linkedin.cancel',
  'POST /mcp': 'mcp.call',
  'POST /inventory/tokens': 'inventory.token-create',
  'DELETE /inventory/tokens/:id': 'inventory.token-revoke',
};

/* Generating text and previews change nothing: not worth an audit line. */
/* Agent reports are audited by the controller (with company and host). */
const SKIP = new Set(['POST /inventory/report', 'POST /auth/login', 'POST /generate', 'POST /digest', 'POST /generate-ai', 'POST /channels/preview-email']);

export function auditTrail(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  res.on('finish', () => {
    /* Unknown endpoints (scanners, typos) are not actions. */
    const route = req.route?.path as string | undefined;
    if (!route) return;
    const key = `${req.method} ${route}`;
    if (SKIP.has(key)) return;
    const action = ACTIONS[key] ?? `api ${req.method} ${route}`;
    const id = req.params?.id ? ` id=${String(req.params.id).slice(0, 20)}` : '';
    const status = res.statusCode;
    const outcome = status < 400 ? 'ok' : status === 401 || status === 403 ? 'denied' : status === 429 ? 'rate-limited' : 'failed';
    audit({
      action,
      detail: `${outcome}${id} (HTTP ${status})`,
      level: status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info',
      userId: req.auth?.user.id ?? null,
      username: req.auth?.user.username ?? null,
      tenantId: req.auth?.tenantId ?? null,
      ip: req.ip ?? null,
    });
  });
  next();
}
