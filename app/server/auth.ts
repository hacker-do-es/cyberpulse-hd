import crypto from 'crypto';
import type express from 'express';
import { getDb } from './db';
import { decryptSecret, encryptSecret } from './crypto';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type Role = 'superadmin' | 'admin' | 'member';

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

/* ------------------------------------------------------------------ */
/*  Passwords (scrypt)                                                 */
/* ------------------------------------------------------------------ */

const SCRYPT_N = 32768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 32;
const SCRYPT_MAXMEM = 64 * 1024 * 1024;

export const MIN_PASSWORD_LENGTH = 12;

export function validatePasswordStrength(password: unknown): string | null {
  if (typeof password !== 'string') return 'Password is required';
  if (password.length < MIN_PASSWORD_LENGTH) return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  if (password.length > 256) return 'Password is too long';
  return null;
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: SCRYPT_MAXMEM,
  });
  return ['scrypt', SCRYPT_N, SCRYPT_R, SCRYPT_P, salt.toString('base64'), hash.toString('base64')].join('$');
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(n), r: Number(r), p: Number(p), maxmem: SCRYPT_MAXMEM,
  });
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

/* Spent on unknown usernames so response timing does not reveal which
   accounts exist. */
const DUMMY_HASH = hashPassword(crypto.randomBytes(16).toString('hex'));

/* ------------------------------------------------------------------ */
/*  TOTP (RFC 6238, SHA-1, 30 s, 6 digits)                             */
/* ------------------------------------------------------------------ */

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(str: string): Buffer {
  const clean = str.replace(/=+$/, '').replace(/\s+/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx === -1) throw new Error('Invalid base32');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function generateTotpSecret(): string {
  return base32Encode(crypto.randomBytes(20));
}

export function totpCode(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = crypto.createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const bin = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(bin % 1_000_000).padStart(6, '0');
}

/* Returns the matched time step (to block replay of the same code) or null. */
export function verifyTotp(secret: string, code: unknown, now = Date.now(), window = 1): number | null {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code.trim())) return null;
  const current = Math.floor(now / 1000 / 30);
  for (let w = -window; w <= window; w++) {
    const step = current + w;
    const expected = totpCode(secret, step);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(code.trim()))) return step;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/*  Users                                                              */
/* ------------------------------------------------------------------ */

interface UserRow {
  id: number;
  tenant_id: number | null;
  username: string;
  display_name: string | null;
  password_hash: string;
  role: Role;
  totp_secret: string | null;
  totp_enabled: number;
  totp_last_step: number | null;
  active: number;
  failed_logins: number;
  locked_until: string | null;
}

function toSessionUser(row: UserRow): SessionUser {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    tenantId: row.tenant_id,
    totpEnabled: Boolean(row.totp_enabled),
  };
}

export const USERNAME_RE = /^[a-zA-Z0-9._@-]{3,64}$/;

export function createUser(opts: {
  username: string;
  password: string;
  role: Role;
  tenantId: number | null;
  displayName?: string | null;
}): number {
  const db = getDb();
  const result = db.prepare(
    `INSERT INTO users (tenant_id, username, display_name, password_hash, role) VALUES (?, ?, ?, ?, ?)`
  ).run(opts.tenantId, opts.username, opts.displayName ?? null, hashPassword(opts.password), opts.role);
  return Number(result.lastInsertRowid);
}

export function setUserPassword(userId: number, password: string): void {
  const db = getDb();
  db.prepare(`UPDATE users SET password_hash = ?, failed_logins = 0, locked_until = NULL WHERE id = ?`)
    .run(hashPassword(password), userId);
  /* A password change ends every existing session for that account. */
  db.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(userId);
}

