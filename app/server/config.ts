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

/* LinkedIn app (developers.linkedin.com) for "Publish to LinkedIn". Read
   lazily so tests can set them. Publishing is off unless all three are set. */
export const linkedinConfig = () => {
  const clientId = (process.env.LINKEDIN_CLIENT_ID || '').trim();
  const clientSecret = (process.env.LINKEDIN_CLIENT_SECRET || '').trim();
  const redirectUri = (process.env.LINKEDIN_REDIRECT_URI || '').trim();
  return clientId && clientSecret && redirectUri
    ? {
      clientId, clientSecret, redirectUri,
      apiVersion: (process.env.LINKEDIN_API_VERSION || '202609').trim(),
      /* Posting as a Company Page needs LinkedIn's Community Management API
         product (reviewed by LinkedIn). Asking for its scopes before the app
         has it makes LinkedIn reject the whole sign-in, so it is opt-in. */
      orgPosting: (process.env.LINKEDIN_ORG_POSTING || '').trim() === '1',
      /* Optional override, e.g. when Community Management lives in an app
         without "Sign In with LinkedIn": "w_organization_social r_organization_admin". */
      scopes: (process.env.LINKEDIN_SCOPES || '').trim().split(/[\s,]+/).filter(Boolean),
    }
    : null;
};

export const flags = {
  cookieSecure: () => process.env.CYBERPULSE_COOKIE_SECURE,
  allowHttpWebhooks: () => process.env.CYBERPULSE_ALLOW_HTTP_WEBHOOKS === 'true',
  allowPrivateWebhooks: () => process.env.CYBERPULSE_ALLOW_PRIVATE_WEBHOOKS === 'true',
};
