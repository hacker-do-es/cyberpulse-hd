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
  /* Per IP, per 15 minutes. */
  rateLogin: int(process.env.CYBERPULSE_RATE_LOGIN, 20),
  maxNews: int(process.env.CYBERPULSE_MAX_NEWS, 20000),
  sessionHours: int(process.env.CYBERPULSE_SESSION_HOURS, 12),
  scrapeCron: (process.env.SCRAPE_CRON || '').trim() || '*/15 * * * *',
  scrapeConcurrency: int(process.env.CYBERPULSE_SCRAPE_CONCURRENCY, 8),
  aiHosts: process.env.CYBERPULSE_AI_HOSTS,
};

export const DEFAULT_SCRAPE_CRON = '*/15 * * * *';

export const flags = {
  cookieSecure: () => process.env.CYBERPULSE_COOKIE_SECURE,
  allowHttpWebhooks: () => process.env.CYBERPULSE_ALLOW_HTTP_WEBHOOKS === 'true',
  allowPrivateWebhooks: () => process.env.CYBERPULSE_ALLOW_PRIVATE_WEBHOOKS === 'true',
};
