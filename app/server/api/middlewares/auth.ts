import type express from 'express';
import { loadSession, type Role } from '../../services/auth/userService';

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

export function requireRole(...roles: Role[]) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!req.auth) return res.status(401).json({ error: 'Authentication required' });
    if (!roles.includes(req.auth.user.role)) return res.status(403).json({ error: 'Insufficient permissions' });
    next();
  };
}

/* Tenant-scoped endpoints: the superadmin counts as an admin of whichever
   company it has selected. */
export function requireTenant(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!req.auth) return res.status(401).json({ error: 'Authentication required' });
  if (req.auth.tenantId === null) {
    return res.status(409).json({ error: 'Select a company first', code: 'NO_TENANT' });
  }
  next();
}

export const requireTenantAdmin = [requireTenant, requireRole('superadmin', 'admin')];
