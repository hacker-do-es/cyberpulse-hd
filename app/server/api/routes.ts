import express from 'express';
import { adminController } from '../controllers/adminController';
import { authController } from '../controllers/authController';
import { channelController } from '../controllers/channelController';
import { linkedinController } from '../controllers/linkedinController';
import {
  generateController, healthController, mcpController, newsController, scrapeController, sourceController,
} from '../controllers/newsController';
import { stackController } from '../controllers/stackController';
import { assetController } from '../controllers/assetController';
import { inventoryController } from '../controllers/inventoryController';
import { tenantSettingsController } from '../controllers/tenantSettingsController';
import { userController } from '../controllers/userController';
import { platformUserController } from '../controllers/platformUserController';
import { handle } from '../lib/http';
import { CSV_MAX_BYTES } from '../services/csv';
import { requireAuth, requirePermission, tenantCan } from './middlewares/auth';
import { auditTrail } from './middlewares/audit';
import { logsController } from '../controllers/logsController';
import { linkedinQueueController } from '../controllers/linkedinQueueController';
import { loginLimiter, requireMcpKey, sendLimiter, writeLimiter } from './middlewares/security';

/* Every HTTP endpoint, with its guards. Controllers hold no routing logic and
   routes hold no business logic. */

export function apiRouter(appVersion: string): express.Router {
  const api = express.Router();
  api.use(auditTrail);

  /* ---------------- Public ---------------- */
  api.get('/health', handle(healthController.health));
  api.get('/', (_req, res) => { res.json({ name: 'Hacker-Do CyberPulse API', version: appVersion }); });

  api.post('/auth/login', loginLimiter, handle(authController.login));
  api.post('/auth/logout', handle(authController.logout));

  /* LinkedIn sends the browser back here; the user is identified by the
     single-use OAuth state (the Strict session cookie is not sent). */
  api.get('/linkedin/callback', writeLimiter, handle(linkedinController.callback));

  /* Inventory agents: token in Authorization, plain-text report. */
  api.post('/inventory/report', writeLimiter,
    express.text({ type: () => true, limit: '12mb', inflate: false }), handle(inventoryController.report));
  /* The agent scripts hold no secrets: downloadable for one-line installs. */
  api.get('/inventory/agent/:os', handle(inventoryController.script));

  /* Machine access for AI agents (X-API-Key), read-mostly. */
  api.post('/mcp', writeLimiter, requireMcpKey, handle(mcpController.handle));

  /* ---------------- Logged in ---------------- */
  api.use(requireAuth);

  api.get('/auth/me', handle(authController.me));
  api.post('/auth/active-tenant', requirePermission('platform.switchTenant'), handle(authController.setActiveTenant));
  api.post('/auth/password', writeLimiter, handle(authController.changePassword));
  api.post('/auth/totp/setup', writeLimiter, handle(authController.totpSetup));
  api.post('/auth/totp/enable', writeLimiter, handle(authController.totpEnable));
  api.post('/auth/totp/disable', writeLimiter, handle(authController.totpDisable));

  /* Superadmin: companies */
  api.get('/admin/tenants', requirePermission('platform.tenants'), handle(adminController.list));
  api.get('/admin/logs', requirePermission('platform.logs'), handle(logsController.list));
  api.get('/admin/logs/sources', requirePermission('platform.logs'), handle(logsController.sources));
  api.get('/admin/logs/export.txt', requirePermission('platform.logs'), handle(logsController.exportTxt));
  api.post('/admin/tenants', requirePermission('platform.tenants'), writeLimiter, handle(adminController.create));
  api.patch('/admin/tenants/:id', requirePermission('platform.tenants'), writeLimiter, handle(adminController.update));
  api.delete('/admin/tenants/:id', requirePermission('platform.tenants'), writeLimiter, handle(adminController.remove));

  /* Company: technology stack */
  api.get('/tech-stack', ...tenantCan('inventory.read'), handle(stackController.list));
  api.get('/tech-stack/news', ...tenantCan('inventory.read'), handle(stackController.news));
  api.get('/tech-stack/export.csv', ...tenantCan('inventory.read'), handle(stackController.exportCsv));
  api.get('/tech-stack/template.csv', handle(stackController.template));
  api.post('/tech-stack', ...tenantCan('inventory.write'), writeLimiter, handle(stackController.create));
  api.post('/tech-stack/import', ...tenantCan('inventory.write'), writeLimiter,
    express.text({ type: 'text/csv', limit: CSV_MAX_BYTES + 1024, inflate: false }), handle(stackController.import));
  api.put('/tech-stack/:id', ...tenantCan('inventory.write'), writeLimiter, handle(stackController.update));
  api.delete('/tech-stack/:id', ...tenantCan('inventory.write'), writeLimiter, handle(stackController.remove));

  /* Company: assets (what runs the stack) */
  api.get('/assets', ...tenantCan('inventory.read'), handle(assetController.list));
  api.get('/assets/export.csv', ...tenantCan('inventory.read'), handle(assetController.exportCsv));
  api.get('/assets/template.csv', handle(assetController.template));
  api.post('/assets/import', ...tenantCan('inventory.write'), writeLimiter,
    express.text({ type: 'text/csv', limit: CSV_MAX_BYTES + 1024, inflate: false }), handle(assetController.import));
  api.post('/assets', ...tenantCan('inventory.write'), writeLimiter, handle(assetController.create));
  api.put('/assets/:id', ...tenantCan('inventory.write'), writeLimiter, handle(assetController.update));
  api.get('/assets/duplicates', ...tenantCan('inventory.read'), handle(assetController.duplicates));
  api.post('/assets/merge', ...tenantCan('inventory.write'), writeLimiter, handle(assetController.merge));
  api.delete('/assets/:id', ...tenantCan('inventory.write'), writeLimiter, handle(assetController.remove));

  /* Inventory agents: tokens (admins) and the hosts that report. */
  api.get('/inventory/agents', ...tenantCan('inventory.read'), handle(inventoryController.agents));
  api.get('/inventory/tokens', ...tenantCan('agents.tokens'), handle(inventoryController.listTokens));
  api.post('/inventory/tokens', ...tenantCan('agents.tokens'), writeLimiter, handle(inventoryController.createToken));
  api.delete('/inventory/tokens/:id', ...tenantCan('agents.tokens'), writeLimiter, handle(inventoryController.revokeToken));

  /* Company: settings and AI provider */
  api.get('/tenant/settings', ...tenantCan('settings.manage'), handle(tenantSettingsController.get));
  api.put('/tenant/settings', ...tenantCan('settings.manage'), writeLimiter, handle(tenantSettingsController.update));
  api.post('/tenant/ai/test', ...tenantCan('settings.manage'), writeLimiter, handle(tenantSettingsController.testAi));

  /* Company: delivery channels */
  api.get('/channels', ...tenantCan('channels.read'), handle(channelController.list));
  api.post('/channels', ...tenantCan('channels.manage'), writeLimiter, handle(channelController.create));
  api.post('/channels/preview-email', ...tenantCan('channels.manage'), writeLimiter, handle(channelController.previewEmail));
  api.put('/channels/:id', ...tenantCan('channels.manage'), writeLimiter, handle(channelController.update));
  api.delete('/channels/:id', ...tenantCan('channels.manage'), writeLimiter, handle(channelController.remove));
  api.post('/channels/:id/test', ...tenantCan('channels.run'), sendLimiter, handle(channelController.test));
  api.post('/channels/:id/run', ...tenantCan('channels.run'), sendLimiter, handle(channelController.run));
  api.get('/channels/:id/deliveries', ...tenantCan('channels.read'), handle(channelController.deliveries));

  /* Company: users */
  api.get('/users', ...tenantCan('users.manage'), handle(userController.list));
  api.post('/users', ...tenantCan('users.manage'), writeLimiter, handle(userController.create));
  api.patch('/users/:id', ...tenantCan('users.manage'), writeLimiter, handle(userController.update));
  api.delete('/users/:id', ...tenantCan('users.manage'), writeLimiter, handle(userController.remove));

  /* Superadmin: Hacker-Do support accounts */
  api.get('/admin/users', requirePermission('platform.users'), handle(platformUserController.list));
  api.post('/admin/users', requirePermission('platform.users'), writeLimiter, handle(platformUserController.create));
  api.patch('/admin/users/:id', requirePermission('platform.users'), writeLimiter, handle(platformUserController.update));
  api.delete('/admin/users/:id', requirePermission('platform.users'), writeLimiter, handle(platformUserController.remove));

  /* Shared news corpus and feeds */
  api.get('/news', handle(newsController.list));
  api.get('/news/:id', handle(newsController.get));
  api.get('/stats', handle(newsController.stats));
  api.get('/sources', handle(sourceController.list));
  api.post('/sources', writeLimiter, requirePermission('platform.feeds'), handle(sourceController.create));
  api.patch('/sources/:id', writeLimiter, requirePermission('platform.feeds'), handle(sourceController.setActive));
  api.delete('/sources/:id', writeLimiter, requirePermission('platform.feeds'), handle(sourceController.remove));
  api.get('/scrape/status', handle(scrapeController.status));
  api.post('/scrape', writeLimiter, requirePermission('platform.feeds'), handle(scrapeController.start));

  /* LinkedIn publishing, per user */
  api.get('/linkedin', handle(linkedinController.status));
  api.get('/linkedin/connect', requirePermission('linkedin.connect'), writeLimiter, handle(linkedinController.connect));
  api.delete('/linkedin', writeLimiter, handle(linkedinController.disconnect));
  api.post('/linkedin/organizations/refresh', requirePermission('linkedin.connect'), sendLimiter, handle(linkedinController.refreshOrganizations));
  api.post('/linkedin/posts', requirePermission('linkedin.approve'), sendLimiter, handle(linkedinController.publish));
  api.get('/linkedin/queue', ...tenantCan('content.generate'), handle(linkedinQueueController.list));
  /* Scheduling a post by hand publishes it without review: approvers only. */
  api.post('/linkedin/queue', ...tenantCan('linkedin.approve'), writeLimiter, handle(linkedinQueueController.schedule));
  api.put('/linkedin/queue/:id', ...tenantCan('content.generate'), writeLimiter, handle(linkedinQueueController.update));
  api.post('/linkedin/queue/:id/approve', ...tenantCan('linkedin.approve'), sendLimiter, handle(linkedinQueueController.approve));
  api.post('/linkedin/queue/:id/reject', ...tenantCan('linkedin.approve'), writeLimiter, handle(linkedinQueueController.reject));
  api.post('/linkedin/queue/:id/cancel', ...tenantCan('content.generate'), writeLimiter, handle(linkedinQueueController.cancel));

  /* Post generation */
  api.post('/generate', requirePermission('content.generate'), writeLimiter, handle(generateController.template));
  api.post('/digest', requirePermission('content.generate'), writeLimiter, handle(generateController.digest));
  api.post('/generate-ai', writeLimiter, ...tenantCan('content.generate'), handle(generateController.ai));

  return api;
}
