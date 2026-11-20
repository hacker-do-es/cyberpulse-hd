import express from 'express';
import { adminController } from '../controllers/adminController';
import { authController } from '../controllers/authController';
import { channelController } from '../controllers/channelController';
import {
  generateController, healthController, mcpController, newsController, scrapeController, sourceController,
} from '../controllers/newsController';
import { stackController } from '../controllers/stackController';
import { tenantSettingsController } from '../controllers/tenantSettingsController';
import { userController } from '../controllers/userController';
import { handle } from '../lib/http';
import { CSV_MAX_BYTES } from '../services/csv';
import { requireAuth, requireRole, requireTenant, requireTenantAdmin } from './middlewares/auth';
import { loginLimiter, requireMcpKey, sendLimiter, writeLimiter } from './middlewares/security';

/* Every HTTP endpoint, with its guards. Controllers hold no routing logic and
   routes hold no business logic. */

export function apiRouter(appVersion: string): express.Router {
  const api = express.Router();

  /* ---------------- Public ---------------- */
  api.get('/health', handle(healthController.health));
  api.get('/', (_req, res) => { res.json({ name: 'Hacker-Do CyberPulse API', version: appVersion }); });

  api.post('/auth/login', loginLimiter, handle(authController.login));
  api.post('/auth/logout', handle(authController.logout));

  /* Machine access for AI agents (X-API-Key), read-mostly. */
  api.post('/mcp', writeLimiter, requireMcpKey, handle(mcpController.handle));

  /* ---------------- Logged in ---------------- */
  api.use(requireAuth);

  api.get('/auth/me', handle(authController.me));
  api.post('/auth/active-tenant', requireRole('superadmin'), handle(authController.setActiveTenant));
  api.post('/auth/password', writeLimiter, handle(authController.changePassword));
  api.post('/auth/totp/setup', writeLimiter, handle(authController.totpSetup));
  api.post('/auth/totp/enable', writeLimiter, handle(authController.totpEnable));
  api.post('/auth/totp/disable', writeLimiter, handle(authController.totpDisable));

  /* Superadmin: companies */
  api.get('/admin/tenants', requireRole('superadmin'), handle(adminController.list));
  api.post('/admin/tenants', requireRole('superadmin'), writeLimiter, handle(adminController.create));
  api.patch('/admin/tenants/:id', requireRole('superadmin'), writeLimiter, handle(adminController.update));
  api.delete('/admin/tenants/:id', requireRole('superadmin'), writeLimiter, handle(adminController.remove));

  /* Company: technology stack */
  api.get('/tech-stack', requireTenant, handle(stackController.list));
  api.get('/tech-stack/news', requireTenant, handle(stackController.news));
  api.get('/tech-stack/export.csv', requireTenant, handle(stackController.exportCsv));
  api.get('/tech-stack/template.csv', handle(stackController.template));
  api.post('/tech-stack', ...requireTenantAdmin, writeLimiter, handle(stackController.create));
  api.post('/tech-stack/import', ...requireTenantAdmin, writeLimiter,
    express.text({ type: 'text/csv', limit: CSV_MAX_BYTES + 1024 }), handle(stackController.import));
  api.put('/tech-stack/:id', ...requireTenantAdmin, writeLimiter, handle(stackController.update));
  api.delete('/tech-stack/:id', ...requireTenantAdmin, writeLimiter, handle(stackController.remove));

  /* Company: settings and AI provider */
  api.get('/tenant/settings', ...requireTenantAdmin, handle(tenantSettingsController.get));
  api.put('/tenant/settings', ...requireTenantAdmin, writeLimiter, handle(tenantSettingsController.update));
  api.post('/tenant/ai/test', ...requireTenantAdmin, writeLimiter, handle(tenantSettingsController.testAi));

  /* Company: delivery channels */
  api.get('/channels', ...requireTenantAdmin, handle(channelController.list));
  api.post('/channels', ...requireTenantAdmin, writeLimiter, handle(channelController.create));
  api.post('/channels/preview-email', ...requireTenantAdmin, writeLimiter, handle(channelController.previewEmail));
  api.put('/channels/:id', ...requireTenantAdmin, writeLimiter, handle(channelController.update));
  api.delete('/channels/:id', ...requireTenantAdmin, writeLimiter, handle(channelController.remove));
  api.post('/channels/:id/test', ...requireTenantAdmin, sendLimiter, handle(channelController.test));
  api.post('/channels/:id/run', ...requireTenantAdmin, sendLimiter, handle(channelController.run));
  api.get('/channels/:id/deliveries', ...requireTenantAdmin, handle(channelController.deliveries));

  /* Company: users */
  api.get('/users', ...requireTenantAdmin, handle(userController.list));
  api.post('/users', ...requireTenantAdmin, writeLimiter, handle(userController.create));
  api.patch('/users/:id', ...requireTenantAdmin, writeLimiter, handle(userController.update));
  api.delete('/users/:id', ...requireTenantAdmin, writeLimiter, handle(userController.remove));

  /* Shared news corpus and feeds */
  api.get('/news', handle(newsController.list));
  api.get('/news/:id', handle(newsController.get));
  api.get('/stats', handle(newsController.stats));
  api.get('/sources', handle(sourceController.list));
  api.post('/sources', writeLimiter, requireRole('superadmin'), handle(sourceController.create));
  api.patch('/sources/:id', writeLimiter, requireRole('superadmin'), handle(sourceController.setActive));
  api.delete('/sources/:id', writeLimiter, requireRole('superadmin'), handle(sourceController.remove));
  api.get('/scrape/status', handle(scrapeController.status));
  api.post('/scrape', writeLimiter, requireRole('superadmin'), handle(scrapeController.start));

  /* Post generation */
  api.post('/generate', writeLimiter, handle(generateController.template));
  api.post('/digest', writeLimiter, handle(generateController.digest));
  api.post('/generate-ai', writeLimiter, requireTenant, handle(generateController.ai));

  return api;
}
