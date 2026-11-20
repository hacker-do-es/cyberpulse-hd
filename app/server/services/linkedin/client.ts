import { linkedinConfig, type LinkedInApp } from '../../config';

/* LinkedIn OAuth 2.0 (OpenID Connect) and the Posts API. Only these two
   fixed hosts are ever contacted. Scopes: openid + profile identify the
   member, w_member_social lets them post as themselves; with Community
   Management w_organization_social posts as a Company Page the member
   administers, found via r_organization_admin. OAuth calls take the app
   (main or pages, see config.ts) they belong to. */

export class LinkedInError extends Error {
  constructor(message: string, public readonly status = 0) {
    super(message);
  }
}

export function grantedScopes(scope: string | null | undefined): Set<string> {
  return new Set((scope || '').split(/[\s,]+/).filter(Boolean));
}
const AUTH_URL = 'https://www.linkedin.com/oauth/v2/authorization';
const TOKEN_URL = 'https://www.linkedin.com/oauth/v2/accessToken';
const REVOKE_URL = 'https://www.linkedin.com/oauth/v2/revoke';
const USERINFO_URL = 'https://api.linkedin.com/v2/userinfo';
const POSTS_URL = 'https://api.linkedin.com/rest/posts';
const ACLS_URL = 'https://api.linkedin.com/rest/organizationAcls';
const ORGS_URL = 'https://api.linkedin.com/rest/organizations';
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

export function authorizeUrl(app: LinkedInApp, state: string): string {
  const c = cfg();
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: app.clientId,
    redirect_uri: c.redirectUri,
    state,
    scope: app.scopes.join(' '),
  });
  return `${AUTH_URL}?${q.toString()}`;
}

export interface TokenResult {
  accessToken: string;
  expiresIn: number;
  scope: string;
}

export async function exchangeCode(app: LinkedInApp, code: string): Promise<TokenResult> {
  const c = cfg();
  const res = await call(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: c.redirectUri,
      client_id: app.clientId,
      client_secret: app.clientSecret,
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

function restHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    'LinkedIn-Version': cfg().apiVersion,
    'X-Restli-Protocol-Version': '2.0.0',
  };
}

export const ORG_URN_RE = /^urn:li:organization:(\d{1,20})$/;
/* Page roles LinkedIn lets publish organic posts for the organization. */
const POSTING_ROLES = new Set(['ADMINISTRATOR', 'CONTENT_ADMINISTRATOR', 'CONTENT_ADMIN', 'DIRECT_SPONSORED_CONTENT_POSTER']);

export interface Organization {
  urn: string;
  name: string | null;
  role: string;
}

export interface OrgLookup {
  /* The member id, from the ACL's roleAssignee (useful when the app has no OpenID). */
  memberId: string | null;
  organizations: Organization[];
}

/* Company Pages where the member holds an approved posting role. */
export async function fetchOrganizations(accessToken: string): Promise<OrgLookup> {
  const q = new URLSearchParams({ q: 'roleAssignee', state: 'APPROVED', count: '100' });
  const res = await call(`${ACLS_URL}?${q.toString()}`, { headers: restHeaders(accessToken) });
  if (!res.ok) throw new LinkedInError(`Could not read your LinkedIn Pages: ${await errorText(res)}`, res.status);
  const j = await res.json() as { elements?: Array<{ organization?: string; organizationTarget?: string; role?: string; roleAssignee?: string; state?: string }> };
  let memberId: string | null = null;
  const byUrn = new Map<string, Organization>();
  for (const e of j.elements ?? []) {
    const urn = e.organization ?? e.organizationTarget ?? '';
    const assignee = /^urn:li:person:([\w-]{1,100})$/.exec(e.roleAssignee ?? '');
    if (assignee) memberId = assignee[1];
    if (!ORG_URN_RE.test(urn) || !POSTING_ROLES.has(String(e.role)) || (e.state && e.state !== 'APPROVED')) continue;
    if (!byUrn.has(urn)) byUrn.set(urn, { urn, name: null, role: String(e.role) });
  }
  const organizations = [...byUrn.values()].slice(0, 20);
  /* Names are cosmetic: a failed lookup leaves the id. */
  await Promise.all(organizations.map(async (o) => {
    try {
      const r = await call(`${ORGS_URL}/${ORG_URN_RE.exec(o.urn)![1]}`, { headers: restHeaders(accessToken) });
      if (!r.ok) return;
      const org = await r.json() as { localizedName?: string };
      if (typeof org.localizedName === 'string') o.name = org.localizedName.slice(0, 200);
    } catch { /* keep the id */ }
  }));
  return { memberId, organizations };
}

/* Publishes a public text post as `author` (urn:li:person:… or
   urn:li:organization:…). Returns the post URN. */
export async function createPost(accessToken: string, author: string, commentary: string): Promise<string> {
  const res = await call(POSTS_URL, {
    method: 'POST',
    headers: { ...restHeaders(accessToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      author,
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
export async function revokeToken(app: LinkedInApp | undefined, accessToken: string): Promise<void> {
  if (!app) return;
  try {
    await call(REVOKE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: app.clientId, client_secret: app.clientSecret, token: accessToken }).toString(),
    });
  } catch { /* ignore */ }
}

export function postUrl(urn: string): string {
  return `https://www.linkedin.com/feed/update/${urn}/`;
}
