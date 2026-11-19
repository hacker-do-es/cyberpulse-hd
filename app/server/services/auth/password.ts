import crypto from 'crypto';
import os from 'os';

/* Passwords are hashed with scrypt (N=2^15, r=8, p=1). One hash costs ~90 ms
   of CPU, so it runs on libuv's thread pool through the async API: a login
   never stalls the event loop, and other requests keep being served. */

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

/* At most (CPUs - 1) hashes run at once, so a burst of logins can never take
   every core away from the event loop thread. Extra hashes wait their turn. */
const MAX_PARALLEL_HASHES = Math.max(1, os.availableParallelism() - 1);
let active = 0;
const waiting: Array<() => void> = [];

async function withHashSlot<T>(fn: () => Promise<T>): Promise<T> {
  /* A released slot is handed straight to the next waiter, so a newcomer can
     never jump in between and exceed the limit. */
  if (active < MAX_PARALLEL_HASHES) active++;
  else await new Promise<void>((resolve) => waiting.push(resolve));
  try {
    return await fn();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else active--;
  }
}

function scrypt(password: string, salt: Buffer, keylen: number, opts: crypto.ScryptOptions): Promise<Buffer> {
  return withHashSlot(() => new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key)));
  }));
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, SCRYPT_KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: SCRYPT_MAXMEM });
  return ['scrypt', SCRYPT_N, SCRYPT_R, SCRYPT_P, salt.toString('base64'), hash.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(n), r: Number(r), p: Number(p), maxmem: SCRYPT_MAXMEM,
  });
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

/* Spent on unknown usernames so response timing does not reveal which
   accounts exist. Computed once, on first use. */
let dummyHash: Promise<string> | null = null;
export function burnPasswordCheck(password: string): Promise<boolean> {
  dummyHash ??= hashPassword(crypto.randomBytes(16).toString('hex'));
  return dummyHash.then((h) => verifyPassword(password, h));
}
