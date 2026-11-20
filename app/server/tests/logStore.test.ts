import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-logs-'));
process.env.CYBERPULSE_DATA_DIR = dataDir;

describe('logStore', () => {
  let mod: typeof import('../services/logs/logStore');
  let getSqlite: typeof import('../db/client').getSqlite;
  beforeAll(async () => {
    mod = await import('../services/logs/logStore');
    ({ getSqlite } = await import('../db/client'));
    getSqlite();
  });
  afterAll(() => {
    mod.resetLogStore();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('redacts secrets', () => {
    const r = mod.redact;
    expect(r('Authorization: Bearer abcdef1234567890')).not.toContain('abcdef1234567890');
    expect(r('password=hunter2hunter2 user=bob')).toBe('password=[REDACTED] user=bob');
    expect(r('{"apiKey":"sk-ant-api03-AAAAAAAAAAAAAAAAAAAA"}')).not.toContain('AAAAAAAAAAAAAAAA');
    expect(r('posting to https://hooks.slack.com/services/T1/B2/XYZ')).toBe('posting to https://hooks.slack.com/services/[REDACTED]');
    expect(r('smtp://user:pa55word@smtp.example.com')).toBe('smtp://user:[REDACTED]@smtp.example.com');
    expect(r('[SCRAPER] UK NCSC: 0 new / 10 found')).toBe('[SCRAPER] UK NCSC: 0 new / 10 found');
  });

  it('parses the [TAG] of a line', () => {
    expect(mod.parseLine('[DIGEST] sent 3')).toEqual({ source: 'DIGEST', message: 'sent 3' });
    expect(mod.parseLine('plain line')).toEqual({ source: 'APP', message: 'plain line' });
  });

  it('captures console lines, stores them in batches and prunes old rows', () => {
    mod.installConsoleCapture();
    console.log('[UNIT] before the store is ready');
    expect(mod.flushLogs()).toBe(0);
    mod.startLogStore();
    console.warn('[UNIT] careful token=abcdef123456');
    console.error(new Error('boom'));
    mod.audit({ action: 'unit.test', detail: 'ok', userId: 7, username: 'u', tenantId: 3, ip: '203.0.113.9' });
    mod.flushLogs();
    const rows = getSqlite().prepare('SELECT level, source, kind, message, ip FROM app_logs ORDER BY id').all() as any[];
    expect(rows.find((x) => x.message === 'before the store is ready')).toMatchObject({ level: 'info', source: 'UNIT' });
    expect(rows.find((x) => x.message.startsWith('careful'))).toMatchObject({ level: 'warn', message: 'careful token=[REDACTED]' });
    expect(rows.find((x) => x.level === 'error' && x.message.includes('boom'))).toBeTruthy();
    expect(rows.find((x) => x.kind === 'audit')).toMatchObject({ source: 'AUDIT', message: 'unit.test ok', ip: '203.0.113.9' });

    /* Retention: anything older than 14 days goes. */
    getSqlite().prepare("INSERT INTO app_logs (ts, level, source, kind, message) VALUES ('2020-01-01T00:00:00.000Z','info','OLD','app','old')").run();
    expect(mod.pruneLogs()).toBeGreaterThanOrEqual(1);
    expect(getSqlite().prepare("SELECT COUNT(*) n FROM app_logs WHERE source='OLD'").get()).toEqual({ n: 0 });
  });
});
