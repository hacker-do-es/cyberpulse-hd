import { decryptSecret } from '../lib/crypto';
import { userRepository } from '../repositories/userRepository';
import { burnPasswordCheck, verifyPassword } from '../services/auth/password';
import { verifyTotp } from '../services/auth/totp';
import { toSessionUser, type SessionUser } from '../services/auth/userService';

const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;

export type LoginResult =
  | { ok: true; user: SessionUser }
  | { ok: false; status: number; error: string; totpRequired?: boolean };

/* Password (+ TOTP when enabled) login with lockout: 5 failures of either
   kind lock the account for 15 minutes. Unknown usernames cost the same
   time as known ones. */
export async function login(username: unknown, password: unknown, totp: unknown): Promise<LoginResult> {
  const generic: LoginResult = { ok: false, status: 401, error: 'Invalid username or password' };
  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) return generic;

  const found = userRepository.findForLogin(username.trim());
  if (!found) {
    await burnPasswordCheck(password);
    return generic;
  }
  const { user, tenantActive } = found;
  const locked: LoginResult = { ok: false, status: 429, error: 'Account temporarily locked after repeated failures. Try again later.' };

  /* The attempt is counted before the slow password check (see
     reserveLoginAttempt), so parallel guesses cannot exceed the limit. */
  const attempt = userRepository.reserveLoginAttempt(user.id);
  if (attempt === null) return locked;
  if (attempt > MAX_FAILED_LOGINS) {
    userRepository.lockFor(user.id, LOCK_MINUTES);
    return locked;
  }
  const fail = (result: LoginResult): LoginResult => {
    if (attempt >= MAX_FAILED_LOGINS) userRepository.lockFor(user.id, LOCK_MINUTES);
    return result;
  };

  if (!(await verifyPassword(password, user.passwordHash))) return fail(generic);

  if (!user.active || (user.tenantId !== null && !tenantActive)) {
    userRepository.releaseLoginAttempt(user.id);
    return { ok: false, status: 403, error: 'This account is disabled' };
  }

  if (user.totpEnabled && user.totpSecret) {
    if (totp === undefined || totp === null || totp === '') {
      /* Right password, second factor still to come: not a failure. */
      userRepository.releaseLoginAttempt(user.id);
      return { ok: false, status: 401, error: 'Two-factor code required', totpRequired: true };
    }
    const step = verifyTotp(decryptSecret(user.totpSecret), totp);
    if (step === null || !userRepository.claimTotpStep(user.id, step)) {
      return fail({ ok: false, status: 401, error: 'Invalid two-factor code', totpRequired: true });
    }
  }

  userRepository.recordLogin(user.id);
  return { ok: true, user: toSessionUser(user) };
}
