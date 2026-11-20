import crypto from 'crypto';

/* OAuth `state` values. The session cookie is SameSite=Strict, so it is not
   sent on LinkedIn's redirect back: the callback identifies the user by this
   single-use, unguessable, short-lived value instead (it also is the CSRF
   protection of the flow). In memory: a restart just means "connect again". */

const TTL_MS = 10 * 60_000;
const MAX_PENDING = 1000;

export type ReturnTo = 'generate' | 'account';

interface Pending {
  userId: number;
  returnTo: ReturnTo;
  expires: number;
}

const pending = new Map<string, Pending>();

function sweep(now: number) {
  for (const [k, v] of pending) if (v.expires <= now) pending.delete(k);
}

export function createState(userId: number, returnTo: ReturnTo): string {
  const now = Date.now();
  sweep(now);
  if (pending.size >= MAX_PENDING) pending.delete(pending.keys().next().value!);
  /* One pending login per user. */
  for (const [k, v] of pending) if (v.userId === userId) pending.delete(k);
  const state = crypto.randomBytes(32).toString('base64url');
  pending.set(state, { userId, returnTo, expires: now + TTL_MS });
  return state;
}

export function consumeState(state: unknown): Pending | null {
  if (typeof state !== 'string' || state.length > 100) return null;
  const p = pending.get(state);
  pending.delete(state as string);
  if (!p || p.expires <= Date.now()) return null;
  return p;
}
