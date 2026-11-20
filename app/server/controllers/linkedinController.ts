import { audit } from '../services/logs/logStore';
import type express from 'express';
import { linkedinConfig } from '../config';
import { decryptSecret, encryptSecret } from '../lib/crypto';
import { HttpError, badRequest } from '../lib/http';
import { linkedinRepository } from '../repositories/linkedinRepository';
import {
  LinkedInError, authorizeUrl, createPost, exchangeCode, fetchMember, postUrl, revokeToken,
} from '../services/linkedin/client';
import { consumeState, createState, type ReturnTo } from '../services/linkedin/oauthState';
import { MAX_POST_CHARS, toLittleText } from '../services/linkedin/text';
import { toSqlUtc } from '../services/schedule';

/* "Publish to LinkedIn": each user connects their own LinkedIn member
   account (OAuth), and can then publish generated posts as themselves. */

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

export const linkedinController = {
  status(req: express.Request, res: express.Response) {
    const acc = linkedinRepository.find(req.auth!.user.id);
    const connected = Boolean(acc && !isExpired(acc.expiresAt));
    res.json({
      configured: Boolean(linkedinConfig()),
      connected,
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
      if (!token.scope.split(/[\s,]+/).includes('w_member_social')) {
        return backToApp(res, { linkedin: 'error', reason: 'scope', view });
      }
      const member = await fetchMember(token.accessToken);
      linkedinRepository.upsert({
        userId: pending.userId,
        memberId: member.id,
        name: member.name,
        pictureUrl: member.pictureUrl,
        accessToken: encryptSecret(token.accessToken),
        scope: token.scope,
        expiresAt: toSqlUtc(new Date(Date.now() + token.expiresIn * 1000)),
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

  async publish(req: express.Request, res: express.Response) {
    if (!linkedinConfig()) throw badRequest('LinkedIn publishing is not configured on this server');
    const text = typeof req.body?.text === 'string' ? req.body.text.replace(/\r\n/g, '\n').trim() : '';
    if (!text) throw badRequest('The post is empty');
    if (text.length > MAX_POST_CHARS) throw badRequest(`LinkedIn posts can have at most ${MAX_POST_CHARS} characters`);

    const user = req.auth!.user;
    const acc = linkedinRepository.find(user.id);
    if (!acc) throw reconnect('Connect your LinkedIn account first');
    if (isExpired(acc.expiresAt)) throw reconnect('Your LinkedIn connection expired. Connect it again.');

    let urn: string;
    try {
      urn = await createPost(decryptSecret(acc.accessToken), acc.memberId, toLittleText(text));
    } catch (err) {
      if (err instanceof LinkedInError && err.status === 401) {
        linkedinRepository.delete(user.id);
        throw reconnect('LinkedIn no longer accepts this connection. Connect it again.');
      }
      throw new HttpError(502, err instanceof LinkedInError ? err.message : 'LinkedIn request failed');
    }
    linkedinRepository.logPost(user.id, req.auth!.tenantId, urn, text.length);
    console.log(`[LINKEDIN] user ${user.id} published ${urn}`);
    res.status(201).json({ urn, url: postUrl(urn) });
  },
};
