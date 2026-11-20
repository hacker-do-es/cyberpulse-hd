import { linkedinConfig } from '../../config';

/* LinkedIn OAuth 2.0 (OpenID Connect) and the Posts API. Only these two
   fixed hosts are ever contacted. Scopes: openid + profile identify the
   member, w_member_social lets them post as themselves. */

export class LinkedInError extends Error {
  constructor(message: string, public readonly status = 0) {
    super(message);
  }
}

export const SCOPES = ['openid', 'profile', 'w_member_social'];
const AUTH_URL = 'https://www.linkedin.com/oauth/v2/authorization';
const TOKEN_URL = 'https://www.linkedin.com/oauth/v2/accessToken';
const REVOKE_URL = 'https://www.linkedin.com/oauth/v2/revoke';
const USERINFO_URL = 'https://api.linkedin.com/v2/userinfo';
const POSTS_URL = 'https://api.linkedin.com/rest/posts';
const TIMEOUT_MS = 15_000;

type Fetch = typeof fetch;
let doFetch: Fetch = (input, init) => fetch(input, init);

/* Tests replace the network. */
export function setLinkedInFetch(f: Fetch | null): void {
  doFetch = f ?? ((input, init) => fetch(input, init));
}

function cfg() {
  const c = linkedinConfig();
  if (!c) throw new LinkedInError('LinkedIn publishing is not configured on this server');
  return c;
}

async function call(url: string, init: RequestInit): Promise<Response> {
  try {
    return await doFetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new LinkedInError('Could not reach LinkedIn');
  }
}

async function errorText(res: Response): Promise<string> {
  try {
    const body = await res.text();
    const j = JSON.parse(body);
    return String(j.message || j.error_description || j.error || body).slice(0, 200);
  } catch {
    return `HTTP ${res.status}`;
  }
}

export function authorizeUrl(state: string): string {
  const c = cfg();
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: c.clientId,
    redirect_uri: c.redirectUri,
    state,
    scope: SCOPES.join(' '),
  });
  return `${AUTH_URL}?${q.toString()}`;
}

export interface TokenResult {
  accessToken: string;
  expiresIn: number;
  scope: string;
}

export async function exchangeCode(code: string): Promise<TokenResult> {
  const c = cfg();
  const res = await call(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: c.redirectUri,
      client_id: c.clientId,
      client_secret: c.clientSecret,
    }).toString(),
  });
  if (!res.ok) throw new LinkedInError(`LinkedIn refused the authorization: ${await errorText(res)}`, res.status);
  const j = await res.json() as { access_token?: string; expires_in?: number; scope?: string };
  if (!j.access_token) throw new LinkedInError('LinkedIn returned no access token');
  return { accessToken: j.access_token, expiresIn: Number(j.expires_in) || 3600, scope: j.scope || '' };
}

export interface Member {
  id: string;
  name: string | null;
  pictureUrl: string | null;
}

export async function fetchMember(accessToken: string): Promise<Member> {
  const res = await call(USERINFO_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new LinkedInError(`Could not read the LinkedIn profile: ${await errorText(res)}`, res.status);
  const j = await res.json() as { sub?: string; name?: string; picture?: string };
  if (!j.sub || !/^[\w-]{1,100}$/.test(j.sub)) throw new LinkedInError('LinkedIn returned no member id');
  const picture = typeof j.picture === 'string' && j.picture.startsWith('https://') ? j.picture : null;
  return { id: j.sub, name: typeof j.name === 'string' ? j.name.slice(0, 200) : null, pictureUrl: picture };
}

/* Publishes a public text post as the member. Returns the post URN. */
export async function createPost(accessToken: string, memberId: string, commentary: string): Promise<string> {
  const c = cfg();
  const res = await call(POSTS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'LinkedIn-Version': c.apiVersion,
      'X-Restli-Protocol-Version': '2.0.0',
    },
    body: JSON.stringify({
      author: `urn:li:person:${memberId}`,
      commentary,
      visibility: 'PUBLIC',
      distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false,
    }),
  });
  if (!res.ok) throw new LinkedInError(`LinkedIn rejected the post: ${await errorText(res)}`, res.status);
  const urn = res.headers.get('x-restli-id') || res.headers.get('x-linkedin-id') || '';
  if (!/^urn:li:(share|ugcPost):\d+$/.test(urn)) throw new LinkedInError('LinkedIn did not return the post id');
  return urn;
}

/* Best effort: the token is deleted locally either way. */
export async function revokeToken(accessToken: string): Promise<void> {
  const c = linkedinConfig();
  if (!c) return;
  try {
    await call(REVOKE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: c.clientId, client_secret: c.clientSecret, token: accessToken }).toString(),
    });
  } catch { /* ignore */ }
}

export function postUrl(urn: string): string {
  return `https://www.linkedin.com/feed/update/${urn}/`;
}
