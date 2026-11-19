import type Database from 'better-sqlite3';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import path from 'path';

/* One-time conversion of a database created by the pre-Drizzle server
   (hand-written migrations v1-v10, tracked in `schema_metadata`) into the
   Drizzle-managed schema.

   It runs once, before the normal migrator, and only when the legacy marker
   is present and Drizzle has never run on this file:
   1. a consistent copy of the database is written next to it (VACUUM INTO);
   2. inside one transaction, every legacy table is renamed, the baseline
      migration (0000) creates the new tables, all rows are copied over,
      and the legacy tables (plus the unused LinkedIn ones) are dropped;
   3. the baseline is recorded as applied, so `migrate()` continues from
      there with any later migration.
   If anything fails the transaction rolls back and the file is left exactly
   as it was; startup then fails loudly instead of running on a half state. */

const DATA_TABLES = [
  'articles', 'sources', 'fetch_log', 'tenants', 'users', 'sessions',
  'user_tech_stack', 'channels', 'deliveries', 'channel_sent_articles',
] as const;

const OBSOLETE_TABLES = ['linkedin_config', 'linkedin_tokens', 'linkedin_oauth_states', 'schema_metadata'];

const LEGACY_PREFIX = '__legacy_';

function tableExists(db: Database.Database, name: string): boolean {
  return Boolean(db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name));
}

const q = (id: string) => `"${id.replace(/"/g, '""')}"`;

function columns(db: Database.Database, table: string) {
  return db.prepare(`PRAGMA table_info(${q(table)})`).all() as Array<{ name: string; notnull: number; dflt_value: string | null }>;
}

function count(db: Database.Database, table: string): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM ${q(table)}`).get() as { n: number }).n;
}

export function isLegacyDatabase(db: Database.Database): boolean {
  return tableExists(db, 'schema_metadata') && !tableExists(db, '__drizzle_migrations');
}

export function convertLegacyDatabase(db: Database.Database, dbFile: string, migrationsFolder: string): void {
  const [baseline] = readMigrationFiles({ migrationsFolder });
  if (!baseline) throw new Error('No baseline migration found');

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = path.join(path.dirname(dbFile), `cyberpulse.pre-drizzle-${stamp}.db`);
  db.prepare('VACUUM INTO ?').run(backup);
  console.log(`[DB] Legacy schema detected. Backup written to ${backup}`);

  const present = DATA_TABLES.filter((t) => tableExists(db, t));
  const before = Object.fromEntries(present.map((t) => [t, count(db, t)]));

  /* Foreign keys cannot be toggled inside a transaction. */
  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      for (const t of present) db.exec(`ALTER TABLE ${q(t)} RENAME TO ${q(LEGACY_PREFIX + t)}`);

      /* Index names are global; the legacy ones would clash with the new ones. */
      const legacyIndexes = db.prepare(
        `SELECT name FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL AND tbl_name LIKE '${LEGACY_PREFIX}%'`
      ).all() as Array<{ name: string }>;
      for (const { name } of legacyIndexes) db.exec(`DROP INDEX ${q(name)}`);

      for (const statement of baseline.sql) if (statement.trim()) db.exec(statement);

      for (const t of present) {
        const legacyCols = new Set(columns(db, LEGACY_PREFIX + t).map((c) => c.name));
        const target = columns(db, t).filter((c) => legacyCols.has(c.name));
        /* NOT NULL columns that the old schema allowed to be NULL take the
           new column default. */
        const select = target.map((c) =>
          c.notnull && c.dflt_value !== null ? `COALESCE(${q(c.name)}, ${c.dflt_value})` : q(c.name));
        db.exec(
          `INSERT INTO ${q(t)} (${target.map((c) => q(c.name)).join(', ')}) ` +
          `SELECT ${select.join(', ')} FROM ${q(LEGACY_PREFIX + t)}`
        );
        const after = count(db, t);
        if (after !== before[t]) throw new Error(`Row count mismatch in ${t}: ${before[t]} -> ${after}`);
      }

      for (const t of present) db.exec(`DROP TABLE ${q(LEGACY_PREFIX + t)}`);
      for (const t of OBSOLETE_TABLES) db.exec(`DROP TABLE IF EXISTS ${q(t)}`);

      const broken = db.pragma('foreign_key_check') as unknown[];
      if (broken.length) throw new Error(`Foreign key check failed for ${broken.length} row(s)`);

      /* Same table and columns the Drizzle migrator uses. */
      db.exec(`CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)`);
      db.prepare(`INSERT INTO "__drizzle_migrations" ("hash", "created_at") VALUES (?, ?)`).run(baseline.hash, baseline.folderMillis);
    })();
  } finally {
    db.pragma('foreign_keys = ON');
  }

  console.log(`[DB] Converted legacy database to the Drizzle schema: ${present.map((t) => `${t}=${before[t]}`).join(', ')}`);
}
