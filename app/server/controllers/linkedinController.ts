import { audit } from '../services/logs/logStore';
import type express from 'express';
import { linkedinConfig } from '../config';
import { decryptSecret, encryptSecret } from '../lib/crypto';
import { HttpError, badRequest } from '../lib/http';
import { linkedinRepository } from '../repositories/linkedinRepository';
import {
  LinkedInError, ORG_URN_RE, authorizeUrl, createPost, exchangeCode, fetchMember, fetchOrganizations,
  grantedScopes, postUrl, revokeToken, type Organization,
} from '../services/linkedin/client';
import type { LinkedinAccountRow } from '../db/schema';
import { consumeState, createState, type ReturnTo } from '../services/linkedin/oauthState';
import { MAX_POST_CHARS, toLittleText } from '../services/linkedin/text';
import { toSqlUtc } from '../services/schedule';

/* "Publish to LinkedIn": each user connects their own LinkedIn member
   account (OAuth), and can then publish generated posts as themselves or,
   with Community Management, as a Company Page they administer. */

const reconnect = (msg: string) => new HttpError(409, msg, { code: 'LINKEDIN_RECONNECT' });

function isExpired(expiresAt: string): boolean {
  return new Date(expiresAt.replace(' ', 'T') + 'Z').getTime() <= Date.now() + 60_000;
}

/* The callback lands here from linkedin.com. The session cookie is
   SameSite=Strict, so a plain 302 into the app would arrive without it; a
   page that refreshes to the app is a same-site navigation and keeps the
   login. */
function backToApp(res: express.Response, query: Record<string, string>) {
  const target = `/?${new URLSearchParams(query).toString()}`;
  res.status(200).type('html').set('Cache-Control', 'no-store').send(
    '<!doctype html><html><head><meta charset="utf-8">' +
    `<meta http-equiv="refresh" content="0;url=${target.replace(/&/g, '&amp;')}">` +
    '<title>CyberPulse</title></head><body style="background:#0d1117;color:#c9d1d9;font-family:sans-serif">' +
    `<p><a style="color:#e8533f" href="${target.replace(/&/g, '&amp;')}">Continue</a></p></body></html>`,
  );
}

function storedOrgs(acc: LinkedinAccountRow | undefined): Organization[] {
  if (!acc?.organizations) return [];
  try {
    const v = JSON.parse(acc.organizations) as Organization[];
    return Array.isArray(v) ? v.filter((o) => o && ORG_URN_RE.test(o.urn)) : [];
  } catch {
    return [];
  }
}

function canPostAsMember(acc: LinkedinAccountRow): boolean {
  return Boolean(acc.memberId) && grantedScopes(acc.scope).has('w_member_social');
}

function canPostAsOrgs(acc: LinkedinAccountRow): boolean {
  return grantedScopes(acc.scope).has('w_organization_social');
}

/* Looks up the member's Company Pages when the token allows it. Never fatal. */
async function lookupOrgs(accessToken: string, scope: string): Promise<{ memberId: string | null; json: string | null }> {
  const g = grantedScopes(scope);
  if (!g.has('w_organization_social') || !(g.has('r_organization_admin') || g.has('rw_organization_admin'))) {
    return { memberId: null, json: null };
  }
  try {
    const r = await fetchOrganizations(accessToken);
    return { memberId: r.memberId, json: JSON.stringify(r.organizations) };
  } catch (err) {
    console.warn('[LINKEDIN] page lookup failed:', err instanceof Error ? err.message : err);
    return { memberId: null, json: null };
  }
}

