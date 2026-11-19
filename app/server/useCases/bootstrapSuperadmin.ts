import { userRepository } from '../repositories/userRepository';
import { validatePasswordStrength } from '../services/auth/password';
import { createUser, USERNAME_RE } from '../services/auth/userService';

/* Creates the first superadmin from the environment on startup, once. */
export async function bootstrapSuperadmin(): Promise<void> {
  if (userRepository.countSuperadmins() > 0) return;

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
  await createUser({ username, password, role: 'superadmin', tenantId: null });
  console.log(`[AUTH] Superadmin "${username}" created from environment. Remove CYBERPULSE_ADMIN_PASSWORD now.`);
}
