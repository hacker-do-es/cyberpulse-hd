import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import type { AddressInfo } from 'net';

/* End-to-end over HTTP against a throwaway database: authentication, CSRF,
   role checks, tenant isolation, CSV import and a real webhook delivery. */

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
process.env.CYBERPULSE_DATA_DIR = dataDir;
process.env.CYBERPULSE_SECRET = 'a'.repeat(64);
process.env.CYBERPULSE_ALLOW_PRIVATE_WEBHOOKS = 'true';
process.env.CYBERPULSE_ALLOW_HTTP_WEBHOOKS = 'true';

let base = '';
let server: http.Server;
let hookServer: http.Server;
let hookUrl = '';
const received: any[] = [];

class Client {
  cookie = '';
  async req(method: string, url: string, body?: unknown, opts: { csrf?: boolean; raw?: string; type?: string } = {}) {
    const headers: Record<string, string> = {};
    if (this.cookie) headers.cookie = this.cookie;
    if (opts.csrf !== false) headers['x-requested-with'] = 'cyberpulse';
    let payload: string | undefined;
    if (opts.raw !== undefined) {
      payload = opts.raw;
      headers['content-type'] = opts.type ?? 'text/csv';
    } else if (body !== undefined) {
      payload = JSON.stringify(body);
      headers['content-type'] = 'application/json';
    }
    const res = await fetch(base + url, { method, headers, body: payload });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) this.cookie = setCookie.split(';')[0];
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, body: json };
  }
  async login(username: string, password: string) {
    const r = await this.req('POST', '/api/auth/login', { username, password });
    expect(r.status).toBe(200);
    return this;
  }
}

const PW = 'a-long-enough-password';

beforeAll(async () => {
  const { app } = await import('./index');
  const { getDb } = await import('./db');
  const { createUser } = await import('./auth');
  getDb();
  createUser({ username: 'root', password: PW, role: 'superadmin', tenantId: null });

  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  hookServer = http.createServer((req, res) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      received.push({ url: req.url, body: JSON.parse(data) });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"success":true}');
    });
  });
  hookServer.listen(0);
  await new Promise((r) => hookServer.once('listening', r));
  hookUrl = `http://127.0.0.1:${(hookServer.address() as AddressInfo).port}/hooks/abc/def`;
});

