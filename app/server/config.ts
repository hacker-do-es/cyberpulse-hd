/* Environment configuration, read in one place. Values are read lazily
   (functions) where tests change them at runtime. */

const int = (v: string | undefined, fallback: number) => {
  const n = parseInt(v || '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export const config = {
  port: Number(process.env.PORT) || 3001,
  isProduction: process.env.NODE_ENV === 'production',
  trustProxy: process.env.TRUST_PROXY || null,
  /* Served over plain http (e.g. http://LAN-IP:3001): no HSTS / upgrade. */
  plainHttp: process.env.CYBERPULSE_PLAIN_HTTP === 'true',
  corsOrigins: (process.env.CYBERPULSE_CORS_ORIGINS || '')
    .split(',').map((o) => o.trim()).filter(Boolean)
    /* A wildcard would let any website drive a logged-in session. */
    .filter((o) => o !== '*'),
  /* Machine access (AI agents) to the read-only MCP endpoint. */
  mcpApiKey: process.env.CYBERPULSE_API_KEY || null,
  rateRead: int(process.env.CYBERPULSE_RATE_READ, 300),
  rateWrite: int(process.env.CYBERPULSE_RATE_WRITE, 60),
  /* Manual Test / Send now, per IP per minute. */
  rateSend: int(process.env.CYBERPULSE_RATE_SEND, 10),
  /* Per IP, per 15 minutes. */
  rateLogin: int(process.env.CYBERPULSE_RATE_LOGIN, 20),
  maxNews: int(process.env.CYBERPULSE_MAX_NEWS, 20000),
  sessionHours: int(process.env.CYBERPULSE_SESSION_HOURS, 12),
  scrapeCron: (process.env.SCRAPE_CRON || '').trim() || '*/15 * * * *',
  scrapeConcurrency: int(process.env.CYBERPULSE_SCRAPE_CONCURRENCY, 8),
  aiHosts: process.env.CYBERPULSE_AI_HOSTS,
};

export const DEFAULT_SCRAPE_CRON = '*/15 * * * *';

/* LinkedIn apps (developers.linkedin.com) for "Publish to LinkedIn". Read
   lazily so tests can set them.

   - Main app (LINKEDIN_CLIENT_ID/SECRET): "Sign In with LinkedIn using
     OpenID Connect" + "Share on LinkedIn" -> users post as themselves.
     LINKEDIN_ORG_POSTING=1 also asks it for Company Page scopes, for an app
     that has Community Management too. LINKEDIN_SCOPES overrides its list.
   - Pages app (LINKEDIN_PAGES_CLIENT_ID/SECRET, optional): a separate app
     with only the Community Management API (LinkedIn does not let it share
     an app with other products) -> users post as Company Pages they manage.
     LINKEDIN_PAGES_SCOPES overrides its list.
   Both share LINKEDIN_REDIRECT_URI. Publishing is off unless at least one
   app and the redirect URI are set. */
export type LinkedInSlot = 'main' | 'pages';

export interface LinkedInApp {
  slot: LinkedInSlot;
  clientId: string;
  clientSecret: string;
  scopes: string[];
}

const scopeList = (v: string | undefined) => (v || '').trim().split(/[\s,]+/).filter(Boolean);

export const LINKEDIN_MEMBER_SCOPES = ['openid', 'profile', 'w_member_social'];
export const LINKEDIN_ORG_SCOPES = ['w_organization_social', 'r_organization_admin'];

export const linkedinConfig = () => {
  const redirectUri = (process.env.LINKEDIN_REDIRECT_URI || '').trim();
  const mainId = (process.env.LINKEDIN_CLIENT_ID || '').trim();
  const mainSecret = (process.env.LINKEDIN_CLIENT_SECRET || '').trim();
  const pagesId = (process.env.LINKEDIN_PAGES_CLIENT_ID || '').trim();
  const pagesSecret = (process.env.LINKEDIN_PAGES_CLIENT_SECRET || '').trim();
  const orgPosting = (process.env.LINKEDIN_ORG_POSTING || '').trim() === '1';

  const apps: Partial<Record<LinkedInSlot, LinkedInApp>> = {};
  if (mainId && mainSecret) {
    const override = scopeList(process.env.LINKEDIN_SCOPES);
    apps.main = {
      slot: 'main', clientId: mainId, clientSecret: mainSecret,
      scopes: override.length ? override : orgPosting ? [...LINKEDIN_MEMBER_SCOPES, ...LINKEDIN_ORG_SCOPES] : LINKEDIN_MEMBER_SCOPES,
    };
  }
  if (pagesId && pagesSecret) {
    const override = scopeList(process.env.LINKEDIN_PAGES_SCOPES);
    apps.pages = { slot: 'pages', clientId: pagesId, clientSecret: pagesSecret, scopes: override.length ? override : LINKEDIN_ORG_SCOPES };
  }
  if (!redirectUri || (!apps.main && !apps.pages)) return null;
  return { redirectUri, apiVersion: (process.env.LINKEDIN_API_VERSION || '202609').trim(), apps };
};

export const flags = {
  cookieSecure: () => process.env.CYBERPULSE_COOKIE_SECURE,
  allowHttpWebhooks: () => process.env.CYBERPULSE_ALLOW_HTTP_WEBHOOKS === 'true',
  allowPrivateWebhooks: () => process.env.CYBERPULSE_ALLOW_PRIVATE_WEBHOOKS === 'true',
};
