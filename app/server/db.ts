import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

// Use /app/data in Docker, fallback to cwd locally
const DATA_DIR = process.env.CYBERPULSE_DATA_DIR
  || (process.env.NODE_ENV === 'production' ? '/app/data' : process.cwd());

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.resolve(DATA_DIR, 'cyberpulse.db');
let db: Database.Database | null = null;

export const CURRENT_SCHEMA_VERSION = 10;

export function getDb(): Database.Database {
  if (db) return db;

  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS articles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      summary TEXT,
      source TEXT NOT NULL,
      severity TEXT DEFAULT 'medium',
      category TEXT DEFAULT 'GENERAL',
      published_at TEXT,
      publish_date TEXT,
      read_time TEXT,
      url TEXT NOT NULL UNIQUE,
      fetched_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      rss_url TEXT NOT NULL,
      category TEXT DEFAULT 'GENERAL',
      active INTEGER DEFAULT 1,
      article_count INTEGER DEFAULT 0,
      last_fetch DATETIME,
      custom INTEGER DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_articles_source ON articles(source);
    CREATE INDEX IF NOT EXISTS idx_articles_fetched ON articles(fetched_at);
    CREATE INDEX IF NOT EXISTS idx_articles_published ON articles(published_at);
    CREATE INDEX IF NOT EXISTS idx_articles_severity ON articles(severity);

    CREATE TABLE IF NOT EXISTS fetch_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT,
      articles_found INTEGER DEFAULT 0,
      articles_new INTEGER DEFAULT 0,
      error TEXT,
      fetched_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS schema_metadata (
      key TEXT PRIMARY KEY,
      value INTEGER
    );

    CREATE TABLE IF NOT EXISTS linkedin_config (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id TEXT NOT NULL,
      client_secret TEXT NOT NULL,
      redirect_uri TEXT DEFAULT 'http://localhost:3001/api/linkedin/callback',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS linkedin_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      person_id TEXT,
      person_urn TEXT,
      access_token TEXT NOT NULL,
      expires_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS linkedin_oauth_states (
      state TEXT PRIMARY KEY,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS user_tech_stack (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      technology TEXT NOT NULL,
      version TEXT,
      vendor TEXT,
      category TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_tech_stack ON user_tech_stack(technology, version);
  `);

  /* One-time migrations */
  const versionRow = db.prepare(`SELECT value FROM schema_metadata WHERE key = 'version'`).get() as { value: number } | undefined;
  const currentVersion = versionRow?.value || 0;

  if (currentVersion < 4) {
    /* v4: expanded RSS source list and normalized timestamps. Clear old
       articles so the next scrape populates fresh data from all sources. */
    db.exec(`DELETE FROM articles`);
    db.prepare(`INSERT OR REPLACE INTO schema_metadata (key, value) VALUES ('version', ?)`).run(4);
    console.log('[DB] Migrated to schema v4: cleared articles for fresh re-scrape');
  }

  if (currentVersion < 5) {
    /* v5: add custom flag to sources table */
    const columnInfo = db.prepare(`PRAGMA table_info(sources)`).all() as Array<{ name: string }>;
    const hasCustom = columnInfo.some((col) => col.name === 'custom');
    if (!hasCustom) {
      db.exec(`ALTER TABLE sources ADD COLUMN custom INTEGER DEFAULT 0`);
    }
    db.prepare(`UPDATE sources SET custom = 0 WHERE custom IS NULL`).run();
    db.prepare(`INSERT OR REPLACE INTO schema_metadata (key, value) VALUES ('version', ?)`).run(5);
    console.log('[DB] Migrated to schema v5: added custom column to sources');
  }

  if (currentVersion < 6) {
    /* v6: add LinkedIn config and token tables */
    db.exec(`
      CREATE TABLE IF NOT EXISTS linkedin_config (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id TEXT NOT NULL,
        client_secret TEXT NOT NULL,
        redirect_uri TEXT DEFAULT 'http://localhost:3001/api/linkedin/callback',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS linkedin_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        person_id TEXT,
        person_urn TEXT,
        access_token TEXT NOT NULL,
        expires_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS linkedin_oauth_states (
        state TEXT PRIMARY KEY,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
    db.prepare(`INSERT OR REPLACE INTO schema_metadata (key, value) VALUES ('version', ?)`).run(6);
    console.log('[DB] Migrated to schema v6: added LinkedIn tables');
  }

  if (currentVersion < 7) {
    /* v7: 16 built-in feeds were verified dead on 2026-10-26 (bot protection,
       removed endpoints, a hostname whose TLS cert belongs to someone else).
       seedSources() refreshes URLs but deliberately never flips `active`, so
       existing databases need this one-time pass to stop paying a request —
       and in the timeout cases, 15 s — for them on every scrape. */
    const deadSources = [
      'ASD ACSC Alerts', 'Appsecco', 'CCN-CERT', 'Cyber Kendra', 'CyberNews',
      'ENISA', 'FBI Cyber', 'Fortinet Blog', 'Google TAG', 'Mandiant',
      'NSA Cybersecurity', 'OSI', 'Packet Storm', 'Security Boulevard',
      'VulDB', 'tttang',
    ];
    const deactivate = db.prepare(`UPDATE sources SET active = 0 WHERE name = ? AND custom = 0`);
    let disabled = 0;
    const runV7 = db.transaction(() => {
      for (const name of deadSources) {
        disabled += deactivate.run(name).changes;
      }
    });
    runV7();
    db.prepare(`INSERT OR REPLACE INTO schema_metadata (key, value) VALUES ('version', ?)`).run(7);
    console.log(`[DB] Migrated to schema v7: deactivated ${disabled} unreachable feeds`);
  }

  if (currentVersion < 8) {
    /* v8: add user_tech_stack table for personalized news filtering based on
       user's technology stack. Allows users to configure their infrastructure
       (e.g., PHP 7.4, Apache 2.4) and receive only relevant security news. */
    db.exec(`
      CREATE TABLE IF NOT EXISTS user_tech_stack (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        technology TEXT NOT NULL,
        version TEXT,
        vendor TEXT,
        category TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_tech_stack ON user_tech_stack(technology, version);
    `);
    db.prepare(`INSERT OR REPLACE INTO schema_metadata (key, value) VALUES ('version', ?)`).run(8);
    console.log('[DB] Migrated to schema v8: added user_tech_stack table');
  }

  if (currentVersion < 9) {
    /* v9 (Hacker-Do): multitenancy. Companies (tenants) own their tech stack,
       AI provider, output channels and schedules; users log in with a
       password (+ optional TOTP). News and RSS sources stay shared. */
    db.exec(`
      CREATE TABLE IF NOT EXISTS tenants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE COLLATE NOCASE,
        timezone TEXT NOT NULL DEFAULT 'Europe/Madrid',
        language TEXT NOT NULL DEFAULT 'es',
        ai_provider TEXT NOT NULL DEFAULT 'none' CHECK (ai_provider IN ('none', 'anthropic', 'openai')),
        ai_model TEXT,
        ai_key TEXT,
        ai_base_url TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
        username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        display_name TEXT,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('superadmin', 'admin', 'member')),
        totp_secret TEXT,
        totp_enabled INTEGER NOT NULL DEFAULT 0,
        totp_last_step INTEGER,
        active INTEGER NOT NULL DEFAULT 1,
        failed_logins INTEGER NOT NULL DEFAULT 0,
        locked_until DATETIME,
        last_login_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        CHECK ((role = 'superadmin' AND tenant_id IS NULL) OR (role <> 'superadmin' AND tenant_id IS NOT NULL))
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        active_tenant_id INTEGER REFERENCES tenants(id) ON DELETE SET NULL,
        expires_at DATETIME NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

      CREATE TABLE IF NOT EXISTS channels (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('slack', 'rocketchat')),
        webhook_url TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        schedule_type TEXT NOT NULL DEFAULT 'weekly' CHECK (schedule_type IN ('interval', 'weekly')),
        interval_hours INTEGER,
        time_of_day TEXT,
        weekdays TEXT,
        min_severity TEXT NOT NULL DEFAULT 'medium',
        max_items INTEGER NOT NULL DEFAULT 15,
        use_ai INTEGER NOT NULL DEFAULT 1,
        last_run_at DATETIME,
        last_sent_at DATETIME,
        next_run_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_channels_tenant ON channels(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_channels_next_run ON channels(next_run_at);

      CREATE TABLE IF NOT EXISTS deliveries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        trigger TEXT NOT NULL DEFAULT 'schedule',
        status TEXT NOT NULL CHECK (status IN ('sent', 'skipped', 'error')),
        article_count INTEGER NOT NULL DEFAULT 0,
        detail TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_deliveries_channel ON deliveries(channel_id, created_at);

      CREATE TABLE IF NOT EXISTS channel_sent_articles (
        channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
        article_id INTEGER NOT NULL,
        sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (channel_id, article_id)
      );
    `);

    const stackCols = db.prepare(`PRAGMA table_info(user_tech_stack)`).all() as Array<{ name: string }>;
    if (!stackCols.some((c) => c.name === 'tenant_id')) {
      db.exec(`ALTER TABLE user_tech_stack ADD COLUMN tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE`);
    }
    db.exec(`CREATE INDEX IF NOT EXISTS idx_tech_stack_tenant ON user_tech_stack(tenant_id)`);

    /* A pre-existing single-tenant stack is not thrown away: it moves into a
       "Default" company that the superadmin can rename. */
    const orphan = db.prepare(`SELECT COUNT(*) AS c FROM user_tech_stack WHERE tenant_id IS NULL`).get() as { c: number };
    if (orphan.c > 0) {
      const t = db.prepare(`INSERT OR IGNORE INTO tenants (name) VALUES ('Default')`).run();
      const tenantId = t.changes > 0
        ? Number(t.lastInsertRowid)
        : (db.prepare(`SELECT id FROM tenants WHERE name = 'Default'`).get() as { id: number }).id;
      db.prepare(`UPDATE user_tech_stack SET tenant_id = ? WHERE tenant_id IS NULL`).run(tenantId);
    }

    db.prepare(`INSERT OR REPLACE INTO schema_metadata (key, value) VALUES ('version', ?)`).run(9);
    console.log('[DB] Migrated to schema v9: multitenancy (tenants, users, channels)');
  }

  if (currentVersion < 10) {
    /* v10: per-channel message header and footer (NULL = default text,
       empty footer = no footer), so a company's digest can carry its own
       branding instead of Hacker-Do's. */
    const cols = db.prepare(`PRAGMA table_info(channels)`).all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === 'header_text')) db.exec(`ALTER TABLE channels ADD COLUMN header_text TEXT`);
    if (!cols.some((c) => c.name === 'footer_text')) db.exec(`ALTER TABLE channels ADD COLUMN footer_text TEXT`);
    db.prepare(`INSERT OR REPLACE INTO schema_metadata (key, value) VALUES ('version', ?)`).run(10);
    console.log('[DB] Migrated to schema v10: channel header/footer');
  }

  return db;
}

export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}
