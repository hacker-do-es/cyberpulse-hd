import { audit } from '../services/logs/logStore';
import type express from 'express';
import { linkedinConfig, type LinkedInSlot } from '../config';
import { decryptSecret, encryptSecret } from '../lib/crypto';
import { HttpError, badRequest } from '../lib/http';
import { linkedinRepository } from '../repositories/linkedinRepository';
import {
  LinkedInError, authorizeUrl, exchangeCode, fetchMember, fetchOrganizations, grantedScopes, postUrl, revokeToken,
} from '../services/linkedin/client';
import { consumeState, createState, type ReturnTo } from '../services/linkedin/oauthState';
import {
  PublishError, SLOTS, appFor, canPostAsMember, canPostAsOrgs, isExpired, live, pagesOf, publishAs,
} from '../services/linkedin/accounts';
import { MAX_POST_CHARS } from '../services/linkedin/text';
import { toSqlUtc } from '../services/schedule';

/* "Publish to LinkedIn": each user connects their own LinkedIn account
   (OAuth) and publishes generated posts as themselves or as a Company Page
   they administer. A server may use one LinkedIn app for both, or two (the
   Community Management API must live in an app of its own): then each user
   has a 'main' connection (own profile) and a 'pages' connection. */

const reconnect = (msg: string) => new HttpError(409, msg, { code: 'LINKEDIN_RECONNECT' });

/* PublishError → HTTP (409 + LINKEDIN_RECONNECT asks the UI to reconnect). */
export function publishHttpError(err: unknown): HttpError {
  if (!(err instanceof PublishError)) return new HttpError(502, 'LinkedIn request failed');
  if (err.code === 'reconnect') return reconnect(err.message);
  if (err.code === 'invalid') return badRequest(err.message);
  if (err.code === 'denied') return new HttpError(403, err.message);
  return new HttpError(502, err.message);
}

const slotParam = (v: unknown): LinkedInSlot => (v === 'pages' ? 'pages' : 'main');

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

function connectionInfo(userId: number, slot: LinkedInSlot) {
  if (!appFor(slot)) return null;
  const acc = linkedinRepository.find(userId, slot);
  const connected = Boolean(acc && !isExpired(acc.expiresAt));
  return { connected, expired: Boolean(acc) && !connected, expiresAt: acc?.expiresAt ?? null };
}

