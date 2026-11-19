import crypto from 'crypto';
import type express from 'express';
import { config, flags } from '../../config';
import type { Role, UserRow } from '../../db/schema';
import { decryptSecret, encryptSecret } from '../../lib/crypto';
import { sessionRepository } from '../../repositories/sessionRepository';
import { userRepository } from '../../repositories/userRepository';
import { hashPassword } from './password';
import { generateTotpSecret, verifyTotp } from './totp';

export type { Role };

export interface SessionUser {
  id: number;
  username: string;
  displayName: string | null;
  role: Role;
  tenantId: number | null;
  totpEnabled: boolean;
}

export interface AuthContext {
  user: SessionUser;
  sessionId: string;
  /* The company every tenant-scoped endpoint acts on. Regular users are pinned
     to their own; the superadmin picks one per session. */
  tenantId: number | null;
}

declare module 'express-serve-static-core' {
  interface Request {
    auth?: AuthContext;
  }
}

export const USERNAME_RE = /^[a-zA-Z0-9._@-]{3,64}$/;

export function toSessionUser(row: UserRow): SessionUser {
  return {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    role: row.role,
    tenantId: row.tenantId,
    totpEnabled: row.totpEnabled,
  };
}

/* ------------------------------------------------------------------ */
/*  Users                                                              */
/* ------------------------------------------------------------------ */

export async function createUser(opts: {
  username: string;
  password: string;
  role: Role;
  tenantId: number | null;
  displayName?: string | null;
}): Promise<number> {
  const passwordHash = await hashPassword(opts.password);
  return userRepository.create({ ...opts, passwordHash }).id;
}

/* A password change ends every existing session for that account. */
export async function setUserPassword(userId: number, password: string): Promise<void> {
  const passwordHash = await hashPassword(password);
  userRepository.update(userId, { passwordHash, failedLogins: 0, lockedUntil: null });
  sessionRepository.deleteForUser(userId);
}

/* ------------------------------------------------------------------ */
/*  Sessions                                                           */
/* ------------------------------------------------------------------ */

export const SESSION_COOKIE = 'cp_session';

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/* Returns the cookie token; only its SHA-256 is stored. */
export function createSession(user: SessionUser): string {
  const token = crypto.randomBytes(32).toString('base64url');
  /* Superadmins start without a company selected; everyone else is pinned. */
  const activeTenant = user.role === 'superadmin' ? null : user.tenantId;
  sessionRepository.create(hashToken(token), user.id, activeTenant, config.sessionHours);
  sessionRepository.purgeExpired();
  return token;
}

function readCookie(req: express.Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

export function sessionCookieOptions(req: express.Request) {
  const forced = flags.cookieSecure();
  const secure = forced === 'true' ? true : forced === 'false' ? false : req.secure;
  return {
    httpOnly: true,
    sameSite: 'strict' as const,
    secure,
    path: '/',
    maxAge: config.sessionHours * 3600 * 1000,
  };
}

export function loadSession(req: express.Request): AuthContext | null {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token) return null;
  const row = sessionRepository.findValid(hashToken(token));
  if (!row || !row.user.active || (row.user.tenantId !== null && !row.tenantActive)) return null;
  const user = toSessionUser(row.user);
  return {
    user,
    sessionId: row.sessionId,
    tenantId: user.role === 'superadmin' ? row.activeTenantId : user.tenantId,
  };
}

/* ------------------------------------------------------------------ */
/*  TOTP enrolment                                                     */
/* ------------------------------------------------------------------ */

export function startTotpEnrolment(userId: number): string {
  const secret = generateTotpSecret();
  userRepository.update(userId, { totpSecret: encryptSecret(secret), totpEnabled: false });
  return secret;
}

export function confirmTotpEnrolment(userId: number, code: unknown): boolean {
  const row = userRepository.findById(userId);
  if (!row?.totpSecret) return false;
  const step = verifyTotp(decryptSecret(row.totpSecret), code);
  if (step === null) return false;
  userRepository.update(userId, { totpEnabled: true, totpLastStep: step });
  return true;
}

export function disableTotp(userId: number): void {
  userRepository.update(userId, { totpEnabled: false, totpSecret: null, totpLastStep: null });
}
