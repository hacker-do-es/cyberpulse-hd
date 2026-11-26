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

describe('stack CSV assets column', () => {
  it('splits asset names and merges duplicated rows', async () => {
    const { parseStackCsv, splitAssetNames, toStackCsv } = await import('../services/csv');
    expect(splitAssetNames(' WEB01 | web01; DB01 ,, ')).toEqual(['WEB01', 'DB01']);
    const r = parseStackCsv('Tecnología;Versión;Activos\nPHP;8.2;"WEB01|WEB02"\nphp;8.2;DB01\nRedis;7;\n');
    expect(r.rows).toEqual([
      { technology: 'PHP', version: '8.2', assets: ['WEB01', 'WEB02', 'DB01'] },
      { technology: 'Redis', version: '7' },
    ]);
    expect(r.duplicates).toBe(1);
    /* Without a header the fifth column is assets. */
    expect(parseStackCsv('Nginx,1.24,F5,Web,LB01|LB02\n').rows[0].assets).toEqual(['LB01', 'LB02']);
    expect(parseStackCsv(`X,1,,,${'A'.repeat(101)}\n`).errors[0].message).toMatch(/asset name/);
    expect(toStackCsv([{ technology: 'PHP', version: '8.2', assets: ['WEB01', '=cmd'] }]))
      .toBe('technology,version,vendor,category,assets\nPHP,8.2,,,WEB01|=cmd\n');
  });
});

describe('CSV re-saved by a ";" locale Excel', () => {
  /* What Spanish Excel writes after opening a comma CSV whose cells contain ";". */
  const mangled =
    'name,type,criticality,environment,hostname,ip,brand,model,owner,notes,technologies;;;;;;;\r\n' +
    '"Web site,web_application,high,production,example.com,203.0.113.5,,,ACME,""Behind CDN"; TLS A+;" HSTS."",""Cloudflare";" React""";;;;\r\n' +
    'API,api,critical,production,api.example.com,203.0.113.6,,,ACME,,Node.js;;;;;;;\r\n';

  it('restores the rows and imports them as assets', async () => {
    const { repairExcelResave } = await import('../services/csv');
    const { parseAssetCsv } = await import('../services/assetCsv');
    expect(repairExcelResave(mangled).repaired).toBe(true);
    const r = parseAssetCsv(mangled);
    expect(r.errors).toEqual([]);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toMatchObject({
      name: 'Web site',
      values: { type: 'application', criticality: 'high', environment: 'production', hostname: 'example.com', notes: 'Behind CDN; TLS A+; HSTS.' },
      technologies: ['Cloudflare', 'React'],
    });
    expect(r.rows[1]).toMatchObject({ name: 'API', values: { type: 'application', criticality: 'high' }, technologies: ['Node.js'] });
  });

  it('leaves normal comma and semicolon files alone', async () => {
    const { repairExcelResave, parseStackCsv } = await import('../services/csv');
    expect(repairExcelResave('name,type\nA,server\n').repaired).toBe(false);
    expect(repairExcelResave('Tecnología;Versión;\nPHP;8.2;\n').repaired).toBe(false);
    /* The stack importer gets the same repair. */
    const stack = parseStackCsv('technology,version,vendor,category,assets;;;;\r\n"PHP,8.2,,Runtime,WEB01";" WEB02";;;\r\n');
    expect(stack.rows).toEqual([{ technology: 'PHP', version: '8.2', category: 'Runtime', assets: ['WEB01', 'WEB02'] }]);
  });
});

describe('My Stack over all companies', () => {
  it('merges the same article across companies with the worst verdict', async () => {
    const { mergeTenantNews, mergeVuln } = await import('../services/stackNews');
    const base = { title: 't', summary: '', source: 's', severity: 'high', category: 'VULNERABILITY', publishedAt: null, publishDate: null, readTime: null, url: 'u', fetchedAt: null };
    const asset = (id: number, name: string, criticality: 'low' | 'medium' | 'high') => ({ id, name, criticality, environment: null, hostname: null, ip: null });
    const merged = mergeTenantNews([
      { tenant: { id: 1, name: 'A' }, news: [{ ...base, id: '10', matchScore: 40, matchedTechnologies: ['nginx'], matchedStackIds: [1], affectedAssets: [asset(5, 'web', 'low')], vuln: { status: 'not_affected', cves: ['CVE-1'], units: [] } }] as any },
      { tenant: { id: 2, name: 'B' }, news: [
        { ...base, id: '10', matchScore: 70, matchedTechnologies: ['nginx', 'php'], matchedStackIds: [7], affectedAssets: [asset(9, 'lb', 'high')], vuln: { status: 'affected', cves: ['CVE-1', 'CVE-2'], units: [] } },
        { ...base, id: '11', matchScore: 10, matchedTechnologies: ['php'], matchedStackIds: [8], affectedAssets: [], vuln: { status: 'no_cve', cves: [], units: [] } },
      ] as any },
    ]);
    expect(merged.map((n) => n.id)).toEqual(['10', '11']);
    const a = merged[0];
    expect(a.matchScore).toBe(70);
    expect(a.matchedTechnologies).toEqual(['nginx', 'php']);
    expect(a.matchedStackIds).toEqual([1, 7]);
    expect(a.affectedAssets.map((x) => x.name)).toEqual(['lb', 'web']);
    expect(a.vuln.status).toBe('affected');
    expect(a.vuln.cves).toEqual(['CVE-1', 'CVE-2']);
    expect(a.tenants).toEqual([{ id: 1, name: 'A', status: 'not_affected' }, { id: 2, name: 'B', status: 'affected' }]);
    expect(mergeVuln([{ status: 'not_affected', cves: [], units: [] }, { status: 'unverified', cves: [], units: [] }]).status).toBe('unverified');
    expect(mergeVuln([{ status: 'no_cve', cves: [], units: [] }, { status: 'not_affected', cves: [], units: [] }]).status).toBe('not_affected');
  });
});
