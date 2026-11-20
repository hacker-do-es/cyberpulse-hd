import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { convertLegacyDatabase, isLegacyDatabase } from './legacy';
import * as schema from './schema';

export type Db = BetterSQLite3Database<typeof schema>;

const MIGRATIONS_DIR = fileURLToPath(new URL('./migrations', import.meta.url));

function dataDir(): string {
  /* /app/data in Docker, the working directory locally. */
  return process.env.CYBERPULSE_DATA_DIR
    || (process.env.NODE_ENV === 'production' ? '/app/data' : process.cwd());
}

let sqlite: Database.Database | null = null;
let db: Db | null = null;

/* Opens the database once, applies pending migrations and returns the ORM
   handle. better-sqlite3 is synchronous: queries are fast local reads/writes
   with no network wait, so there is nothing to await. Long-running work is
   kept off the request path instead (see services/stackNews.ts). */
export function getDb(): Db {
  if (db) return db;
  const dir = dataDir();
  fs.mkdirSync(dir, { recursive: true });

  const file = path.resolve(dir, 'cyberpulse.db');
  sqlite = new Database(file);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');

  /* Databases created before Drizzle are converted once (with a backup). */
  if (isLegacyDatabase(sqlite)) convertLegacyDatabase(sqlite, file, MIGRATIONS_DIR);

  db = drizzle(sqlite, { schema });
  runMigrations(sqlite, db, file);
  return db;
}

/* Pending migrations run with foreign keys OFF: SQLite ignores
   `PRAGMA foreign_keys` inside a transaction, and a table rebuild
   (create new → copy → DROP old → rename) would otherwise make the DROP
   cascade into every child table (e.g. channels → deliveries). Integrity is
   checked before foreign keys go back on, and a copy of the database is
   taken first so a failed upgrade can be undone. */
function runMigrations(conn: Database.Database, orm: Db, file: string): void {
  const files = readMigrationFiles({ migrationsFolder: MIGRATIONS_DIR });
  const hasJournal = conn.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'`).get();
  const applied = hasJournal ? (conn.prepare(`SELECT COUNT(*) AS n FROM "__drizzle_migrations"`).get() as { n: number }).n : 0;
  if (applied >= files.length) return;

  if (applied > 0 && fs.existsSync(file)) {
    const backup = file.replace(/\.db$/, `.pre-migration-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
    conn.prepare('VACUUM INTO ?').run(backup);
    console.log(`[DB] Backup before migrating: ${path.basename(backup)}`);
  }

  conn.pragma('foreign_keys = OFF');
  try {
    migrate(orm, { migrationsFolder: MIGRATIONS_DIR });
    const broken = conn.pragma('foreign_key_check') as unknown[];
    if (broken.length) throw new Error(`Foreign key check failed after migrating (${broken.length} rows)`);
  } finally {
    conn.pragma('foreign_keys = ON');
  }
  console.log(`[DB] Applied ${files.length - applied} migration(s)`);
}

/* Raw driver handle, for the few places that need it (tests, maintenance). */
export function getSqlite(): Database.Database {
  getDb();
  return sqlite!;
}

export function closeDb(): void {
  sqlite?.close();
  sqlite = null;
  db = null;
}

export { schema };
