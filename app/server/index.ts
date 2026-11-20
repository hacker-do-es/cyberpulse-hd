import { createApp } from './app';
import { config } from './config';
import { getDb } from './db/client';
import { isEncryptionEnabled } from './lib/crypto';
import { startEventLoopMonitor } from './lib/eventLoop';
import { seedSources } from './services/seeds';
import { startJobs } from './jobs';
import { bootstrapSuperadmin } from './useCases/bootstrapSuperadmin';
import { installConsoleCapture, startLogStore } from './services/logs/logStore';

/* Entry point: database + migrations, seed data, background jobs, HTTP. */

/* Company AI keys, webhook URLs and TOTP seeds are stored encrypted. Running
   without the key would put every customer's secrets in the database in
   clear text, so production refuses to start. */
if (config.isProduction && !isEncryptionEnabled()) {
  console.error(
    '[SERVER] Refusing to start: NODE_ENV=production requires CYBERPULSE_SECRET.\n' +
    '         Generate one with:  openssl rand -hex 32   (and back it up: it decrypts stored secrets)'
  );
  process.exit(1);
}

const app = createApp();

async function start() {
  /* Keep server log lines for the superadmin "Logs" tab (stored once the DB is open). */
  installConsoleCapture();
  getDb();
  startLogStore();
  seedSources();
  await bootstrapSuperadmin();
  startEventLoopMonitor();
  startJobs();

  app.listen(config.port, () => {
    console.log(`[SERVER] Hacker-Do CyberPulse on port ${config.port}`);
    console.log(`[SERVER] MCP endpoint: ${config.mcpApiKey ? 'enabled (X-API-Key)' : 'disabled (set CYBERPULSE_API_KEY to enable)'}`);
    console.log(`[SERVER] Credentials at rest: ${isEncryptionEnabled() ? 'encrypted' : 'PLAIN TEXT (set CYBERPULSE_SECRET)'}`);
  });
}

if (!process.env.VITEST) {
  start().catch((err) => {
    console.error('[SERVER] Startup failed:', err);
    process.exit(1);
  });
}

export { app };
