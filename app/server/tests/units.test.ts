import { describe, it, expect } from 'vitest';
import { parseStackCsv, toStackCsv } from '../services/csv';
import { computeNextRun, validateSchedule, zonedTimeToUtc } from '../services/schedule';
import { hashPassword, verifyPassword } from '../services/auth/password';
import { base32Decode, base32Encode, totpCode, verifyTotp } from '../services/auth/totp';
import { isPublicAddress, renderMessage, validateWebhookUrl } from '../services/webhooks';

describe('stack CSV', () => {
  it('parses a headed comma file', () => {
    const r = parseStackCsv('technology,version,vendor,category\nWordPress,6.4,Automattic,CMS\nPHP,8.2,,Runtime\n');
    expect(r.errors).toEqual([]);
    expect(r.rows).toEqual([
      { technology: 'WordPress', version: '6.4', vendor: 'Automattic', category: 'CMS' },
      { technology: 'PHP', version: '8.2', category: 'Runtime' },
    ]);
  });

  it('handles Excel es-ES: BOM, semicolons, Spanish headers in any order, CRLF', () => {
    const r = parseStackCsv('\uFEFFCategoría;Tecnología;Versión\r\nFirewall;FortiOS;7.2\r\n');
    expect(r.rows).toEqual([{ technology: 'FortiOS', version: '7.2', category: 'Firewall' }]);
  });

  it('accepts headerless files positionally and quoted fields', () => {
    const r = parseStackCsv('"Exchange Server, 2019",2019,Microsoft\n"He said ""hi""",1\n');
    expect(r.rows[0]).toEqual({ technology: 'Exchange Server, 2019', version: '2019', vendor: 'Microsoft' });
    expect(r.rows[1].technology).toBe('He said "hi"');
  });

  it('reports missing technology with its line and drops duplicates', () => {
    const r = parseStackCsv('technology,version\nNginx,1.24\n,1.0\nnginx,1.24\n');
    expect(r.rows).toHaveLength(1);
    expect(r.duplicates).toBe(1);
    expect(r.errors).toEqual([{ line: 3, message: 'Missing technology' }]);
  });

  it('rejects a header without a technology column', () => {
    const r = parseStackCsv('version,vendor\n1,2\n');
    expect(r.rows).toHaveLength(0);
    expect(r.errors[0].message).toMatch(/technology/);
  });

  it('neutralises spreadsheet formulas on export', () => {
    const csv = toStackCsv([{ technology: '=HYPERLINK("http://x")', version: '+1', vendor: null, category: 'a,b' }]);
    expect(csv).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(csv).toContain("'+1");
    expect(csv).toContain('"a,b"');
  });
});

describe('schedules', () => {
  const tz = 'Europe/Madrid';

  it('validates', () => {
    expect(validateSchedule({ type: 'interval', intervalHours: 0 })).toBeTruthy();
    expect(validateSchedule({ type: 'interval', intervalHours: 6 })).toBeNull();
    expect(validateSchedule({ type: 'weekly', timeOfDay: '25:00', weekdays: [1] })).toBeTruthy();
    expect(validateSchedule({ type: 'weekly', timeOfDay: '08:30', weekdays: [] })).toBeTruthy();
    expect(validateSchedule({ type: 'weekly', timeOfDay: '08:30', weekdays: [1, 3] })).toBeNull();
  });

  it('converts Madrid wall time in winter (UTC+1) and summer (UTC+2)', () => {
    expect(zonedTimeToUtc(2026, 1, 15, 9, 0, tz).toISOString()).toBe('2026-01-15T08:00:00.000Z');
    expect(zonedTimeToUtc(2026, 7, 15, 9, 0, tz).toISOString()).toBe('2026-07-15T07:00:00.000Z');
  });

  it('runs daily at 09:00 Madrid, later today or tomorrow', () => {
    const daily = { type: 'weekly' as const, timeOfDay: '09:00', weekdays: [0, 1, 2, 3, 4, 5, 6] };
    expect(computeNextRun(daily, new Date('2026-11-19T07:00:00Z'), tz).toISOString()).toBe('2026-11-19T08:00:00.000Z');
    expect(computeNextRun(daily, new Date('2026-11-19T08:00:00Z'), tz).toISOString()).toBe('2026-11-20T08:00:00.000Z');
  });

  it('runs weekly on Monday only (2026-11-19 is a Thursday)', () => {
    const monday = { type: 'weekly' as const, timeOfDay: '08:30', weekdays: [1] };
    expect(computeNextRun(monday, new Date('2026-11-19T12:00:00Z'), tz).toISOString()).toBe('2026-11-23T07:30:00.000Z');
  });

  it('crosses the DST change correctly (Madrid springs forward 2026-03-29)', () => {
    const daily = { type: 'weekly' as const, timeOfDay: '09:00', weekdays: [0, 1, 2, 3, 4, 5, 6] };
    expect(computeNextRun(daily, new Date('2026-03-28T09:00:00Z'), tz).toISOString()).toBe('2026-03-29T07:00:00.000Z');
  });

  it('adds intervals', () => {
    expect(computeNextRun({ type: 'interval', intervalHours: 6 }, new Date('2026-11-19T00:00:00Z'), tz).toISOString())
      .toBe('2026-11-19T06:00:00.000Z');
  });
});

