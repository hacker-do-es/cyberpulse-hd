import { createRequire } from 'module';
import path from 'path';
import compression from 'compression';
import express from 'express';
import { config } from './config';
import { corsPolicy, errorHandler, readLimiter, rejectCompressedBodies, securityHeaders } from './api/middlewares/security';
import { apiRouter } from './api/routes';

/* Read the version from package.json rather than restating it here. */
const { version: APP_VERSION } = createRequire(import.meta.url)('../package.json') as { version: string };

export function createApp(): express.Express {
  const app = express();

  /* Behind Traefik/Cloudflare the client IP arrives in X-Forwarded-For; without
     this the rate limiters bucket everyone together and cookies are not
     marked Secure. */
  if (config.trustProxy) app.set('trust proxy', config.trustProxy);

  app.disable('x-powered-by');
  app.use(securityHeaders);
  /* /api/news ships the whole corpus so the UI can filter client-side. */
  app.use(compression());
  app.use('/api', readLimiter);
  app.use(corsPolicy);
  app.use(rejectCompressedBodies);
  app.use(express.json({ limit: '2mb', inflate: false }));

  /* ---------------- Frontend ---------------- */
  const distPath = path.resolve(process.cwd(), 'dist');
  /* Vite fingerprints everything under /assets; index.html names the current
     bundle, so it must never be cached. */
  app.use('/assets', express.static(path.join(distPath, 'assets'), { immutable: true, maxAge: '1y' }));
  app.use(express.static(distPath, {
    maxAge: '1h',
    setHeaders(res, filePath) {
      if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
    },
  }));

  /* ---------------- API ---------------- */
  app.use('/api', apiRouter(APP_VERSION));

  /* SPA fallback */
  app.get('/{*splat}', (_req, res) => res.sendFile(path.join(distPath, 'index.html')));

  app.use(errorHandler);
  return app;
}
