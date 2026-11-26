import type express from 'express';
import { can, type Permission } from '../../shared/permissions';
import { loadSession } from '../../services/auth/userService';

/* Every state-changing request from the browser must carry this header.
   Cross-site forms cannot set custom headers, and the cookie is SameSite=Strict
   on top: two independent CSRF barriers. */
export const CSRF_HEADER = 'x-requested-with';
export const CSRF_VALUE = 'cyberpulse';

export function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const ctx = loadSession(req);
  if (!ctx) return res.status(401).json({ error: 'Authentication required' });
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers[CSRF_HEADER] !== CSRF_VALUE) {
    return res.status(403).json({ error: 'Missing CSRF header' });
  }
  req.auth = ctx;
  next();
}

/* Every guard below goes through the permission map in shared/permissions.ts. */
export function requirePermission(perm: Permission) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!req.auth) return res.status(401).json({ error: 'Authentication required' });
    if (!can(req.auth.user.role, perm)) return res.status(403).json({ error: 'Insufficient permissions' });
    next();
  };
}

/* Tenant-scoped endpoints: platform users (superadmin, support) work on
   whichever company they selected for the session. */
export function requireTenant(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!req.auth) return res.status(401).json({ error: 'Authentication required' });
  if (req.auth.tenantId === null) {
    return res.status(409).json({ error: 'Select a company first', code: 'NO_TENANT' });
  }
  next();
}

/* A company endpoint that needs a permission. */
export const tenantCan = (perm: Permission) => [requireTenant, requirePermission(perm)];