export const linkedinController = {
  status(req: express.Request, res: express.Response) {
    const userId = req.auth!.user.id;
    const cfg = linkedinConfig();
    const main = live(userId, 'main');
    const mainInfo = connectionInfo(userId, 'main');
    const pagesInfo = connectionInfo(userId, 'pages');
    const pages = pagesOf(userId);
    const mainOffersPages = Boolean(cfg?.apps.main?.scopes.includes('w_organization_social'));
    res.json({
      configured: Boolean(cfg),
      /* The server can post as Company Pages (through either app). */
      orgPosting: Boolean(cfg?.apps.pages) || mainOffersPages,
      /* The server can post as the member (main app with w_member_social). */
      memberPosting: Boolean(cfg?.apps.main?.scopes.includes('w_member_social')),
      /* Company Pages use their own app and connection. */
      pagesApp: Boolean(cfg?.apps.pages),
      connected: Boolean(mainInfo?.connected || pagesInfo?.connected),
      expired: Boolean(mainInfo?.expired) && !mainInfo?.connected,
      expiresAt: mainInfo?.expiresAt ?? null,
      pagesConnection: pagesInfo,
      canPostAsMember: canPostAsMember(main),
      canPostAsOrganization: pages.length > 0 || canPostAsOrgs(main) || canPostAsOrgs(live(userId, 'pages')),
      organizations: pages.map((p) => p.org),
      name: main?.name ?? null,
      pictureUrl: main?.pictureUrl ?? null,
      maxChars: MAX_POST_CHARS,
    });
  },

  /* Browser navigation from the app (same-site, so the session is there). */
  connect(req: express.Request, res: express.Response) {
    const slot = slotParam(req.query.app);
    const app = appFor(slot);
    if (!app) throw badRequest('LinkedIn publishing is not configured on this server');
    const returnTo: ReturnTo = req.query.return === 'account' ? 'account' : 'generate';
    res.redirect(302, authorizeUrl(app, createState(req.auth!.user.id, returnTo, slot)));
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
    const app = appFor(pending.slot);
    if (!code || !app) return backToApp(res, { linkedin: 'error', reason: 'failed', view });
    try {
      const token = await exchangeCode(app, code);
      const granted = grantedScopes(token.scope);
      if (!granted.has('w_member_social') && !granted.has('w_organization_social')) {
        return backToApp(res, { linkedin: 'error', reason: 'scope', view });
      }
      /* OpenID gives name and picture; an app with only Community Management
         has no OpenID, and the member id then comes from the page roles. */
      const member = granted.has('openid') ? await fetchMember(token.accessToken) : null;
      const orgs = await lookupOrgs(token.accessToken, token.scope);
      linkedinRepository.upsert(pending.slot, {
        userId: pending.userId,
        memberId: member?.id ?? orgs.memberId ?? '',
        name: member?.name ?? null,
        pictureUrl: member?.pictureUrl ?? null,
        accessToken: encryptSecret(token.accessToken),
        scope: token.scope,
        expiresAt: toSqlUtc(new Date(Date.now() + token.expiresIn * 1000)),
        organizations: orgs.json,
      });
      audit({ action: 'linkedin.connect', detail: `ok app=${pending.slot} scopes=${token.scope}`, userId: pending.userId, ip: req.ip ?? null });
      return backToApp(res, { linkedin: 'connected', view });
    } catch (err) {
      console.warn('[LINKEDIN] connect failed:', err instanceof Error ? err.message : err);
      return backToApp(res, { linkedin: 'error', reason: 'failed', view });
    }
  },

  /* ?app=main|pages disconnects one connection; without it, all of them. */
  async disconnect(req: express.Request, res: express.Response) {
    const userId = req.auth!.user.id;
    const slots = req.query.app === undefined ? SLOTS : [slotParam(req.query.app)];
    for (const slot of slots) {
      const acc = linkedinRepository.find(userId, slot);
      if (!acc) continue;
      linkedinRepository.delete(userId, slot);
      await revokeToken(appFor(slot), decryptSecret(acc.accessToken));
    }
    res.json({ success: true });
  },

  /* Re-read the member's Company Pages (e.g. after being made a Page admin). */
  async refreshOrganizations(req: express.Request, res: express.Response) {
    const userId = req.auth!.user.id;
    const slots = SLOTS.filter((s) => canPostAsOrgs(live(userId, s)));
    if (slots.length === 0) {
      const any = SLOTS.some((s) => live(userId, s));
      if (!any) throw reconnect('Connect your LinkedIn account first');
      throw badRequest('This LinkedIn connection cannot post as a Company Page. Connect it again.');
    }
    for (const slot of slots) {
      const acc = live(userId, slot)!;
      let lookup: Awaited<ReturnType<typeof fetchOrganizations>>;
      try {
        lookup = await fetchOrganizations(decryptSecret(acc.accessToken));
      } catch (err) {
        if (err instanceof LinkedInError && err.status === 401) {
          linkedinRepository.delete(userId, slot);
          throw reconnect('LinkedIn no longer accepts this connection. Connect it again.');
        }
        throw new HttpError(502, err instanceof LinkedInError ? err.message : 'LinkedIn request failed');
      }
      linkedinRepository.setOrganizations(userId, slot, JSON.stringify(lookup.organizations));
    }
    res.json({ organizations: pagesOf(userId).map((p) => p.org) });
  },

  async publish(req: express.Request, res: express.Response) {
    if (!linkedinConfig()) throw badRequest('LinkedIn publishing is not configured on this server');
    const text = typeof req.body?.text === 'string' ? req.body.text : '';
    /* Who the post is from: "member" (default) or one of the member's Pages. */
    const wanted = typeof req.body?.author === 'string' ? req.body.author : 'member';
    try {
      const r = await publishAs(req.auth!.user.id, req.auth!.tenantId, wanted, text);
      res.status(201).json({ urn: r.urn, url: postUrl(r.urn) });
    } catch (err) {
      throw publishHttpError(err);
    }
  },
};