describe('passwords and TOTP', () => {
  it('hashes with scrypt and verifies', async () => {
    const h = await hashPassword('correct horse battery');
    expect(h.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('correct horse battery', h)).toBe(true);
    expect(await verifyPassword('wrong horse battery', h)).toBe(false);
    expect(await hashPassword('correct horse battery')).not.toBe(h);
  });

  it('hashes off the event loop thread', async () => {
    /* A timer due in 5 ms must fire while the ~90 ms hash is still running. */
    let firedDuringHash = false;
    let hashing = true;
    setTimeout(() => { firedDuringHash = hashing; }, 5);
    await hashPassword('correct horse battery');
    hashing = false;
    expect(firedDuringHash).toBe(true);
  });

  it('round-trips base32', () => {
    const buf = Buffer.from('12345678901234567890');
    expect(base32Encode(buf)).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(base32Decode('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ').equals(buf)).toBe(true);
  });

  it('matches the RFC 6238 SHA-1 test vectors (6-digit truncation)', () => {
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    expect(totpCode(secret, Math.floor(59 / 30))).toBe('287082');
    expect(totpCode(secret, Math.floor(1111111109 / 30))).toBe('081804');
    expect(totpCode(secret, Math.floor(20000000000 / 30))).toBe('353130');
  });

  it('accepts one step of clock drift, not more', () => {
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    const now = 1111111109_000;
    const step = Math.floor(now / 30000);
    expect(verifyTotp(secret, totpCode(secret, step - 1), now)).toBe(step - 1);
    expect(verifyTotp(secret, totpCode(secret, step - 2), now)).toBeNull();
    expect(verifyTotp(secret, 'abcdef', now)).toBeNull();
  });
});

describe('webhooks', () => {
  it('only accepts real Slack and Rocket.Chat webhook URLs', () => {
    expect('url' in validateWebhookUrl('slack', 'https://hooks.slack.com/services/T0/B0/xyz')).toBe(true);
    expect('error' in validateWebhookUrl('slack', 'https://evil.example/services/x')).toBe(true);
    expect('error' in validateWebhookUrl('slack', 'http://hooks.slack.com/services/x')).toBe(true);
    expect('url' in validateWebhookUrl('rocketchat', 'https://chat.example.com/hooks/abc/def')).toBe(true);
    expect('error' in validateWebhookUrl('rocketchat', 'https://chat.example.com/api/v1/x')).toBe(true);
    expect('error' in validateWebhookUrl('rocketchat', 'https://user:pw@chat.example.com/hooks/a')).toBe(true);
  });

  it('classifies non-public addresses', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.0.2', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:192.168.1.1']) {
      expect(isPublicAddress(ip)).toBe(false);
    }
    for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) {
      expect(isPublicAddress(ip)).toBe(true);
    }
  });

  it('refuses IPv6 forms that embed a private IPv4 address and other special ranges', () => {
    for (const ip of [
      '64:ff9b::a00:1',        // NAT64 -> 10.0.0.1
      '2002:a00:1::',          // 6to4 -> 10.0.0.1
      '2001:db8::1',           // documentation
      '198.18.0.1',            // benchmarking
      '192.0.2.1',             // documentation (TEST-NET-1)
      '255.255.255.255',       // broadcast
      '224.0.0.1',             // multicast
      '::ffff:127.0.0.1',      // IPv4-mapped loopback
      'not-an-ip', '',
    ]) {
      expect(isPublicAddress(ip)).toBe(false);
    }
    expect(isPublicAddress('::ffff:8.8.8.8')).toBe(true);
  });

  it('escapes feed text in Slack messages so titles cannot inject links or mentions', () => {
    const { text } = renderMessage('slack', {
      heading: 'H',
      items: [{ title: '<!channel> pwn|ed', url: 'javascript:alert(1)', source: 'S', severity: 'critical', matchedTech: ['PHP'] }],
      footer: 'F',
      labels: { severity: { critical: 'CRITICAL' }, affects: 'affects' },
    });
    expect(text).not.toContain('<!channel>');
    expect(text).toContain('&lt;!channel&gt;');
    expect(text).not.toContain('javascript:');
  });

  it('escapes markdown in Rocket.Chat messages', () => {
    const { text } = renderMessage('rocketchat', {
      heading: 'H',
      items: [{ title: 'evil](https://phish.example) [x', url: 'https://ok.example/a', source: 'S', severity: 'high', matchedTech: [] }],
      footer: 'F',
      labels: { severity: { high: 'HIGH' }, affects: 'affects' },
    });
    expect(text).toContain('[evil\\]\\(https://phish.example\\) \\[x](https://ok.example/a)');
  });
});
