import { describe, it, expect, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

/* Upgrading a live database (baseline 0000 with data) to the latest schema
   must keep every row. 0001 rebuilds `channels`; with foreign keys on, that
   DROP would cascade into deliveries and channel_sent_articles, and every
   article would be sent again. */

const MIGRATIONS = path.join(__dirname, '../db/migrations');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-migr-'));

/* A folder with only the baseline, to build a "previous version" database. */
const baselineDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-migr-base-'));
fs.mkdirSync(path.join(baselineDir, 'meta'));
fs.copyFileSync(path.join(MIGRATIONS, '0000_init.sql'), path.join(baselineDir, '0000_init.sql'));
const journal = JSON.parse(fs.readFileSync(path.join(MIGRATIONS, 'meta/_journal.json'), 'utf8'));
journal.entries = journal.entries.filter((e: { idx: number }) => e.idx === 0);
fs.writeFileSync(path.join(baselineDir, 'meta/_journal.json'), JSON.stringify(journal));

const file = path.join(dataDir, 'cyberpulse.db');
const old = new Database(file);
old.pragma('foreign_keys = ON');
migrate(drizzle(old), { migrationsFolder: baselineDir });
old.exec(`
  INSERT INTO tenants (id, name) VALUES (1, 'Acme');
  INSERT INTO articles (id, title, source, url) VALUES (1, 'a', 's', 'https://x/1'), (2, 'b', 's', 'https://x/2');
  INSERT INTO channels (id, tenant_id, name, type, webhook_url, schedule_type, interval_hours, header_text, footer_text, last_sent_at, next_run_at)
    VALUES (7, 1, 'SOC', 'slack', 'enc:xyz', 'interval', 6, 'H {company}', '', '2026-11-19 11:30:00', '2026-11-20 11:30:00');
  INSERT INTO deliveries (channel_id, tenant_id, status, article_count, detail) VALUES (7, 1, 'sent', 2, 'ok'), (7, 1, 'skipped', 0, 'none');
  INSERT INTO channel_sent_articles (channel_id, article_id) VALUES (7, 1), (7, 2);
`);
old.close();

process.env.CYBERPULSE_DATA_DIR = dataDir;
process.env.CYBERPULSE_SECRET = 'a'.repeat(64);

afterAll(async () => {
  const { closeDb } = await import('../db/client');
  closeDb();
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.rmSync(baselineDir, { recursive: true, force: true });
});

describe('schema upgrade on an existing database', () => {
  it('adds email channels without losing deliveries or sent-article history', async () => {
    const { getSqlite } = await import('../db/client');
    const db = getSqlite();

    expect((db.prepare('SELECT COUNT(*) AS n FROM "__drizzle_migrations"').get() as { n: number }).n)
      .toBe(JSON.parse(fs.readFileSync(path.join(MIGRATIONS, 'meta/_journal.json'), 'utf8')).entries.length);
    expect((db.prepare('SELECT COUNT(*) AS n FROM deliveries').get() as { n: number }).n).toBe(2);
    expect((db.prepare('SELECT COUNT(*) AS n FROM channel_sent_articles').get() as { n: number }).n).toBe(2);

    const ch = db.prepare('SELECT * FROM channels WHERE id = 7').get() as Record<string, unknown>;
    expect(ch).toMatchObject({
      name: 'SOC', type: 'slack', webhook_url: 'enc:xyz', header_text: 'H {company}', footer_text: '',
      last_sent_at: '2026-11-19 11:30:00', next_run_at: '2026-11-20 11:30:00', header_html: null, footer_html: null,
    });

    /* New type accepted, unknown types still rejected. */
    db.prepare(`INSERT INTO channels (tenant_id, name, type, webhook_url) VALUES (1, 'Mail', 'email', 'enc:abc')`).run();
    expect(() => db.prepare(`INSERT INTO channels (tenant_id, name, type, webhook_url) VALUES (1, 'X', 'fax', 'x')`).run()).toThrow();

    /* Foreign keys are back on: deleting a channel still cascades. */
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
    db.prepare('DELETE FROM channels WHERE id = 7').run();
    expect((db.prepare('SELECT COUNT(*) AS n FROM deliveries').get() as { n: number }).n).toBe(0);

    /* A copy of the pre-upgrade database was kept. */
    expect(fs.readdirSync(dataDir).some((f) => /^cyberpulse\.pre-migration-.*\.db$/.test(f))).toBe(true);
  });
});
