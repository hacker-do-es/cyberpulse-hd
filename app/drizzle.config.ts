import { defineConfig } from 'drizzle-kit';

/* `npm run db:generate` diffs server/db/schema.ts against the last snapshot
   and writes a new SQL migration into server/db/migrations. Migrations are
   applied automatically on startup (server/db/migrate.ts). */
export default defineConfig({
  dialect: 'sqlite',
  schema: './server/db/schema.ts',
  out: './server/db/migrations',
  strict: true,
  verbose: true,
});
