import crypto from 'crypto';
import cors from 'cors';
import type express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { config } from '../../config';
import { HttpError } from '../../lib/http';
import { isSameOrigin } from '../../lib/security';

/* ------------------------------------------------------------------ */
/*  Rate limits                                                        */
/* ------------------------------------------------------------------ */

const limiter = (limit: number, windowMs: number, error: string) => rateLimit({
  windowMs, limit, standardHeaders: 'draft-7', legacyHeaders: false, message: { error },
});

const SLOW_DOWN = 'Too many requests, slow down.';
export const readLimiter = limiter(config.rateRead, 60_000, SLOW_DOWN);
/* Writes touch an AI provider, a webhook or a full scrape: tighter budget. */
export const writeLimiter = limiter(config.rateWrite, 60_000, SLOW_DOWN);
export const loginLimiter = limiter(config.rateLogin, 15 * 60_000, 'Too many login attempts, try again later.');
export const sendLimiter = limiter(config.rateSend, 60_000, 'Too many manual sends, wait a minute.');

/* ------------------------------------------------------------------ */
/*  Headers                                                            */
/* ------------------------------------------------------------------ */

export const securityHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      /* Over plain http the browser would upgrade the bundle to https and the
         page would render blank. */
      ...(config.plainHttp ? { upgradeInsecureRequests: null } : {}),
    },
  },
  hsts: config.plainHttp ? false : undefined,
  crossOriginEmbedderPolicy: false,
});

/* The bundled UI is same-origin and never needs CORS; only the Vite dev
   server and explicitly allowed origins do. */
const DEFAULT_ORIGINS = [
  `http://localhost:${config.port}`, `http://127.0.0.1:${config.port}`,
  'http://localhost:3000', 'http://127.0.0.1:3000',
];
const allowedOrigins = config.corsOrigins.length ? config.corsOrigins : DEFAULT_ORIGINS;

export const corsPolicy = cors((req, callback) => {
  const origin = req.headers.origin;
  if (origin && !isSameOrigin(origin, req.headers.host, (req as express.Request).protocol) && !allowedOrigins.includes(origin)) {
    return callback(new HttpError(403, `Origin not allowed by CORS: ${origin}`), {});
  }
  callback(null, {
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-API-Key', 'X-Requested-With'],
  });
});

/* Request bodies are never compressed by the app or its API clients, and the
   decompressors are attack surface (CVE-2026-111497 "Node2Shell" was an
   out-of-bounds write in Node's Brotli decoder reached through
   Content-Encoding: br). Anything but identity is refused before any parser
   runs; the parsers also have inflate disabled as a second layer. */
export function rejectCompressedBodies(req: express.Request, res: express.Response, next: express.NextFunction) {
  const enc = req.headers['content-encoding'];
  if (enc && String(enc).trim().toLowerCase() !== 'identity') {
    return res.status(415).json({ error: 'Compressed request bodies are not accepted' });
  }
  next();
}

/* ------------------------------------------------------------------ */
/*  Machine access to the MCP endpoint                                 */
/* ------------------------------------------------------------------ */

export function requireMcpKey(req: express.Request, res: express.Response, next: express.NextFunction) {
  const key = config.mcpApiKey;
  if (!key) return res.status(404).json({ error: 'MCP endpoint disabled' });
  const provided = req.headers['x-api-key'];
  if (typeof provided !== 'string' || provided.length !== key.length ||
      !crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(key))) {
    return res.status(401).json({ error: 'Invalid or missing API key (X-API-Key header).' });
  }
  next();
}

/* ------------------------------------------------------------------ */
/*  Errors                                                             */
/* ------------------------------------------------------------------ */

export function errorHandler(err: unknown, req: express.Request, res: express.Response, next: express.NextFunction) {
  if (res.headersSent) return next(err);
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, ...err.extra });
  }
  console.error('[API]', req.method, req.path, err);
  res.status(500).json({ error: 'Internal server error' });
}