afterAll(() => {
  server?.close();
  hookServer?.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('multitenant API', () => {
  const root = new Client();
  const adminA = new Client();
  const adminB = new Client();
  const memberA = new Client();
  let tenantA = 0;
  let tenantB = 0;

  it('keeps health public and everything else behind login', async () => {
    const anon = new Client();
    expect((await anon.req('GET', '/api/health')).status).toBe(200);
    expect((await anon.req('GET', '/api/news')).status).toBe(401);
    expect((await anon.req('GET', '/api/tech-stack')).status).toBe(401);
    expect((await anon.req('GET', '/api/admin/tenants')).status).toBe(401);
  });

  it('rejects bad credentials without revealing which part was wrong', async () => {
    const a = await new Client().req('POST', '/api/auth/login', { username: 'root', password: 'nope-nope-nope' });
    const b = await new Client().req('POST', '/api/auth/login', { username: 'ghost', password: 'nope-nope-nope' });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.error).toBe(b.body.error);
  });

  it('lets the superadmin create companies with their first admin', async () => {
    await root.login('root', PW);
    const a = await root.req('POST', '/api/admin/tenants', { name: 'Acme', admin: { username: 'alice', password: PW } });
    const b = await root.req('POST', '/api/admin/tenants', { name: 'Globex', language: 'en', admin: { username: 'bob', password: PW } });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    tenantA = a.body.tenant.id;
    tenantB = b.body.tenant.id;
    expect((await root.req('POST', '/api/admin/tenants', { name: 'acme' })).status).toBe(409);
  });

  it('requires the CSRF header on writes', async () => {
    const r = await root.req('POST', '/api/admin/tenants', { name: 'NoCsrf' }, { csrf: false });
    expect(r.status).toBe(403);
  });

  it('makes the superadmin pick a company before tenant-scoped calls', async () => {
    expect((await root.req('GET', '/api/tech-stack')).status).toBe(409);
    expect((await root.req('POST', '/api/auth/active-tenant', { tenantId: tenantB })).status).toBe(200);
    expect((await root.req('GET', '/api/tech-stack')).status).toBe(200);
  });

  it('imports a CSV stack with preview, scoped to the company', async () => {
    await adminA.login('alice', PW);
    const csv = 'Tecnología;Versión;Fabricante\nWordPress;6.4;Automattic\nFortiOS;7.2;Fortinet\n;1\n';
    const preview = await adminA.req('POST', '/api/tech-stack/import?dryRun=true&mode=append', undefined, { raw: csv });
    expect(preview.status).toBe(200);
    expect(preview.body.toInsert).toBe(2);
    expect(preview.body.errorCount).toBe(1);
    expect((await adminA.req('GET', '/api/tech-stack')).body.stack).toHaveLength(0);

    const done = await adminA.req('POST', '/api/tech-stack/import?mode=append', undefined, { raw: csv });
    expect(done.body.imported).toBe(2);
    const again = await adminA.req('POST', '/api/tech-stack/import?mode=append', undefined, { raw: csv });
    expect(again.body.imported).toBe(0);
    expect(again.body.alreadyPresent).toBe(2);

    const replace = await adminA.req('POST', '/api/tech-stack/import', { csv: 'technology\nFortiOS\nExchange\n', mode: 'replace' });
    expect(replace.body.imported).toBe(2);
    expect(replace.body.willRemove).toBe(2);
    const stack = (await adminA.req('GET', '/api/tech-stack')).body.stack.map((s: any) => s.technology);
    expect(stack).toEqual(['Exchange', 'FortiOS']);
  });

  it('edits a stack row in place', async () => {
    const [exchange, forti] = (await adminA.req('GET', '/api/tech-stack')).body.stack;
    const edited = await adminA.req('PUT', `/api/tech-stack/${exchange.id}`,
      { technology: 'Exchange Server', version: '2019', vendor: 'Microsoft', category: 'Email' });
    expect(edited.status).toBe(200);
    expect(edited.body.item).toMatchObject({ id: exchange.id, technology: 'Exchange Server', version: '2019', vendor: 'Microsoft', category: 'Email' });
    // empty optional fields clear the value
    const cleared = await adminA.req('PUT', `/api/tech-stack/${exchange.id}`, { technology: 'Exchange Server', version: '', vendor: '  ', category: 'Email' });
    expect(cleared.body.item.version).toBeUndefined();
    expect(cleared.body.item.vendor).toBeUndefined();
    // saving a row unchanged is not a duplicate of itself; colliding with another row is
    expect((await adminA.req('PUT', `/api/tech-stack/${exchange.id}`, { technology: 'exchange server', category: 'Email' })).status).toBe(200);
    expect((await adminA.req('PUT', `/api/tech-stack/${exchange.id}`, { technology: forti.technology, version: forti.version })).status).toBe(409);
    expect((await adminA.req('PUT', `/api/tech-stack/${exchange.id}`, { technology: '' })).status).toBe(400);
    expect((await adminA.req('PUT', '/api/tech-stack/999999', { technology: 'X' })).status).toBe(404);
    expect((await adminA.req('PUT', `/api/tech-stack/${exchange.id}`, { technology: 'Y' }, { csrf: false })).status).toBe(403);
    const stack = (await adminA.req('GET', '/api/tech-stack')).body.stack.map((s: any) => s.technology);
    expect(stack).toEqual(['exchange server', 'FortiOS']);
  });

  it('isolates companies from each other', async () => {
    await adminB.login('bob', PW);
    expect((await adminB.req('GET', '/api/tech-stack')).body.stack).toHaveLength(0);
    const itemA = (await adminA.req('GET', '/api/tech-stack')).body.stack[0];
    expect((await adminB.req('DELETE', `/api/tech-stack/${itemA.id}`)).status).toBe(404);
    expect((await adminB.req('PUT', `/api/tech-stack/${itemA.id}`, { technology: 'Hijacked' })).status).toBe(404);
    expect((await adminA.req('GET', '/api/tech-stack')).body.stack).toHaveLength(2);
    expect((await adminA.req('GET', '/api/admin/tenants')).status).toBe(403);
    expect((await adminA.req('POST', '/api/auth/active-tenant', { tenantId: tenantB })).status).toBe(403);
  });

  it('keeps members read-only', async () => {
    const created = await adminA.req('POST', '/api/users', { username: 'mike', password: PW, role: 'member' });
    expect(created.status).toBe(201);
    await memberA.login('mike', PW);
    expect((await memberA.req('GET', '/api/tech-stack')).status).toBe(200);
    expect((await memberA.req('POST', '/api/tech-stack', { technology: 'X' })).status).toBe(403);
    const anyItem = (await memberA.req('GET', '/api/tech-stack')).body.stack[0];
    expect((await memberA.req('PUT', `/api/tech-stack/${anyItem.id}`, { technology: 'X' })).status).toBe(403);
    expect((await memberA.req('GET', '/api/channels')).status).toBe(403);
    expect((await memberA.req('GET', '/api/tenant/settings')).status).toBe(403);
  });

  it('never returns stored secrets', async () => {
    const r = await adminA.req('PUT', '/api/tenant/settings', { ai: { provider: 'anthropic', apiKey: 'sk-ant-api03-secretsecretsecret' } });
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.body)).not.toContain('secretsecretsecret');
    expect(r.body.ai.keySet).toBe(true);
    /* Switching provider without a new key drops the old one. */
    const s = await adminA.req('PUT', '/api/tenant/settings', { ai: { provider: 'openai' } });
    expect(s.body.ai.keySet).toBe(false);
    await adminA.req('PUT', '/api/tenant/settings', { ai: { provider: 'none' } });
  });

  it('validates channels and delivers a digest once per article', async () => {
    const bad = await adminA.req('POST', '/api/channels', {
      name: 'x', type: 'slack', webhookUrl: 'https://evil.example/hook', schedule: { type: 'interval', intervalHours: 6 },
    });
    expect(bad.status).toBe(400);

    const ch = await adminA.req('POST', '/api/channels', {
      name: 'SOC', type: 'rocketchat', webhookUrl: hookUrl, minSeverity: 'low',
      schedule: { type: 'weekly', timeOfDay: '09:00', weekdays: [1, 2, 3, 4, 5] },
    });
    expect(ch.status).toBe(201);
    expect(ch.body.channel.nextRunAt).toBeTruthy();
    expect(JSON.stringify(ch.body)).not.toContain('/hooks/abc/def');

    const { getDb } = await import('./db');
    getDb().prepare(`INSERT INTO articles (title, summary, source, severity, category, published_at, url) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run('Critical FortiOS SSL-VPN flaw exploited', 'Fortinet FortiOS heap overflow', 'TestFeed', 'critical', 'VULNERABILITY', new Date().toISOString(), 'https://news.example/fortios');
    getDb().prepare(`INSERT INTO articles (title, summary, source, severity, category, published_at, url) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run('Unrelated Oracle patch', 'Oracle database', 'TestFeed', 'high', 'VULNERABILITY', new Date().toISOString(), 'https://news.example/oracle');

    const id = ch.body.channel.id;
    expect((await adminB.req('POST', `/api/channels/${id}/run`)).status).toBe(404);

    const run1 = await adminA.req('POST', `/api/channels/${id}/run`);
    expect(run1.body.status).toBe('sent');
    expect(run1.body.articleCount).toBe(1);
    expect(received).toHaveLength(1);
    expect(received[0].url).toBe('/hooks/abc/def');
    expect(received[0].body.text).toContain('FortiOS');
    expect(received[0].body.text).not.toContain('Oracle');

    const run2 = await adminA.req('POST', `/api/channels/${id}/run`);
    expect(run2.body.status).toBe('skipped');
    expect(received).toHaveLength(1);

    const hist = await adminA.req('GET', `/api/channels/${id}/deliveries`);
    expect(hist.body.deliveries.map((d: any) => d.status)).toEqual(['skipped', 'sent']);
  });

  it('uses the channel\'s own header and footer instead of the Hacker-Do branding', async () => {
    const ch = (await adminA.req('GET', '/api/channels')).body.channels[0];
    expect(ch.header).toBeNull();
    expect(ch.footer).toBeNull();

    expect((await adminA.req('PUT', `/api/channels/${ch.id}`, { header: 'x'.repeat(151) })).status).toBe(400);
    expect((await adminA.req('PUT', `/api/channels/${ch.id}`, { footer: 'a\nb\nc\nd' })).status).toBe(400);

    const upd = await adminA.req('PUT', `/api/channels/${ch.id}`, {
      header: 'Schub Security Alerts · {empresa} · {count} alertas',
      footer: 'Schub · Ciberseguridad gestionada\nsoc@schub.example',
    });
    expect(upd.status).toBe(200);
    expect(upd.body.channel.header).toBe('Schub Security Alerts · {empresa} · {count} alertas');

    /* A later edit that does not mention them keeps them. */
    const keep = await adminA.req('PUT', `/api/channels/${ch.id}`, { name: 'SOC' });
    expect(keep.body.channel.footer).toBe('Schub · Ciberseguridad gestionada\nsoc@schub.example');

    const { getDb } = await import('./db');
    getDb().prepare(`INSERT INTO articles (title, summary, source, severity, category, published_at, url) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run('FortiOS @all second bug', 'Fortinet FortiOS', 'TestFeed', 'high', 'VULNERABILITY', new Date().toISOString(), 'https://news.example/fortios-2');

    received.length = 0;
    const run = await adminA.req('POST', `/api/channels/${ch.id}/run`);
    expect(run.body.status).toBe('sent');
    const text: string = received[0].body.text;
    expect(text.split('\n')[0]).toBe('**Schub Security Alerts · Acme · 1 alertas**');
    expect(text).toContain('_Schub · Ciberseguridad gestionada_\n_soc@\u200bschub.example_');
    expect(text).toContain('@\u200ball');
    expect(text).not.toMatch(/Hacker-Do/);

    received.length = 0;
    expect((await adminA.req('POST', `/api/channels/${ch.id}/test`)).status).toBe(200);
    expect(received[0].body.text).toContain('Schub Security Alerts · Acme · 3 alertas');
    expect(received[0].body.text).not.toMatch(/Hacker-Do/);

    /* Footer '' = none; header null = back to default. */
    await adminA.req('PUT', `/api/channels/${ch.id}`, { header: null, footer: '' });
    received.length = 0;
    await adminA.req('POST', `/api/channels/${ch.id}/test`);
    expect(received[0].body.text).toContain('**Hacker-Do CyberPulse · Acme · 3');
    expect(received[0].body.text).not.toContain('hacker-do.es');

    await adminA.req('PUT', `/api/channels/${ch.id}`, { header: null, footer: null });
    received.length = 0;
    await adminA.req('POST', `/api/channels/${ch.id}/test`);
    expect(received[0].body.text).toMatch(/^Mensaje de prueba de Hacker-Do CyberPulse para Acme/);
  });

  it('blocks private webhook targets unless explicitly allowed', async () => {
    process.env.CYBERPULSE_ALLOW_PRIVATE_WEBHOOKS = 'false';
    try {
      const ch = (await adminA.req('GET', '/api/channels')).body.channels[0];
      const r = await adminA.req('POST', `/api/channels/${ch.id}/test`);
      expect(r.status).toBe(502);
      expect(r.body.error).toMatch(/non-public/);
    } finally {
      process.env.CYBERPULSE_ALLOW_PRIVATE_WEBHOOKS = 'true';
    }
  });

  it('cuts off a disabled company immediately', async () => {
    await root.req('PATCH', `/api/admin/tenants/${tenantA}`, { active: false });
    expect((await adminA.req('GET', '/api/tech-stack')).status).toBe(401);
    expect((await new Client().req('POST', '/api/auth/login', { username: 'alice', password: PW })).status).toBe(403);
    await root.req('PATCH', `/api/admin/tenants/${tenantA}`, { active: true });
  });

  it('deletes a company only with its name confirmed', async () => {
    expect((await root.req('DELETE', `/api/admin/tenants/${tenantB}`, { confirmName: 'nope' })).status).toBe(400);
    expect((await root.req('DELETE', `/api/admin/tenants/${tenantB}`, { confirmName: 'globex' })).status).toBe(200);
    expect((await new Client().req('POST', '/api/auth/login', { username: 'bob', password: PW })).status).toBe(401);
  });
});

describe('login lockout', () => {
  it('locks an account after five failures, including bad 2FA codes', async () => {
    const { createUser, startTotpEnrolment, confirmTotpEnrolment, totpCode } = await import('./auth');
    const { getDb } = await import('./db');
    const t = getDb().prepare(`INSERT INTO tenants (name) VALUES ('LockCo')`).run();
    const uid = createUser({ username: 'locky', password: PW, role: 'admin', tenantId: Number(t.lastInsertRowid) });
    const secret = startTotpEnrolment(uid);
    expect(confirmTotpEnrolment(uid, totpCode(secret, Math.floor(Date.now() / 30000)))).toBe(true);

    for (let i = 0; i < 5; i++) {
      const r = await new Client().req('POST', '/api/auth/login', { username: 'locky', password: PW, totp: '000000' });
      expect(r.status).toBe(401);
    }
    const locked = await new Client().req('POST', '/api/auth/login', {
      username: 'locky', password: PW, totp: totpCode(secret, Math.floor(Date.now() / 30000) + 1),
    });
    expect(locked.status).toBe(429);
  });
});
