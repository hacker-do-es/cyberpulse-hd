import { linkedinConfig, type LinkedInApp, type LinkedInSlot } from '../../config';
import type { LinkedinAccountRow } from '../../db/schema';
import { decryptSecret } from '../../lib/crypto';
import { linkedinRepository } from '../../repositories/linkedinRepository';
import { LinkedInError, ORG_URN_RE, createPost, grantedScopes, type Organization } from './client';
import { MAX_POST_CHARS, toLittleText } from './text';

/* A user's LinkedIn connections and publishing as one of their authors
   ('member' = their profile, or a Company Page URN). Shared by the publish
   endpoint, the publishing queue and LinkedIn channels. */

export const SLOTS: LinkedInSlot[] = ['main', 'pages'];

export function isExpired(expiresAt: string): boolean {
  return new Date(expiresAt.replace(' ', 'T') + 'Z').getTime() <= Date.now() + 60_000;
}

export function appFor(slot: LinkedInSlot): LinkedInApp | undefined {
  return linkedinConfig()?.apps[slot];
}

export function storedOrgs(acc: LinkedinAccountRow | undefined): Organization[] {
  if (!acc?.organizations) return [];
  try {
    const v = JSON.parse(acc.organizations) as Organization[];
    return Array.isArray(v) ? v.filter((o) => o && ORG_URN_RE.test(o.urn)) : [];
  } catch {
    return [];
  }
}

export function canPostAsMember(acc: LinkedinAccountRow | undefined): boolean {
  return Boolean(acc?.memberId) && grantedScopes(acc!.scope).has('w_member_social');
}

export function canPostAsOrgs(acc: LinkedinAccountRow | undefined): boolean {
  return Boolean(acc) && grantedScopes(acc!.scope).has('w_organization_social');
}

/* A connection is usable only while its app is still configured and its token valid. */
export function live(userId: number, slot: LinkedInSlot): LinkedinAccountRow | undefined {
  if (!appFor(slot)) return undefined;
  const acc = linkedinRepository.find(userId, slot);
  return acc && !isExpired(acc.expiresAt) ? acc : undefined;
}

/* Pages the user can post as, with the connection that grants each. */
export function pagesOf(userId: number): Array<{ org: Organization; slot: LinkedInSlot; acc: LinkedinAccountRow }> {
  const out: Array<{ org: Organization; slot: LinkedInSlot; acc: LinkedinAccountRow }> = [];
  const seen = new Set<string>();
  for (const slot of ['pages', 'main'] as LinkedInSlot[]) {
    const acc = live(userId, slot);
    if (!canPostAsOrgs(acc)) continue;
    for (const org of storedOrgs(acc)) {
      if (seen.has(org.urn)) continue;
      seen.add(org.urn);
      out.push({ org, slot, acc: acc! });
    }
  }
  return out;
}

export type PublishErrorCode = 'reconnect' | 'invalid' | 'denied' | 'failed';

export class PublishError extends Error {
  constructor(message: string, public readonly code: PublishErrorCode) {
    super(message);
  }
}

export interface ResolvedAuthor {
  acc: LinkedinAccountRow;
  slot: LinkedInSlot;
  /* urn:li:person:… or urn:li:organization:… */
  urn: string;
  label: string;
}

/* Checks that `userId` can publish as `wanted` right now. */
export function resolveAuthor(userId: number, wanted: string): ResolvedAuthor {
  if (wanted === 'member') {
    const main = linkedinRepository.find(userId, 'main');
    if (!main || !appFor('main')) throw new PublishError('Connect your LinkedIn account first', 'reconnect');
    if (isExpired(main.expiresAt)) throw new PublishError('Your LinkedIn connection expired. Connect it again.', 'reconnect');
    if (!canPostAsMember(main)) throw new PublishError('This LinkedIn connection can only post as a Company Page', 'invalid');
    return { acc: main, slot: 'main', urn: `urn:li:person:${main.memberId}`, label: main.name ?? 'LinkedIn' };
  }
  const page = pagesOf(userId).find((p) => p.org.urn === wanted);
  if (!page) {
    const hasPagesConn = SLOTS.some((s) => canPostAsOrgs(linkedinRepository.find(userId, s)));
    if (hasPagesConn && !SLOTS.some((s) => canPostAsOrgs(live(userId, s)))) {
      throw new PublishError('Your LinkedIn connection expired. Connect it again.', 'reconnect');
    }
    throw new PublishError('You cannot post as that LinkedIn Page', 'invalid');
  }
  return { acc: page.acc, slot: page.slot, urn: wanted, label: page.org.name ?? wanted };
}

/* Publishes `text` as `wanted` with `userId`'s connection; logs the post. */
export async function publishAs(userId: number, tenantId: number | null, wanted: string, text: string): Promise<{ urn: string; author: string }> {
  const clean = text.replace(/\r\n/g, '\n').trim();
  if (!clean) throw new PublishError('The post is empty', 'invalid');
  if (clean.length > MAX_POST_CHARS) throw new PublishError(`LinkedIn posts can have at most ${MAX_POST_CHARS} characters`, 'invalid');
  const a = resolveAuthor(userId, wanted);
  let urn: string;
  try {
    urn = await createPost(decryptSecret(a.acc.accessToken), a.urn, toLittleText(clean));
  } catch (err) {
    if (err instanceof LinkedInError && err.status === 401) {
      linkedinRepository.delete(userId, a.slot);
      throw new PublishError('LinkedIn no longer accepts this connection. Connect it again.', 'reconnect');
    }
    if (err instanceof LinkedInError && err.status === 403 && wanted !== 'member') {
      throw new PublishError('LinkedIn did not let you post as this Page. You need to be an admin or content admin of it.', 'denied');
    }
    throw new PublishError(err instanceof LinkedInError ? err.message : 'LinkedIn request failed', 'failed');
  }
  linkedinRepository.logPost(userId, tenantId, urn, clean.length, a.urn);
  console.log(`[LINKEDIN] user ${userId} published ${urn} as ${a.urn}`);
  return { urn, author: a.urn };
}
