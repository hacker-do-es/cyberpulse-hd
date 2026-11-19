import { getDb } from '../db/client';
import { badRequest, conflict, isUniqueViolation, optStr, str } from '../lib/http';
import { tenantRepository } from '../repositories/tenantRepository';
import { userRepository } from '../repositories/userRepository';
import { hashPassword, validatePasswordStrength } from '../services/auth/password';
import { USERNAME_RE } from '../services/auth/userService';
import { isValidTimeZone } from '../services/schedule';

export interface CreateTenantInput {
  name?: unknown;
  language?: unknown;
  timezone?: unknown;
  admin?: { username?: unknown; password?: unknown; displayName?: unknown } | null;
}

/* Creates a company and, optionally, its first admin, atomically. */
export async function createTenant(input: CreateTenantInput): Promise<number> {
  const name = str(input.name, 100);
  if (!name) throw badRequest('Company name is required (max 100 characters)');
  const language = input.language ?? 'es';
  if (language !== 'en' && language !== 'es') throw badRequest('language must be "es" or "en"');
  const timezone = input.timezone ?? 'Europe/Madrid';
  if (!isValidTimeZone(timezone)) throw badRequest('Unknown time zone');

  const admin = input.admin;
  let adminValues: { username: string; passwordHash: string; displayName: string | null } | null = null;
  if (admin) {
    if (typeof admin.username !== 'string' || !USERNAME_RE.test(admin.username)) {
      throw badRequest('Admin username: 3-64 characters, letters, digits and . _ @ -');
    }
    const weak = validatePasswordStrength(admin.password);
    if (weak) throw badRequest(`Admin password: ${weak}`);
    if (userRepository.findByUsername(admin.username)) throw conflict('That admin username is taken');
    /* Hashed before the transaction: the slow part stays off the write lock. */
    adminValues = {
      username: admin.username,
      passwordHash: await hashPassword(admin.password as string),
      displayName: optStr(admin.displayName, 80),
    };
  }

  try {
    return getDb().transaction(() => {
      const tenant = tenantRepository.create({ name, language, timezone });
      if (adminValues) userRepository.create({ ...adminValues, role: 'admin', tenantId: tenant.id });
      return tenant.id;
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw conflict(String((err as Error).message).includes('users') ? 'That admin username is taken' : 'A company with that name already exists');
    }
    throw err;
  }
}