export const linkedinController = {
  status(req: express.Request, res: express.Response) {
    const acc = linkedinRepository.find(req.auth!.user.id);
    const connected = Boolean(acc && !isExpired(acc.expiresAt));
    const cfg = linkedinConfig();
    res.json({
      configured: Boolean(cfg),
      orgPosting: Boolean(cfg?.orgPosting || cfg?.scopes.includes('w_organization_social')),
      connected,
      canPostAsMember: Boolean(acc && canPostAsMember(acc)),
      canPostAsOrganization: Boolean(acc && canPostAsOrgs(acc)),
      organizations: acc && canPostAsOrgs(acc) ? storedOrgs(acc) : [],
      expired: Boolean(acc) && !connected,
      name: acc?.name ?? null,
      pictureUrl: acc?.pictureUrl ?? null,
      expiresAt: acc?.expiresAt ?? null,
      maxChars: MAX_POST_CHARS,
    });
  },

  /* Browser navigation from the app (same-site, so the session is there). */
  connect(req: express.Request, res: express.Response) {
    if (!linkedinConfig()) throw badRequest('LinkedIn publishing is not configured on this server');
    const returnTo: ReturnTo = req.query.return === 'account' ? 'account' : 'generate';
    res.redirect(302, authorizeUrl(createState(req.auth!.user.id, returnTo)));
  },

  /* Public route: identified by the single-use state, never by query data alone. */
  async callback(req: express.Request, res: express.Response) {
    const pending = consumeState(req.query.state);
    if (!pending) return backToApp(res, { linkedin: 'error', reason: 'expired' });
    const view = pending.returnTo;
    if (req.query.error) {
      return backToApp(res, { linkedin: 'error', reason: req.query.error === 'user_cancelled_authorize' || req.query.error === 'user_cancelled_login' ? 'cancelled' : 'denied', view });
    }
    const code = typeof req.query.code === 'string' && req.query.code.length < 2000 ? req.query.code : '';
    if (!code) return backToApp(res, { linkedin: 'error', reason: 'failed', view });
    try {
      const token = await exchangeCode(code);
      const granted = grantedScopes(token.scope);
      if (!granted.has('w_member_social') && !granted.has('w_organization_social')) {
        return backToApp(res, { linkedin: 'error', reason: 'scope', view });
      }
      /* OpenID gives name and picture; an app with only Community Management
         has no OpenID, and the member id then comes from the page roles. */
      const member = granted.has('openid') ? await fetchMember(token.accessToken) : null;
      const orgs = await lookupOrgs(token.accessToken, token.scope);
      linkedinRepository.upsert({
        userId: pending.userId,
        memberId: member?.id ?? orgs.memberId ?? '',
        name: member?.name ?? null,
        pictureUrl: member?.pictureUrl ?? null,
        accessToken: encryptSecret(token.accessToken),
        scope: token.scope,
        expiresAt: toSqlUtc(new Date(Date.now() + token.expiresIn * 1000)),
        organizations: orgs.json,
      });
      audit({ action: 'linkedin.connect', detail: `ok scopes=${token.scope}`, userId: pending.userId, ip: req.ip ?? null });
      return backToApp(res, { linkedin: 'connected', view });
    } catch (err) {
      console.warn('[LINKEDIN] connect failed:', err instanceof Error ? err.message : err);
      return backToApp(res, { linkedin: 'error', reason: 'failed', view });
    }
  },

  async disconnect(req: express.Request, res: express.Response) {
    const acc = linkedinRepository.find(req.auth!.user.id);
    if (acc) {
      linkedinRepository.delete(acc.userId);
      await revokeToken(decryptSecret(acc.accessToken));
    }
    res.json({ success: true });
  },

  /* Re-read the member's Company Pages (e.g. after being made a Page admin). */
  async refreshOrganizations(req: express.Request, res: express.Response) {
    const acc = linkedinRepository.find(req.auth!.user.id);
    if (!acc || isExpired(acc.expiresAt)) throw reconnect('Connect your LinkedIn account first');
    if (!canPostAsOrgs(acc)) throw badRequest('This LinkedIn connection cannot post as a Company Page. Connect it again.');
    let lookup: Awaited<ReturnType<typeof fetchOrganizations>>;
    try {
      lookup = await fetchOrganizations(decryptSecret(acc.accessToken));
    } catch (err) {
      if (err instanceof LinkedInError && err.status === 401) {
        linkedinRepository.delete(acc.userId);
        throw reconnect('LinkedIn no longer accepts this connection. Connect it again.');
      }
      throw new HttpError(502, err instanceof LinkedInError ? err.message : 'LinkedIn request failed');
    }
    linkedinRepository.setOrganizations(acc.userId, JSON.stringify(lookup.organizations));
    res.json({ organizations: lookup.organizations });
  },

  async publish(req: express.Request, res: express.Response) {
    if (!linkedinConfig()) throw badRequest('LinkedIn publishing is not configured on this server');
    const text = typeof req.body?.text === 'string' ? req.body.text.replace(/\r\n/g, '\n').trim() : '';
    if (!text) throw badRequest('The post is empty');
    if (text.length > MAX_POST_CHARS) throw badRequest(`LinkedIn posts can have at most ${MAX_POST_CHARS} characters`);

    const user = req.auth!.user;
    const acc = linkedinRepository.find(user.id);
    if (!acc) throw reconnect('Connect your LinkedIn account first');
    if (isExpired(acc.expiresAt)) throw reconnect('Your LinkedIn connection expired. Connect it again.');

    /* Who the post is from: "member" (default) or one of the member's Pages. */
    const wanted = typeof req.body?.author === 'string' ? req.body.author : 'member';
    let author: string;
    if (wanted === 'member') {
      if (!canPostAsMember(acc)) throw badRequest('This LinkedIn connection can only post as a Company Page');
      author = `urn:li:person:${acc.memberId}`;
    } else {
      if (!canPostAsOrgs(acc) || !storedOrgs(acc).some((o) => o.urn === wanted)) {
        throw badRequest('You cannot post as that LinkedIn Page');
      }
      author = wanted;
    }

    let urn: string;
    try {
      urn = await createPost(decryptSecret(acc.accessToken), author, toLittleText(text));
    } catch (err) {
      if (err instanceof LinkedInError && err.status === 401) {
        linkedinRepository.delete(user.id);
        throw reconnect('LinkedIn no longer accepts this connection. Connect it again.');
      }
      if (err instanceof LinkedInError && err.status === 403 && author !== `urn:li:person:${acc.memberId}`) {
        throw new HttpError(403, 'LinkedIn did not let you post as this Page. You need to be an admin or content admin of it.');
      }
      throw new HttpError(502, err instanceof LinkedInError ? err.message : 'LinkedIn request failed');
    }
    linkedinRepository.logPost(user.id, req.auth!.tenantId, urn, text.length, author);
    console.log(`[LINKEDIN] user ${user.id} published ${urn} as ${author}`);
    res.status(201).json({ urn, url: postUrl(urn) });
  },
};
