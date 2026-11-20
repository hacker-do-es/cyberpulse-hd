import { audit } from '../services/logs/logStore';
import type express from 'express';
import QRCode from 'qrcode';
import { badRequest, conflict, notFound } from '../lib/http';
import { sessionRepository } from '../repositories/sessionRepository';
import { tenantRepository } from '../repositories/tenantRepository';
import { userRepository } from '../repositories/userRepository';
import { validatePasswordStrength, verifyPassword } from '../services/auth/password';
import { totpUri } from '../services/auth/totp';
import {
  SESSION_COOKIE, confirmTotpEnrolment, createSession, disableTotp, loadSession,
  sessionCookieOptions, setUserPassword, startTotpEnrolment,
} from '../services/auth/userService';
import { login } from '../useCases/login';

const TOTP_ISSUER = 'Hacker-Do CyberPulse';

async function checkOwnPassword(userId: number, password: unknown): Promise<boolean> {
  const user = userRepository.findById(userId);
  return Boolean(user && typeof password === 'string' && await verifyPassword(password, user.passwordHash));
}

export const authController = {
  async login(req: express.Request, res: express.Response) {
    const { username, password, totp } = req.body ?? {};
    const result = await login(username, password, totp);
    const tried = typeof username === 'string' ? username.trim().slice(0, 60) : null;
    if (!result.ok) {
      /* "Code required" is the normal first step of a 2FA login, not a failure. */
      if (!(result.totpRequired && result.status === 401 && result.error === 'Two-factor code required')) {
        audit({ action: 'auth.login', detail: `failed: ${result.error}`, level: 'warn', username: tried, ip: req.ip ?? null });
      }
      return res.status(result.status).json({ error: result.error, totpRequired: result.totpRequired ?? false });
    }
    audit({ action: 'auth.login', detail: 'ok', userId: result.user.id, username: result.user.username, tenantId: result.user.tenantId ?? null, ip: req.ip ?? null });
    res.cookie(SESSION_COOKIE, createSession(result.user), sessionCookieOptions(req));
    res.json({ ok: true });
  },

  logout(req: express.Request, res: express.Response) {
    const ctx = loadSession(req);
    if (ctx) sessionRepository.delete(ctx.sessionId);
    res.clearCookie(SESSION_COOKIE, { ...sessionCookieOptions(req), maxAge: undefined });
    res.json({ ok: true });
  },

  me(req: express.Request, res: express.Response) {
    const { user, tenantId: activeId } = req.auth!;
    const tenants = tenantRepository.listBasic(user.role === 'superadmin' ? undefined : user.tenantId);
    const t = activeId ? tenantRepository.findById(activeId) : undefined;
    res.json({
      user: { id: user.id, username: user.username, displayName: user.displayName, role: user.role, totpEnabled: user.totpEnabled },
      tenants: tenants.map((x) => ({ id: x.id, name: x.name, active: x.active })),
      activeTenant: t
        ? {
          id: t.id, name: t.name, language: t.language, timezone: t.timezone,
          aiProvider: t.aiProvider, aiConfigured: t.aiProvider !== 'none' && Boolean(t.aiKey),
        }
        : null,
    });
  },

  setActiveTenant(req: express.Request, res: express.Response) {
    const id = req.body?.tenantId;
    if (id === null) {
      sessionRepository.setActiveTenant(req.auth!.sessionId, null);
      return res.json({ ok: true });
    }
    if (!tenantRepository.findById(Number(id))) throw notFound('Company not found');
    sessionRepository.setActiveTenant(req.auth!.sessionId, Number(id));
    res.json({ ok: true });
  },

  async changePassword(req: express.Request, res: express.Response) {
    const { currentPassword, newPassword } = req.body ?? {};
    if (!(await checkOwnPassword(req.auth!.user.id, currentPassword))) throw badRequest('Current password is incorrect');
    const weak = validatePasswordStrength(newPassword);
    if (weak) throw badRequest(weak);
    await setUserPassword(req.auth!.user.id, newPassword);
    /* Every session is gone, including this one; issue a fresh one. */
    res.cookie(SESSION_COOKIE, createSession(req.auth!.user), sessionCookieOptions(req));
    res.json({ ok: true });
  },

  async totpSetup(req: express.Request, res: express.Response) {
    const { user } = req.auth!;
    if (user.totpEnabled) throw conflict('Two-factor authentication is already enabled');
    const secret = startTotpEnrolment(user.id);
    const uri = totpUri(TOTP_ISSUER, user.username, secret);
    const qr = await QRCode.toDataURL(uri, { margin: 1, width: 220 });
    res.json({ secret, uri, qr });
  },

  totpEnable(req: express.Request, res: express.Response) {
    if (!confirmTotpEnrolment(req.auth!.user.id, req.body?.code)) {
      throw badRequest('Invalid code, check the time on your phone and try again');
    }
    res.json({ ok: true });
  },

  async totpDisable(req: express.Request, res: express.Response) {
    if (!(await checkOwnPassword(req.auth!.user.id, req.body?.password))) throw badRequest('Password is incorrect');
    disableTotp(req.auth!.user.id);
    res.json({ ok: true });
  },
};