/* Creates the first superadmin from env on startup, once. */
export function bootstrapSuperadmin(): void {
  const db = getDb();
  const existing = db.prepare(`SELECT COUNT(*) AS c FROM users WHERE role = 'superadmin'`).get() as { c: number };
  if (existing.c > 0) return;

  const username = (process.env.CYBERPULSE_ADMIN_USERNAME || '').trim();
  const password = process.env.CYBERPULSE_ADMIN_PASSWORD || '';
  if (!username || !password) {
    console.warn(
      '[AUTH] No superadmin exists yet. Create one with:\n' +
      '         npm run admin -- create-superadmin <username>\n' +
      '       or set CYBERPULSE_ADMIN_USERNAME and CYBERPULSE_ADMIN_PASSWORD for the first start.'
    );
    return;
  }
  const weak = validatePasswordStrength(password);
  if (weak || !USERNAME_RE.test(username)) {
    console.error(`[AUTH] Bootstrap superadmin not created: ${weak || 'invalid username'}`);
    return;
  }
  createUser({ username, password, role: 'superadmin', tenantId: null });
  console.log(`[AUTH] Superadmin "${username}" created from environment. Remove CYBERPULSE_ADMIN_PASSWORD now.`);
}

/* ------------------------------------------------------------------ */
/*  Login                                                              */
/* ------------------------------------------------------------------ */

const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;

export type LoginResult =
  | { ok: true; user: SessionUser }
  | { ok: false; status: number; error: string; totpRequired?: boolean };

export function attemptLogin(username: unknown, password: unknown, totp: unknown): LoginResult {
  const generic: LoginResult = { ok: false, status: 401, error: 'Invalid username or password' };
  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) return generic;

  const db = getDb();
  const row = db.prepare(`
    SELECT u.*, t.active AS tenant_active,
           (u.locked_until IS NOT NULL AND u.locked_until > CURRENT_TIMESTAMP) AS is_locked
    FROM users u LEFT JOIN tenants t ON t.id = u.tenant_id
    WHERE u.username = ?
  `).get(username.trim()) as (UserRow & { tenant_active: number | null; is_locked: number }) | undefined;

  if (!row) {
    verifyPassword(password, DUMMY_HASH);
    return generic;
  }

  if (row.is_locked) {
    return { ok: false, status: 429, error: 'Account temporarily locked after repeated failures. Try again later.' };
  }

  /* Wrong passwords and wrong 2FA codes count towards the same lockout. */
  const recordFailure = () => {
    const failed = row.failed_logins + 1;
    if (failed >= MAX_FAILED_LOGINS) {
      db.prepare(`UPDATE users SET failed_logins = 0, locked_until = datetime('now', ?) WHERE id = ?`)
        .run(`+${LOCK_MINUTES} minutes`, row.id);
    } else {
      db.prepare(`UPDATE users SET failed_logins = ? WHERE id = ?`).run(failed, row.id);
    }
  };

  if (!verifyPassword(password, row.password_hash)) {
    recordFailure();
    return generic;
  }

  if (!row.active || (row.tenant_id !== null && !row.tenant_active)) {
    return { ok: false, status: 403, error: 'This account is disabled' };
  }

  if (row.totp_enabled && row.totp_secret) {
    if (totp === undefined || totp === null || totp === '') {
      return { ok: false, status: 401, error: 'Two-factor code required', totpRequired: true };
    }
    const step = verifyTotp(decryptSecret(row.totp_secret), totp);
    if (step === null || (row.totp_last_step !== null && step <= row.totp_last_step)) {
      recordFailure();
      return { ok: false, status: 401, error: 'Invalid two-factor code', totpRequired: true };
    }
    db.prepare(`UPDATE users SET totp_last_step = ? WHERE id = ?`).run(step, row.id);
  }

  db.prepare(`UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = CURRENT_TIMESTAMP WHERE id = ?`).run(row.id);
  return { ok: true, user: toSessionUser(row) };
}

/* ------------------------------------------------------------------ */
/*  Sessions                                                           */
/* ------------------------------------------------------------------ */

