import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import type { AddressInfo } from 'net';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

/* A database written by the pre-Drizzle server (schema v10, generated with
   that code: fixtures/legacy-v10.sql) must convert in place on first start,
   keep every row, and keep working: logins with 2FA, encrypted webhook URLs
   and AI keys, existing sessions. */

const FIXTURE = fs.readFileSync(path.join(__dirname, 'fixtures/legacy-v10.sql'), 'utf8');
const MIGRATIONS = path.join(__dirname, '../db/migrations');
/* TOTP seed of user "Alice" in the fixture. */
const ALICE_TOTP = 'YAZSUBHFWWXLM3FN6JKIA7RRDJO2EZH6';
const PW = 'legacy-password-1';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-legacy-'));
fs.mkdirSync(dataDir, { recursive: true });
const legacy = new Database(path.join(dataDir, 'cyberpulse.db'));
legacy.exec(FIXTURE);
legacy.close();

process.env.CYBERPULSE_DATA_DIR = dataDir;
process.env.CYBERPULSE_SECRET = 'a'.repeat(64);
process.env.CYBERPULSE_RATE_LOGIN = '1000';

let base = '';
let server: http.Server;

function schemaOf(db: Database.Database) {
  return db.prepare(
    `SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name <> '__drizzle_migrations' ORDER BY type, name`
  ).all();
}

beforeAll(async () => {
  const { app } = await import('../index');
  const { getSqlite } = await import('../db/client');
  getSqlite();
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
  const { closeDb } = await import('../db/client');
  closeDb();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('legacy database conversion', () => {
  it('ends with exactly the schema a fresh install gets, and a backup of the old file', async () => {
    const { getSqlite } = await import('../db/client');
    const fresh = new Database(':memory:');
    migrate(drizzle(fresh), { migrationsFolder: MIGRATIONS });
    expect(schemaOf(getSqlite())).toEqual(schemaOf(fresh));
    expect(getSqlite().prepare(`SELECT COUNT(*) AS n FROM __drizzle_migrations`).get())
      .toEqual({ n: JSON.parse(fs.readFileSync(path.join(MIGRATIONS, 'meta/_journal.json'), 'utf8')).entries.length });
    expect(fs.readdirSync(dataDir).some((f) => /^cyberpulse\.pre-drizzle-.*\.db$/.test(f))).toBe(true);
  });

  it('keeps every row and normalises legacy NULLs', async () => {
    const { getSqlite } = await import('../db/client');
    const db = getSqlite();
    const n = (t: string) => (db.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get() as { n: number }).n;
    expect({
      tenants: n('tenants'), users: n('users'), sessions: n('sessions'), stack: n('user_tech_stack'),
      articles: n('articles'), channels: n('channels'), deliveries: n('deliveries'), sent: n('channel_sent_articles'), log: n('fetch_log'),
    }).toEqual({ tenants: 2, users: 3, sessions: 1, stack: 3, articles: 5, channels: 1, deliveries: 1, sent: 2, log: 1 });
    expect(n('sources')).toBeGreaterThan(100);
    expect(db.prepare(`SELECT custom, article_count FROM sources WHERE name = 'CERT-EU'`).get()).toEqual({ custom: 0, article_count: 0 });
    expect(db.prepare(`SELECT name FROM sqlite_master WHERE (name LIKE 'linkedin%' AND name NOT IN ('linkedin_accounts', 'linkedin_posts')) OR name = 'schema_metadata' OR name LIKE '__legacy_%'`).all()).toEqual([]);
    expect(db.prepare(`SELECT failed_logins FROM users WHERE username = 'bob'`).get()).toEqual({ failed_logins: 2 });
  });

  it('keeps logins (case-insensitive, with 2FA), decrypts stored secrets and keeps working', async () => {
    const { totpCode } = await import('../services/auth/totp');
    let cookie = '';
    const req = async (method: string, url: string, body?: unknown) => {
      const res = await fetch(base + url, {
        method,
        headers: { 'content-type': 'application/json', 'x-requested-with': 'cyberpulse', ...(cookie ? { cookie } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const sc = res.headers.get('set-cookie');
      if (sc) cookie = sc.split(';')[0];
      return { status: res.status, body: await res.json().catch(() => null) };
    };

    const login = await req('POST', '/api/auth/login', { username: 'alice', password: PW, totp: totpCode(ALICE_TOTP, Math.floor(Date.now() / 30000)) });
    expect(login.status).toBe(200);
    expect((await req('GET', '/api/tech-stack')).body.stack.map((s: { technology: string }) => s.technology)).toEqual(['FortiOS', 'PHP', 'WordPress']);

    const channels = (await req('GET', '/api/channels')).body.channels;
    expect(channels[0]).toMatchObject({ name: '#soc', webhookHint: 'hooks.slack.com/…gacy', header: 'Acme · {count}', footer: '', active: true });
    expect(channels[0].schedule).toEqual({ type: 'weekly', intervalHours: null, timeOfDay: '08:30', weekdays: [1, 2, 3, 4, 5] });
    expect((await req('GET', '/api/channels/1/deliveries')).body.deliveries).toHaveLength(1);

    const settings = (await req('GET', '/api/tenant/settings')).body;
    expect(settings).toMatchObject({ name: 'Acme', language: 'es', timezone: 'Europe/Madrid' });
    expect(settings.ai).toMatchObject({ provider: 'anthropic', keySet: true, keyHint: 'sk-a••••-key' });

    /* Writes work, and the unique-name rule still ignores case. */
    expect((await req('POST', '/api/tech-stack', { technology: 'Exchange' })).status).toBe(201);
    expect((await req('POST', '/api/users', { username: 'BOB', password: PW, role: 'member' })).status).toBe(409);
  });

  it('does not convert twice', async () => {
    const { closeDb, getSqlite } = await import('../db/client');
    closeDb();
    getSqlite();
    expect(fs.readdirSync(dataDir).filter((f) => f.startsWith('cyberpulse.pre-drizzle-'))).toHaveLength(1);
  });
});

describe('legacy conversion failure', () => {
  it('rolls back completely and leaves the old database untouched', async () => {
    const { convertLegacyDatabase, isLegacyDatabase } = await import('../db/legacy');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-legacy-bad-'));
    const file = path.join(dir, 'cyberpulse.db');
    const db = new Database(file);
    db.exec(FIXTURE);
    /* A stack row without a company cannot exist in the new schema. */
    db.exec(`INSERT INTO user_tech_stack (technology, tenant_id) VALUES ('Orphan', NULL)`);
    const before = schemaOf(db);

    expect(() => convertLegacyDatabase(db, file, MIGRATIONS)).toThrow();
    expect(schemaOf(db)).toEqual(before);
    expect(isLegacyDatabase(db)).toBe(true);
    expect(db.prepare(`SELECT COUNT(*) AS n FROM user_tech_stack`).get()).toEqual({ n: 4 });
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
