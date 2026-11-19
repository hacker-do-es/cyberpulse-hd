import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
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
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return db;
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