export const SESSION_COOKIE = 'cp_session';
const SESSION_HOURS = Number(process.env.CYBERPULSE_SESSION_HOURS) || 12;

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function createSession(user: SessionUser): string {
  const token = crypto.randomBytes(32).toString('base64url');
  const db = getDb();
  /* Superadmins start without a company selected; everyone else is pinned. */
  const activeTenant = user.role === 'superadmin' ? null : user.tenantId;
  db.prepare(`INSERT INTO sessions (id, user_id, active_tenant_id, expires_at) VALUES (?, ?, ?, datetime('now', ?))`)
    .run(hashToken(token), user.id, activeTenant, `+${SESSION_HOURS} hours`);
  db.prepare(`DELETE FROM sessions WHERE expires_at < CURRENT_TIMESTAMP`).run();
  return token;
}

export function destroySession(sessionId: string): void {
  getDb().prepare(`DELETE FROM sessions WHERE id = ?`).run(sessionId);
}

export function setActiveTenant(sessionId: string, tenantId: number | null): void {
  getDb().prepare(`UPDATE sessions SET active_tenant_id = ? WHERE id = ?`).run(tenantId, sessionId);
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
  const forced = process.env.CYBERPULSE_COOKIE_SECURE;
  const secure = forced === 'true' ? true : forced === 'false' ? false : req.secure;
  return {
    httpOnly: true,
    sameSite: 'strict' as const,
    secure,
    path: '/',
    maxAge: SESSION_HOURS * 3600 * 1000,
  };
}

export function loadSession(req: express.Request): AuthContext | null {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token) return null;
  const id = hashToken(token);
  const row = getDb().prepare(`
    SELECT s.id AS session_id, s.active_tenant_id, u.*, t.active AS tenant_active
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    LEFT JOIN tenants t ON t.id = u.tenant_id
    WHERE s.id = ? AND s.expires_at > CURRENT_TIMESTAMP
  `).get(id) as (UserRow & { session_id: string; active_tenant_id: number | null; tenant_active: number | null }) | undefined;

  if (!row || !row.active || (row.tenant_id !== null && !row.tenant_active)) return null;

  const user = toSessionUser(row);
  return {
    user,
    sessionId: row.session_id,
    tenantId: user.role === 'superadmin' ? row.active_tenant_id : user.tenantId,
  };
}

/* ------------------------------------------------------------------ */
/*  Middleware                                                         */
/* ------------------------------------------------------------------ */

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

/* Tenant-scoped endpoints: superadmin counts as an admin of whichever company
   it has selected. */
export function requireTenant(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!req.auth) return res.status(401).json({ error: 'Authentication required' });
  if (req.auth.tenantId === null) {
    return res.status(409).json({ error: 'Select a company first', code: 'NO_TENANT' });
  }
  next();
}

export const requireTenantAdmin = [
  requireTenant,
  requireRole('superadmin', 'admin'),
];

/* ------------------------------------------------------------------ */
/*  TOTP enrolment helpers                                             */
/* ------------------------------------------------------------------ */

export function startTotpEnrolment(userId: number): string {
  const secret = generateTotpSecret();
  getDb().prepare(`UPDATE users SET totp_secret = ?, totp_enabled = 0 WHERE id = ?`).run(encryptSecret(secret), userId);
  return secret;
}

export function confirmTotpEnrolment(userId: number, code: unknown): boolean {
  const db = getDb();
  const row = db.prepare(`SELECT totp_secret FROM users WHERE id = ?`).get(userId) as { totp_secret: string | null } | undefined;
  if (!row?.totp_secret) return false;
  const step = verifyTotp(decryptSecret(row.totp_secret), code);
  if (step === null) return false;
  db.prepare(`UPDATE users SET totp_enabled = 1, totp_last_step = ? WHERE id = ?`).run(step, userId);
  return true;
}

export function disableTotp(userId: number): void {
  getDb().prepare(`UPDATE users SET totp_enabled = 0, totp_secret = NULL, totp_last_step = NULL WHERE id = ?`).run(userId);
}

export function getPasswordHash(userId: number): string | null {
  const row = getDb().prepare(`SELECT password_hash FROM users WHERE id = ?`).get(userId) as { password_hash: string } | undefined;
  return row?.password_hash ?? null;
}
