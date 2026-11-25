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
/* The tests below log in far more often than one person would. */
process.env.CYBERPULSE_RATE_LOGIN = '1000';
process.env.CYBERPULSE_RATE_SEND = '1000';
process.env.CYBERPULSE_RATE_WRITE = '1000';
process.env.CYBERPULSE_RATE_READ = '5000';

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
  const { app } = await import('../index');
  const { getSqlite } = await import('../db/client');
  const { createUser } = await import('../services/auth/userService');
  getSqlite();
  (await import('../services/logs/logStore')).startLogStore();
  await createUser({ username: 'root', password: PW, role: 'superadmin', tenantId: null });

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
    const a = await root.req('POST', '/api/admin/tenants', { name: 'Acme', language: 'es', admin: { username: 'alice', password: PW } });
    const b = await root.req('POST', '/api/admin/tenants', { name: 'Globex', language: 'en', admin: { username: 'bob', password: PW } });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    tenantA = a.body.tenant.id;
    tenantB = b.body.tenant.id;
    expect((await root.req('POST', '/api/admin/tenants', { name: 'acme' })).status).toBe(409);
    // digest language and time zone default to Spanish / Madrid when not given
    const plain = await root.req('POST', '/api/admin/tenants', { name: 'Initech' });
    expect(plain.body.tenant.language).toBe('es');
    expect(plain.body.tenant.timezone).toBe('Europe/Madrid');
    expect(a.body.tenant.language).toBe('es');
    expect((await root.req('DELETE', `/api/admin/tenants/${plain.body.tenant.id}`, { confirmName: 'Initech' })).status).toBe(200);
  });

  it('refuses compressed request bodies (Node2Shell hardening)', async () => {
    for (const enc of ['br', 'gzip', 'deflate', 'BR, gzip']) {
      const r = await fetch(base + '/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-encoding': enc, 'x-requested-with': 'cyberpulse' },
        body: Buffer.from([0x1b, 0x03, 0x00, 0xf8]),
      });
      expect(r.status).toBe(415);
    }
    /* identity is fine */
    const ok = await fetch(base + '/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-encoding': 'identity', 'x-requested-with': 'cyberpulse' },
      body: JSON.stringify({ username: 'nobody', password: 'nope-nope-nope' }),
    });
    expect(ok.status).toBe(401);
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
      name: 'SOC', type: 'rocketchat', webhookUrl: hookUrl, minSeverity: 'low', verifiedOnly: false,
      schedule: { type: 'weekly', timeOfDay: '09:00', weekdays: [1, 2, 3, 4, 5] },
    });
    expect(ch.status).toBe(201);
    expect(ch.body.channel.nextRunAt).toBeTruthy();
    expect(JSON.stringify(ch.body)).not.toContain('/hooks/abc/def');

    const { getSqlite } = await import('../db/client');
    getSqlite().prepare(`INSERT INTO articles (title, summary, source, severity, category, published_at, url) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run('Critical FortiOS SSL-VPN flaw exploited', 'Fortinet FortiOS heap overflow', 'TestFeed', 'critical', 'VULNERABILITY', new Date().toISOString(), 'https://news.example/fortios');
    getSqlite().prepare(`INSERT INTO articles (title, summary, source, severity, category, published_at, url) VALUES (?, ?, ?, ?, ?, ?, ?)`)
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

    const { getSqlite } = await import('../db/client');
    getSqlite().prepare(`INSERT INTO articles (title, summary, source, severity, category, published_at, url) VALUES (?, ?, ?, ?, ?, ?, ?)`)
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

  it('delivers digests to Discord and Telegram', async () => {
    const { setWebhookTransport } = await import('../services/webhooks');
    const sent: Array<{ url: string; body: any }> = [];
    setWebhookTransport(async (url: URL, payload: unknown) => {
      sent.push({ url: url.toString(), body: payload });
      return { status: 200, body: '{"ok":true}' };
    });
    try {
      const sched = { type: 'interval', intervalHours: 6 };
      /* Validation */
      expect((await adminA.req('POST', '/api/channels', { name: 'd', type: 'discord', webhookUrl: 'https://evil.example/api/webhooks/1/x', schedule: sched })).status).toBe(400);
      expect((await adminA.req('POST', '/api/channels', { name: 't', type: 'telegram', telegram: { botToken: 'nope', chatId: '123' }, schedule: sched })).status).toBe(400);
      expect((await adminA.req('POST', '/api/channels', { name: 't', type: 'telegram', telegram: { botToken: '123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', chatId: 'not a chat' }, schedule: sched })).status).toBe(400);
      expect((await adminA.req('POST', '/api/channels', { name: 'l', type: 'linkedin', webhookUrl: 'x', schedule: sched })).status).toBe(400);

      const dc = await adminA.req('POST', '/api/channels', { name: 'Discord SOC', type: 'discord', webhookUrl: 'https://discord.com/api/webhooks/123456/SECRETtokenXYZ', minSeverity: 'low', verifiedOnly: false, schedule: sched });
      expect(dc.status).toBe(201);
      expect(JSON.stringify(dc.body)).not.toContain('SECRETtokenXYZ');
      const token = '123456789:AAFakeTokenFakeTokenFakeTokenFake12';
      const tg = await adminA.req('POST', '/api/channels', { name: 'Telegram SOC', type: 'telegram', telegram: { botToken: token, chatId: '-1001234567890' }, minSeverity: 'low', verifiedOnly: false, schedule: sched });
      expect(tg.status).toBe(201);
      expect(JSON.stringify(tg.body)).not.toContain('AAFakeToken');
      expect(tg.body.channel.telegram).toEqual({ chatId: '-1001234567890', botId: '123456789', tokenSet: true });

      const { getSqlite } = await import('../db/client');
      getSqlite().prepare(`INSERT INTO articles (title, summary, source, severity, category, published_at, url) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run('FortiOS <script> & @everyone [bug]', 'Fortinet FortiOS', 'TestFeed', 'critical', 'VULNERABILITY', new Date().toISOString(), 'https://news.example/fortios-dc');

      expect((await adminA.req('POST', `/api/channels/${dc.body.channel.id}/run`)).body.status).toBe('sent');
      const d = sent.pop()!;
      expect(d.url).toBe('https://discord.com/api/webhooks/123456/SECRETtokenXYZ');
      expect(d.body.allowed_mentions).toEqual({ parse: [] });
      expect(d.body.content).toContain('🔴');
      expect(d.body.content).toContain('(<https://news.example/fortios-dc>)');
      expect(d.body.content).toContain('\\[bug\\]');

      expect((await adminA.req('POST', `/api/channels/${tg.body.channel.id}/run`)).body.status).toBe('sent');
      const t = sent.pop()!;
      expect(t.url).toBe(`https://api.telegram.org/bot${token}/sendMessage`);
      expect(t.body).toMatchObject({ chat_id: '-1001234567890', parse_mode: 'HTML', disable_web_page_preview: true });
      expect(t.body.text).toContain('<a href="https://news.example/fortios-dc">FortiOS &lt;script&gt; &amp; @everyone [bug]</a>');

      /* Updating without a token keeps the stored one; the chat can change. */
      const upd = await adminA.req('PUT', `/api/channels/${tg.body.channel.id}`, { telegram: { chatId: '@schub_alerts' } });
      expect(upd.status).toBe(200);
      expect(upd.body.channel.telegram.chatId).toBe('@schub_alerts');
      expect((await adminA.req('POST', `/api/channels/${tg.body.channel.id}/test`)).status).toBe(200);
      expect(sent.pop()!.url).toContain(token);

      /* Telegram errors come back readable, without the token. */
      setWebhookTransport(async () => ({ status: 400, body: '{"ok":false,"description":"Bad Request: chat not found"}' }));
      const fail = await adminA.req('POST', `/api/channels/${tg.body.channel.id}/test`);
      expect(fail.status).toBe(502);
      expect(fail.body.error).toContain('chat not found');
      expect(fail.body.error).not.toContain('AAFake');

      await adminA.req('DELETE', `/api/channels/${dc.body.channel.id}`);
      await adminA.req('DELETE', `/api/channels/${tg.body.channel.id}`);
    } finally {
      setWebhookTransport(null);
    }
  });

  it('splits long messages for Discord and Telegram', async () => {
    const { splitMessage } = await import('../services/webhooks');
    const text = Array.from({ length: 300 }, (_, i) => `line ${i} ${'x'.repeat(20)}`).join('\n');
    const parts = splitMessage(text, 1900);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((p) => p.length <= 1900)).toBe(true);
    expect(parts.join('\n')).toBe(text);
  });

  it('runs LinkedIn channels with daily limits, an approval queue and scheduled posts', async () => {
    const { setLinkedInFetch } = await import('../services/linkedin/client');
    const { publishDuePosts } = await import('../services/linkedin/queueWorker');
    const { getSqlite } = await import('../db/client');
    const posts: any[] = [];
    let postStatus = 201;
    let n = 0;
    setLinkedInFetch((async (url: any, init: any) => {
      const u = String(url);
      if (u.endsWith('/oauth/v2/accessToken')) return new Response(JSON.stringify({ access_token: 'tok-alice', expires_in: 5183999, scope: 'openid,profile,w_member_social,w_organization_social,r_organization_admin' }), { status: 200 });
      if (u.endsWith('/v2/userinfo')) return new Response(JSON.stringify({ sub: 'alice123', name: 'Alice Admin' }), { status: 200 });
      if (u.includes('/rest/organizationAcls?')) return new Response(JSON.stringify({ elements: [{ roleAssignee: 'urn:li:person:alice123', role: 'ADMINISTRATOR', state: 'APPROVED', organization: 'urn:li:organization:777' }] }), { status: 200 });
      if (u.endsWith('/rest/organizations/777')) return new Response(JSON.stringify({ localizedName: 'Acme Corp' }), { status: 200 });
      if (u.endsWith('/rest/posts')) {
        posts.push(JSON.parse(init.body));
        return new Response('', { status: postStatus, headers: postStatus === 201 ? { 'x-restli-id': `urn:li:share:75000000000000000${n++}` } : {} });
      }
      return new Response('nope', { status: 404 });
    }) as typeof fetch);
    const addArticle = (title: string) => getSqlite().prepare(`INSERT INTO articles (title, summary, source, severity, category, published_at, url) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(title, 'Fortinet FortiOS issue', 'TestFeed', 'critical', 'VULNERABILITY', new Date().toISOString(), `https://news.example/${encodeURIComponent(title)}`);
    try {
      process.env.LINKEDIN_CLIENT_ID = 'cid'; process.env.LINKEDIN_CLIENT_SECRET = 'sec';
      process.env.LINKEDIN_REDIRECT_URI = 'https://cyberpulse.example/api/linkedin/callback';
      process.env.LINKEDIN_ORG_POSTING = '1';
      const sched = { type: 'interval', intervalHours: 6 };

      /* Needs the creator's own LinkedIn connection. */
      expect((await adminA.req('POST', '/api/channels', { name: 'LI', type: 'linkedin', linkedin: { author: 'member' }, schedule: sched })).status).toBe(400);
      const r = await fetch(base + '/api/linkedin/connect?return=account', { headers: { cookie: adminA.cookie }, redirect: 'manual' });
      const st = new URL(r.headers.get('location')!).searchParams.get('state')!;
      expect(await (await fetch(base + `/api/linkedin/callback?code=c&state=${encodeURIComponent(st)}`)).text()).toContain('linkedin=connected');

      /* Own profile: publishes directly; one post per run, two per day. */
      const me = await adminA.req('POST', '/api/channels', {
        name: 'LI me', type: 'linkedin', minSeverity: 'low', schedule: sched,
        linkedin: { author: 'member', format: 'Quick Summary', language: 'en', postsPerRun: 1, maxPostsPerDay: 2 },
      });
      expect(me.status).toBe(201);
      expect(me.body.channel.linkedin).toMatchObject({ author: 'member', requireApproval: false, postsPerRun: 1, maxPostsPerDay: 2, owner: { name: 'alice' } });
      expect((await adminA.req('POST', `/api/channels/${me.body.channel.id}/test`)).status).toBe(200);
      expect(posts).toHaveLength(0);

      addArticle('FortiOS LI one');
      addArticle('FortiOS LI two');
      const run1 = await adminA.req('POST', `/api/channels/${me.body.channel.id}/run`);
      expect(run1.body.status).toBe('sent');
      expect(run1.body.detail).toContain('Published 1 post');
      expect(posts).toHaveLength(1);
      expect(posts[0].author).toBe('urn:li:person:alice123');
      expect(posts[0].commentary).not.toMatch(/^\s*[-→•]/m);
      expect((await adminA.req('POST', `/api/channels/${me.body.channel.id}/run`)).body.status).toBe('sent');
      expect(posts).toHaveLength(2);
      addArticle('FortiOS LI three');
      const limited = await adminA.req('POST', `/api/channels/${me.body.channel.id}/run`);
      expect(limited.body).toMatchObject({ status: 'skipped' });
      expect(limited.body.detail).toContain('Daily limit');
      expect(posts).toHaveLength(2);

      /* Company Page: goes to the approval queue by default. */
      const page = await adminA.req('POST', '/api/channels', {
        name: 'LI page', type: 'linkedin', minSeverity: 'low', schedule: sched,
        linkedin: { author: 'urn:li:organization:777', postsPerRun: 2, maxPostsPerDay: 3 },
      });
      expect(page.status).toBe(201);
      expect(page.body.channel.linkedin.requireApproval).toBe(true);
      addArticle('FortiOS LI four');
      const run3 = await adminA.req('POST', `/api/channels/${page.body.channel.id}/run`);
      expect(run3.body.detail).toContain('2 posts waiting for approval');
      expect(posts).toHaveLength(2);

      const q = await adminA.req('GET', '/api/linkedin/queue?status=pending');
      expect(q.body.canApprove).toBe(true);
      expect(q.body.posts).toHaveLength(2);
      expect(q.body.posts[0]).toMatchObject({ status: 'pending', author: 'urn:li:organization:777', authorLabel: 'Acme Corp', channel: { name: 'LI page' } });
      const [p1, p2] = q.body.posts;

      /* Members neither see nor approve them. */
      expect((await memberA.req('GET', '/api/linkedin/queue')).body.posts).toHaveLength(0);
      expect((await memberA.req('POST', `/api/linkedin/queue/${p1.id}/approve`)).status).toBe(403);

      /* Approve with an edit: published right away as the Page. */
      const ok = await adminA.req('POST', `/api/linkedin/queue/${p1.id}/approve`, { text: 'Edited by a human 🔍' });
      expect(ok.status).toBe(200);
      expect(ok.body.post).toMatchObject({ status: 'published', decidedBy: 'alice' });
      expect(ok.body.post.url).toContain('urn:li:share:');
      expect(posts[2]).toMatchObject({ author: 'urn:li:organization:777', commentary: 'Edited by a human 🔍' });
      expect((await adminA.req('POST', `/api/linkedin/queue/${p1.id}/approve`)).status).toBe(409);
      expect((await adminA.req('POST', `/api/linkedin/queue/${p2.id}/reject`)).body.post.status).toBe('rejected');

      /* Generate Post → Schedule: future only, published by the worker when due. */
      expect((await memberA.req('POST', '/api/linkedin/queue', { text: 'x', author: 'member', scheduledFor: new Date(Date.now() + 3600_000).toISOString() })).status).toBe(409);
      expect((await adminA.req('POST', '/api/linkedin/queue', { text: 'x', author: 'member', scheduledFor: '2020-01-01T00:00:00Z' })).status).toBe(400);
      const when = new Date(Date.now() + 3600_000).toISOString();
      const sch = await adminA.req('POST', '/api/linkedin/queue', { text: 'Scheduled post 🛡️', author: 'member', scheduledFor: when });
      expect(sch.status).toBe(201);
      expect(sch.body.post.status).toBe('scheduled');
      expect(await publishDuePosts()).toBe(0);
      expect(await publishDuePosts(new Date(Date.now() + 2 * 3600_000))).toBe(1);
      const done = (await adminA.req('GET', '/api/linkedin/queue?status=published')).body.posts.find((p: any) => p.id === sch.body.post.id);
      expect(done).toMatchObject({ status: 'published' });
      expect(posts[3]).toMatchObject({ author: 'urn:li:person:alice123', commentary: 'Scheduled post 🛡️' });

      /* Cancel before it goes out; failures are recorded. */
      const c = await adminA.req('POST', '/api/linkedin/queue', { text: 'Never', author: 'member', scheduledFor: when });
      expect((await adminA.req('POST', `/api/linkedin/queue/${c.body.post.id}/cancel`)).body.post.status).toBe('cancelled');
      postStatus = 500;
      const f = await adminA.req('POST', '/api/linkedin/queue', { text: 'Will fail', author: 'member', scheduledFor: when });
      await publishDuePosts(new Date(Date.now() + 2 * 3600_000));
      const failed = (await adminA.req('GET', '/api/linkedin/queue?status=failed')).body.posts.find((p: any) => p.id === f.body.post.id);
      expect(failed.error).toBeTruthy();
      postStatus = 201;

      /* Expired connection: the channel pauses itself. */
      getSqlite().prepare("UPDATE linkedin_accounts SET expires_at = '2020-01-01 00:00:00'").run();
      addArticle('FortiOS LI five');
      const exp = await adminA.req('POST', `/api/channels/${page.body.channel.id}/run`);
      expect(exp.body.status).toBe('error');
      expect(exp.body.detail).toContain('paused');
      const ch = (await adminA.req('GET', '/api/channels')).body.channels.find((x: any) => x.id === page.body.channel.id);
      expect(ch.active).toBe(false);

      for (const id of [me.body.channel.id, page.body.channel.id]) await adminA.req('DELETE', `/api/channels/${id}`);
      await adminA.req('DELETE', '/api/linkedin');
    } finally {
      setLinkedInFetch(null);
      for (const k of ['LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET', 'LINKEDIN_REDIRECT_URI', 'LINKEDIN_ORG_POSTING']) delete process.env[k];
    }
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

  it('delivers digests by email through the channel\'s own SMTP server', async () => {
    const { setMailTransportFactory } = await import('../services/mail/send');
    const sent: any[] = [];
    const opened: any[] = [];
    let failWith: any = null;
    setMailTransportFactory((options) => {
      opened.push(options);
      return {
        sendMail: async (m: any) => { if (failWith) throw failWith; sent.push(m); return {} as any; },
        close: () => {},
      } as any;
    });
    try {
      const smtp = { host: 'smtp.gmail.com', port: 587, user: 'bot@acme.example', password: 'abcd efgh ijkl mnop', fromAddress: 'alerts@acme.example', fromName: 'Acme SOC' };
      const base = { name: 'Zeta mail', type: 'email', schedule: { type: 'interval', intervalHours: 6 }, minSeverity: 'low', verifiedOnly: false };

      expect((await adminA.req('POST', '/api/channels', { ...base, recipients: ['not-an-email'], smtp })).status).toBe(400);
      expect((await adminA.req('POST', '/api/channels', { ...base, recipients: ['a@acme.example'], smtp: { ...smtp, port: 22 } })).status).toBe(400);
      expect((await adminA.req('POST', '/api/channels', { ...base, recipients: ['a@acme.example'], smtp: { ...smtp, host: 'http://x' } })).status).toBe(400);
      expect((await adminA.req('POST', '/api/channels', { ...base, recipients: ['a@acme.example\nBcc: x@evil.example'], smtp })).status).toBe(400);
      expect((await adminA.req('POST', '/api/channels', { ...base, recipients: ['a@acme.example'], smtp: { ...smtp, password: '' } })).status).toBe(400);

      const created = await adminA.req('POST', '/api/channels', {
        ...base,
        recipients: 'Ana@Acme.example, bob@acme.example; ana@acme.example',
        smtp,
        header: '{company}: {count} alertas',
        headerHtml: '<img src="https://cdn.acme.example/logo.png" alt="Acme" width="120"><script>alert(1)</script><h2 onclick="x()">{empresa} SOC</h2>',
        footerHtml: '<p style="color:#888;position:fixed">Acme SOC · <a href="javascript:alert(1)">x</a> <a href="https://acme.example">acme.example</a></p><img src="http://insecure.example/a.png">',
      });
      expect(created.status).toBe(201);
      const ch = created.body.channel;
      expect(JSON.stringify(created.body)).not.toContain('abcd');
      expect(ch.email.recipients).toEqual(['ana@acme.example', 'bob@acme.example']);
      expect(ch.email.smtp).toMatchObject({ host: 'smtp.gmail.com', port: 587, security: 'starttls', fromName: 'Acme SOC', passwordSet: true });
      expect(ch.webhookHint).toBe('2 recipients · smtp.gmail.com:587');
      expect(ch.headerHtml).not.toMatch(/script|onclick/);
      expect(ch.headerHtml).toContain('src="https://cdn.acme.example/logo.png"');
      expect(ch.footerHtml).not.toMatch(/javascript|position|insecure/);
      expect(ch.footerHtml).toContain('href="https://acme.example"');

      /* Editing other fields keeps recipients and the stored password. */
      const upd = await adminA.req('PUT', `/api/channels/${ch.id}`, { name: 'Zeta mail 2', smtp: { ...smtp, password: '' } });
      expect(upd.status).toBe(200);
      expect(upd.body.channel.email.smtp.passwordSet).toBe(true);
      expect(upd.body.channel.email.recipients).toHaveLength(2);

      const { getSqlite } = await import('../db/client');
      getSqlite().prepare(`INSERT INTO articles (title, summary, source, severity, category, published_at, url) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run('FortiOS <b>third</b> bug & more', 'Fortinet FortiOS', 'TestFeed', 'high', 'VULNERABILITY', new Date().toISOString(), 'https://news.example/fortios-3');

      const run = await adminA.req('POST', `/api/channels/${ch.id}/run`);
      expect(run.body.status).toBe('sent');
      expect(run.body.detail).toMatch(/to 2 recipients/);
      expect(sent.map((m) => m.to)).toEqual(['ana@acme.example', 'bob@acme.example']);
      const m = sent[0];
      expect(m.from).toEqual({ name: 'Acme SOC', address: 'alerts@acme.example' });
      expect(m.subject).toMatch(/^Acme: \d+ alertas$/);
      expect(m.html).toContain('Acme SOC</h2>');
      expect(m.html).toContain('FortiOS &lt;b&gt;third&lt;/b&gt; bug &amp; more');
      expect(m.html).toContain('href="https://news.example/fortios-3"');
      expect(m.html).not.toMatch(/<script|javascript:/);
      expect(m.text).toContain('https://news.example/fortios-3');
      /* Connects to the resolved address, verifies the certificate against the name, demands TLS. */
      expect(opened[0]).toMatchObject({ port: 587, secure: false, requireTLS: true, auth: { user: 'bot@acme.example', pass: 'abcdefghijklmnop' } });
      expect(opened[0].tls).toMatchObject({ servername: 'smtp.gmail.com', rejectUnauthorized: true });
      expect(opened[0].host).not.toBe('smtp.gmail.com');

      sent.length = 0;
      expect((await adminA.req('POST', `/api/channels/${ch.id}/run`)).body.status).toBe('skipped');

      /* Test mail; a bad password is reported, not swallowed. */
      expect((await adminA.req('POST', `/api/channels/${ch.id}/test`)).status).toBe(200);
      expect(sent).toHaveLength(2);
      failWith = Object.assign(new Error('Invalid login'), { code: 'EAUTH', response: '535-5.7.8 Username and Password not accepted' });
      const bad = await adminA.req('POST', `/api/channels/${ch.id}/test`);
      expect(bad.status).toBe(502);
      expect(bad.body.error).toContain('EAUTH: 535-5.7.8');
      expect(bad.body.error).toContain('0/2 recipients');

      /* Preview: same sanitising, nothing stored or sent. */
      const prev = await adminA.req('POST', '/api/channels/preview-email', { header: 'Hola {company}', headerHtml: '<b>{company}</b><iframe src="https://x"></iframe>', footerHtml: '' });
      expect(prev.status).toBe(200);
      expect(prev.body.html).toContain('<b>Acme</b>');
      expect(prev.body.html).not.toContain('iframe');
      expect((await memberA.req('POST', '/api/channels/preview-email', {})).status).toBe(403);

      await adminA.req('DELETE', `/api/channels/${ch.id}`);
    } finally {
      setMailTransportFactory(null);
    }
  });

  it('refuses SMTP servers on private addresses unless explicitly allowed', async () => {
    const { sendEmail, MailError } = await import('../services/mail/send');
    process.env.CYBERPULSE_ALLOW_PRIVATE_WEBHOOKS = 'false';
    try {
      const target = { recipients: ['a@acme.example'], smtp: { host: 'localhost', port: 587, security: 'starttls' as const, user: 'u', password: 'p', fromAddress: 'a@acme.example', fromName: '' } };
      await expect(sendEmail(target, { subject: 's', html: 'h', text: 't' })).rejects.toThrow(MailError);
      await expect(sendEmail(target, { subject: 's', html: 'h', text: 't' })).rejects.toThrow(/non-public/);
    } finally {
      process.env.CYBERPULSE_ALLOW_PRIVATE_WEBHOOKS = 'true';
    }
  });

  it('connects a LinkedIn account per user and publishes as that member', async () => {
    const { setLinkedInFetch } = await import('../services/linkedin/client');
    const calls: Array<{ url: string; init: any }> = [];
    let postStatus = 201;
    setLinkedInFetch((async (url: any, init: any) => {
      calls.push({ url: String(url), init });
      const u = String(url);
      if (u.endsWith('/oauth/v2/accessToken')) return new Response(JSON.stringify({ access_token: 'li-token-SECRET-123', expires_in: 5183999, scope: 'openid,profile,w_member_social' }), { status: 200 });
      if (u.endsWith('/v2/userinfo')) return new Response(JSON.stringify({ sub: 'abc123XYZ', name: 'Alice Example', picture: 'https://media.licdn.com/x.jpg' }), { status: 200 });
      if (u.endsWith('/rest/posts')) return new Response(postStatus === 201 ? '' : JSON.stringify({ message: 'Unauthorized' }), { status: postStatus, headers: postStatus === 201 ? { 'x-restli-id': 'urn:li:share:7212345678901234567' } : {} });
      if (u.endsWith('/oauth/v2/revoke')) return new Response('', { status: 200 });
      return new Response('nope', { status: 404 });
    }) as typeof fetch);
    try {
      /* Not configured: status says so, publishing is refused. */
      expect((await adminA.req('GET', '/api/linkedin')).body.configured).toBe(false);
      expect((await adminA.req('POST', '/api/linkedin/posts', { text: 'x' })).status).toBe(400);

      process.env.LINKEDIN_CLIENT_ID = 'cid123';
      process.env.LINKEDIN_CLIENT_SECRET = 'csecret456';
      process.env.LINKEDIN_REDIRECT_URI = 'https://cyberpulse.example/api/linkedin/callback';
      expect((await adminA.req('GET', '/api/linkedin')).body).toMatchObject({ configured: true, connected: false });

      /* Connect: redirect to LinkedIn with our state and the three scopes. */
      const r = await fetch(base + '/api/linkedin/connect?return=account', { headers: { cookie: memberA.cookie }, redirect: 'manual' });
      expect(r.status).toBe(302);
      const loc = new URL(r.headers.get('location')!);
      expect(loc.origin + loc.pathname).toBe('https://www.linkedin.com/oauth/v2/authorization');
      expect(loc.searchParams.get('client_id')).toBe('cid123');
      expect(loc.searchParams.get('scope')).toBe('openid profile w_member_social');
      const state = loc.searchParams.get('state')!;
      expect(state.length).toBeGreaterThan(30);
      /* Needs a session. */
      expect((await fetch(base + '/api/linkedin/connect', { redirect: 'manual' })).status).toBe(401);

      /* Callback without a valid state does nothing. */
      const forged = await fetch(base + '/api/linkedin/callback?code=x&state=forged');
      expect(await forged.text()).toContain('linkedin=error');
      expect(calls).toHaveLength(0);

      /* Real callback (no cookie: LinkedIn's redirect does not carry it). */
      const cb = await fetch(base + `/api/linkedin/callback?code=authcode1&state=${encodeURIComponent(state)}`);
      const html = await cb.text();
      expect(html).toContain('linkedin=connected');
      expect(html).toContain('view=account');
      expect(calls[0].init.body).toContain('client_secret=csecret456');
      /* State is single use. */
      expect(await (await fetch(base + `/api/linkedin/callback?code=authcode1&state=${encodeURIComponent(state)}`)).text()).toContain('reason=expired');

      const st = await memberA.req('GET', '/api/linkedin');
      expect(st.body).toMatchObject({ connected: true, name: 'Alice Example' });
      expect(JSON.stringify(st.body)).not.toContain('li-token');
      /* Stored encrypted. */
      const { getSqlite } = await import('../db/client');
      const raw = getSqlite().prepare('SELECT access_token FROM linkedin_accounts').get() as { access_token: string };
      expect(raw.access_token).not.toContain('li-token');
      /* Another user is not connected. */
      expect((await adminA.req('GET', '/api/linkedin')).body.connected).toBe(false);

      /* Publish: escaped little-text, hashtags, versioned Posts API, CSRF required. */
      expect((await memberA.req('POST', '/api/linkedin/posts', { text: 'x' }, { csrf: false })).status).toBe(403);
      expect((await memberA.req('POST', '/api/linkedin/posts', { text: '   ' })).status).toBe(400);
      expect((await memberA.req('POST', '/api/linkedin/posts', { text: 'a'.repeat(3001) })).status).toBe(400);
      const pub = await memberA.req('POST', '/api/linkedin/posts', { text: 'Patch FortiOS (CVE-2026-1) now @team #CyberSecurity #FortiOS' });
      expect(pub.status).toBe(201);
      expect(pub.body.url).toBe('https://www.linkedin.com/feed/update/urn:li:share:7212345678901234567/');
      const post = calls.find((c) => c.url.endsWith('/rest/posts'))!;
      expect(post.init.headers.Authorization).toBe('Bearer li-token-SECRET-123');
      expect(post.init.headers['LinkedIn-Version']).toMatch(/^\d{6}$/);
      const body = JSON.parse(post.init.body);
      expect(body.author).toBe('urn:li:person:abc123XYZ');
      expect(body.commentary).toBe('Patch FortiOS \\(CVE-2026-1\\) now \\@team {hashtag|\\#|CyberSecurity} {hashtag|\\#|FortiOS}');
      expect((getSqlite().prepare('SELECT COUNT(*) n FROM linkedin_posts WHERE post_urn = \'urn:li:share:7212345678901234567\'').get() as { n: number }).n).toBe(1);

      /* LinkedIn revoked the token: the connection is dropped and the user asked to reconnect. */
      postStatus = 401;
      const gone = await memberA.req('POST', '/api/linkedin/posts', { text: 'again' });
      expect(gone.status).toBe(409);
      expect(gone.body.code).toBe('LINKEDIN_RECONNECT');
      expect((await memberA.req('GET', '/api/linkedin')).body.connected).toBe(false);

      /* Disconnect is idempotent. */
      expect((await memberA.req('DELETE', '/api/linkedin')).status).toBe(200);
    } finally {
      setLinkedInFetch(null);
      delete process.env.LINKEDIN_CLIENT_ID;
      delete process.env.LINKEDIN_CLIENT_SECRET;
      delete process.env.LINKEDIN_REDIRECT_URI;
    }
  });

  it('publishes as a LinkedIn Company Page when Community Management is enabled', async () => {
    const { setLinkedInFetch } = await import('../services/linkedin/client');
    const calls: Array<{ url: string; init: any }> = [];
    let postStatus = 201;
    let grantedScope = 'openid,profile,w_member_social,w_organization_social,r_organization_admin';
    let acls: any[] = [
      { roleAssignee: 'urn:li:person:abc123XYZ', role: 'ADMINISTRATOR', state: 'APPROVED', organization: 'urn:li:organization:111' },
      { roleAssignee: 'urn:li:person:abc123XYZ', role: 'ANALYST', state: 'APPROVED', organization: 'urn:li:organization:222' },
    ];
    setLinkedInFetch((async (url: any, init: any) => {
      calls.push({ url: String(url), init });
      const u = String(url);
      if (u.endsWith('/oauth/v2/accessToken')) return new Response(JSON.stringify({ access_token: 'li-org-token', expires_in: 5183999, scope: grantedScope }), { status: 200 });
      if (u.endsWith('/v2/userinfo')) return new Response(JSON.stringify({ sub: 'abc123XYZ', name: 'Alice Example' }), { status: 200 });
      if (u.includes('/rest/organizationAcls?')) return new Response(JSON.stringify({ elements: acls }), { status: 200 });
      if (u.endsWith('/rest/organizations/111')) return new Response(JSON.stringify({ localizedName: 'Hacker-Do' }), { status: 200 });
      if (u.endsWith('/rest/organizations/333')) return new Response(JSON.stringify({ localizedName: 'Other Page' }), { status: 200 });
      if (u.endsWith('/rest/posts')) return new Response(postStatus === 201 ? '' : JSON.stringify({ message: 'Not enough permissions' }), { status: postStatus, headers: postStatus === 201 ? { 'x-restli-id': 'urn:li:share:7300000000000000001' } : {} });
      if (u.endsWith('/oauth/v2/revoke')) return new Response('', { status: 200 });
      return new Response('nope', { status: 404 });
    }) as typeof fetch);
    const connect = async () => {
      const r = await fetch(base + '/api/linkedin/connect?return=generate', { headers: { cookie: memberA.cookie }, redirect: 'manual' });
      const loc = new URL(r.headers.get('location')!);
      const cb = await fetch(base + `/api/linkedin/callback?code=c&state=${encodeURIComponent(loc.searchParams.get('state')!)}`);
      expect(await cb.text()).toContain('linkedin=connected');
      return loc.searchParams.get('scope');
    };
    try {
      process.env.LINKEDIN_CLIENT_ID = 'cid123';
      process.env.LINKEDIN_CLIENT_SECRET = 'csecret456';
      process.env.LINKEDIN_REDIRECT_URI = 'https://cyberpulse.example/api/linkedin/callback';

      /* Off by default: the Page scopes are not requested. */
      expect((await memberA.req('GET', '/api/linkedin')).body.orgPosting).toBe(false);
      process.env.LINKEDIN_ORG_POSTING = '1';
      expect(await connect()).toBe('openid profile w_member_social w_organization_social r_organization_admin');

      /* Only Pages with a posting role, with their names. */
      const st = (await memberA.req('GET', '/api/linkedin')).body;
      expect(st).toMatchObject({ orgPosting: true, connected: true, canPostAsMember: true, canPostAsOrganization: true });
      expect(st.organizations).toEqual([{ urn: 'urn:li:organization:111', name: 'Hacker-Do', role: 'ADMINISTRATOR' }]);

      /* Post as the Page; the audit row records the author. */
      const pub = await memberA.req('POST', '/api/linkedin/posts', { text: 'Hello from the Page', author: 'urn:li:organization:111' });
      expect(pub.status).toBe(201);
      const post = calls.filter((c) => c.url.endsWith('/rest/posts')).pop()!;
      expect(JSON.parse(post.init.body).author).toBe('urn:li:organization:111');
      const { getSqlite } = await import('../db/client');
      expect((getSqlite().prepare('SELECT author FROM linkedin_posts ORDER BY id DESC LIMIT 1').get() as { author: string }).author).toBe('urn:li:organization:111');

      /* A Page the member does not hold a posting role on is refused locally. */
      const before = calls.length;
      expect((await memberA.req('POST', '/api/linkedin/posts', { text: 'x', author: 'urn:li:organization:222' })).status).toBe(400);
      expect((await memberA.req('POST', '/api/linkedin/posts', { text: 'x', author: 'urn:li:person:someoneElse' })).status).toBe(400);
      expect(calls.length).toBe(before);
      /* Still possible as the member. */
      const asMe = await memberA.req('POST', '/api/linkedin/posts', { text: 'Me', author: 'member' });
      expect(asMe.status).toBe(201);
      expect(JSON.parse(calls.filter((c) => c.url.endsWith('/rest/posts')).pop()!.init.body).author).toBe('urn:li:person:abc123XYZ');

      /* LinkedIn refuses the Page (role removed): clear 403, connection kept. */
      postStatus = 403;
      const denied = await memberA.req('POST', '/api/linkedin/posts', { text: 'x', author: 'urn:li:organization:111' });
      expect(denied.status).toBe(403);
      expect(denied.body.error).toContain('admin');
      expect((await memberA.req('GET', '/api/linkedin')).body.connected).toBe(true);
      postStatus = 201;

      /* Refresh picks up a new Page. */
      acls = [...acls, { roleAssignee: 'urn:li:person:abc123XYZ', role: 'CONTENT_ADMINISTRATOR', state: 'APPROVED', organization: 'urn:li:organization:333' }];
      const ref = await memberA.req('POST', '/api/linkedin/organizations/refresh');
      expect(ref.status).toBe(200);
      expect(ref.body.organizations.map((o: any) => o.name)).toEqual(['Hacker-Do', 'Other Page']);

      /* An app with only Community Management (no OpenID): member id from the
         page roles, posting as the member refused. */
      process.env.LINKEDIN_SCOPES = 'w_organization_social r_organization_admin';
      grantedScope = 'w_organization_social,r_organization_admin';
      expect(await connect()).toBe('w_organization_social r_organization_admin');
      const st2 = (await memberA.req('GET', '/api/linkedin')).body;
      expect(st2).toMatchObject({ canPostAsMember: false, canPostAsOrganization: true, name: null });
      expect(st2.organizations).toHaveLength(2);
      expect((await memberA.req('POST', '/api/linkedin/posts', { text: 'x', author: 'member' })).status).toBe(400);
      expect((await memberA.req('POST', '/api/linkedin/posts', { text: 'x', author: 'urn:li:organization:333' })).status).toBe(201);

      /* A token without the Page scope never exposes Pages. */
      delete process.env.LINKEDIN_SCOPES;
      grantedScope = 'openid,profile,w_member_social';
      await connect();
      const st3 = (await memberA.req('GET', '/api/linkedin')).body;
      expect(st3).toMatchObject({ canPostAsOrganization: false, organizations: [] });
      expect((await memberA.req('POST', '/api/linkedin/posts', { text: 'x', author: 'urn:li:organization:111' })).status).toBe(400);
      expect((await memberA.req('DELETE', '/api/linkedin')).status).toBe(200);
    } finally {
      setLinkedInFetch(null);
      for (const k of ['LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET', 'LINKEDIN_REDIRECT_URI', 'LINKEDIN_ORG_POSTING', 'LINKEDIN_SCOPES']) delete process.env[k];
    }
  });

  it('uses a separate Community Management app for Company Pages', async () => {
    const { setLinkedInFetch } = await import('../services/linkedin/client');
    const calls: Array<{ url: string; init: any }> = [];
    setLinkedInFetch((async (url: any, init: any) => {
      calls.push({ url: String(url), init });
      const u = String(url);
      if (u.endsWith('/oauth/v2/accessToken')) {
        const pages = String(init.body).includes('client_id=pagesApp');
        return new Response(JSON.stringify(pages
          ? { access_token: 'tok-pages', expires_in: 5183999, scope: 'w_organization_social,r_organization_admin' }
          : { access_token: 'tok-main', expires_in: 5183999, scope: 'openid,profile,w_member_social' }), { status: 200 });
      }
      if (u.endsWith('/v2/userinfo')) return new Response(JSON.stringify({ sub: 'abc123XYZ', name: 'Alice Example' }), { status: 200 });
      if (u.includes('/rest/organizationAcls?')) return new Response(JSON.stringify({ elements: [{ roleAssignee: 'urn:li:person:abc123XYZ', role: 'ADMINISTRATOR', state: 'APPROVED', organization: 'urn:li:organization:111' }] }), { status: 200 });
      if (u.endsWith('/rest/organizations/111')) return new Response(JSON.stringify({ localizedName: 'Example Corp' }), { status: 200 });
      if (u.endsWith('/rest/posts')) return new Response('', { status: 201, headers: { 'x-restli-id': 'urn:li:share:7400000000000000001' } });
      if (u.endsWith('/oauth/v2/revoke')) return new Response('', { status: 200 });
      return new Response('nope', { status: 404 });
    }) as typeof fetch);
    const connect = async (app: string) => {
      const r = await fetch(base + `/api/linkedin/connect?return=account&app=${app}`, { headers: { cookie: memberA.cookie }, redirect: 'manual' });
      const loc = new URL(r.headers.get('location')!);
      const cb = await fetch(base + `/api/linkedin/callback?code=c&state=${encodeURIComponent(loc.searchParams.get('state')!)}`);
      expect(await cb.text()).toContain('linkedin=connected');
      return { clientId: loc.searchParams.get('client_id'), scope: loc.searchParams.get('scope') };
    };
    try {
      process.env.LINKEDIN_CLIENT_ID = 'mainApp';
      process.env.LINKEDIN_CLIENT_SECRET = 'mainSecret';
      process.env.LINKEDIN_PAGES_CLIENT_ID = 'pagesApp';
      process.env.LINKEDIN_PAGES_CLIENT_SECRET = 'pagesSecret';
      process.env.LINKEDIN_REDIRECT_URI = 'https://cyberpulse.example/api/linkedin/callback';

      let st = (await memberA.req('GET', '/api/linkedin')).body;
      expect(st).toMatchObject({ configured: true, orgPosting: true, memberPosting: true, pagesApp: true, connected: false, pagesConnection: { connected: false } });

      /* Each app asks only for its own permissions. */
      expect(await connect('main')).toEqual({ clientId: 'mainApp', scope: 'openid profile w_member_social' });
      st = (await memberA.req('GET', '/api/linkedin')).body;
      expect(st).toMatchObject({ connected: true, canPostAsMember: true, canPostAsOrganization: false, organizations: [], pagesConnection: { connected: false } });
      expect(await connect('pages')).toEqual({ clientId: 'pagesApp', scope: 'w_organization_social r_organization_admin' });
      expect(calls.filter((c) => c.url.endsWith('/accessToken')).pop()!.init.body).toContain('client_secret=pagesSecret');
      st = (await memberA.req('GET', '/api/linkedin')).body;
      expect(st).toMatchObject({ canPostAsMember: true, canPostAsOrganization: true, name: 'Alice Example', pagesConnection: { connected: true } });
      expect(st.organizations).toEqual([{ urn: 'urn:li:organization:111', name: 'Example Corp', role: 'ADMINISTRATOR' }]);

      /* Each author uses the token of its own connection. */
      expect((await memberA.req('POST', '/api/linkedin/posts', { text: 'Page post', author: 'urn:li:organization:111' })).status).toBe(201);
      let post = calls.filter((c) => c.url.endsWith('/rest/posts')).pop()!;
      expect(post.init.headers.Authorization).toBe('Bearer tok-pages');
      expect(JSON.parse(post.init.body).author).toBe('urn:li:organization:111');
      expect((await memberA.req('POST', '/api/linkedin/posts', { text: 'My post', author: 'member' })).status).toBe(201);
      post = calls.filter((c) => c.url.endsWith('/rest/posts')).pop()!;
      expect(post.init.headers.Authorization).toBe('Bearer tok-main');
      expect(JSON.parse(post.init.body).author).toBe('urn:li:person:abc123XYZ');

      /* Refresh goes through the pages connection. */
      expect((await memberA.req('POST', '/api/linkedin/organizations/refresh')).body.organizations).toHaveLength(1);

      /* Disconnecting the pages app keeps the profile connection, and revokes with the right app. */
      expect((await memberA.req('DELETE', '/api/linkedin?app=pages')).status).toBe(200);
      expect(calls.filter((c) => c.url.endsWith('/revoke')).pop()!.init.body).toContain('client_id=pagesApp');
      st = (await memberA.req('GET', '/api/linkedin')).body;
      expect(st).toMatchObject({ connected: true, canPostAsMember: true, canPostAsOrganization: false, organizations: [], pagesConnection: { connected: false } });
      expect((await memberA.req('POST', '/api/linkedin/posts', { text: 'x', author: 'urn:li:organization:111' })).status).toBe(400);

      /* Only the pages app configured: no personal posting offered. */
      await connect('pages');
      delete process.env.LINKEDIN_CLIENT_ID;
      st = (await memberA.req('GET', '/api/linkedin')).body;
      expect(st).toMatchObject({ memberPosting: false, canPostAsMember: false, canPostAsOrganization: true });
      expect((await memberA.req('POST', '/api/linkedin/posts', { text: 'x', author: 'member' })).status).toBe(409);
      expect((await memberA.req('GET', '/api/linkedin/connect?app=main')).status).toBe(400);

      /* Disconnect without ?app clears everything. */
      process.env.LINKEDIN_CLIENT_ID = 'mainApp';
      expect((await memberA.req('DELETE', '/api/linkedin')).status).toBe(200);
      expect((await memberA.req('GET', '/api/linkedin')).body).toMatchObject({ connected: false, pagesConnection: { connected: false } });
    } finally {
      setLinkedInFetch(null);
      for (const k of ['LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET', 'LINKEDIN_PAGES_CLIENT_ID', 'LINKEDIN_PAGES_CLIENT_SECRET', 'LINKEDIN_REDIRECT_URI']) delete process.env[k];
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
    const { createUser, startTotpEnrolment, confirmTotpEnrolment } = await import('../services/auth/userService');
    const { totpCode } = await import('../services/auth/totp');
    const { getSqlite } = await import('../db/client');
    const t = getSqlite().prepare(`INSERT INTO tenants (name) VALUES ('LockCo')`).run();
    const uid = await createUser({ username: 'locky', password: PW, role: 'admin', tenantId: Number(t.lastInsertRowid) });
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

  it('cannot be bypassed by sending the guesses in parallel', async () => {
    const { createUser } = await import('../services/auth/userService');
    const { getSqlite } = await import('../db/client');
    const t = getSqlite().prepare(`INSERT INTO tenants (name) VALUES ('RaceCo')`).run();
    await createUser({ username: 'racer', password: PW, role: 'admin', tenantId: Number(t.lastInsertRowid) });

    const guesses = await Promise.all(Array.from({ length: 12 }, (_, i) =>
      new Client().req('POST', '/api/auth/login', { username: 'racer', password: `wrong-password-${i}` })));
    /* At most five guesses are actually checked; the rest are refused. */
    expect(guesses.filter((r) => r.status === 401).length).toBeLessThanOrEqual(5);
    expect(guesses.filter((r) => r.status === 429).length).toBeGreaterThanOrEqual(7);
    /* And the account is now locked, even for the right password. */
    expect((await new Client().req('POST', '/api/auth/login', { username: 'racer', password: PW })).status).toBe(429);
  });

  it('accepts a 2FA code only once, even from parallel requests', async () => {
    const { createUser, startTotpEnrolment, confirmTotpEnrolment } = await import('../services/auth/userService');
    const { totpCode } = await import('../services/auth/totp');
    const { getSqlite } = await import('../db/client');
    const t = getSqlite().prepare(`INSERT INTO tenants (name) VALUES ('ReplayCo')`).run();
    const uid = await createUser({ username: 'replayer', password: PW, role: 'admin', tenantId: Number(t.lastInsertRowid) });
    const secret = startTotpEnrolment(uid);
    const step = Math.floor(Date.now() / 30000);
    expect(confirmTotpEnrolment(uid, totpCode(secret, step - 1))).toBe(true);

    const code = totpCode(secret, step);
    const both = await Promise.all([0, 1].map(() =>
      new Client().req('POST', '/api/auth/login', { username: 'replayer', password: PW, totp: code })));
    expect(both.map((r) => r.status).sort()).toEqual([200, 401]);
  });
});

describe('application log (superadmin Logs tab)', () => {
  it('audits sign-ins and changes, and shows them only to the superadmin', async () => {
    const root = await new Client().login('root', PW);
    /* A failed and a successful sign-in, with the attempted username and IP. */
    await new Client().req('POST', '/api/auth/login', { username: 'root', password: 'wrong-password-123' });
    const created = await root.req('POST', '/api/admin/tenants', { name: 'Logco', admin: { username: 'logadmin', password: PW } });
    expect(created.status).toBe(201);
    const tenantId = created.body.tenant.id;
    const admin = await new Client().login('logadmin', PW);
    expect((await admin.req('POST', '/api/channels', { name: 'x', type: 'slack', webhookUrl: 'https://hooks.slack.com/services/T000/B000/SECRETSECRETSECRET', schedule: { type: 'interval', intervalHours: 6 }, minSeverity: 'low' })).status).toBeLessThan(500);
    console.log('[TESTLOG] token=abc123456789 and Bearer abcdefghijklmnop');

    /* Only the superadmin. */
    expect((await admin.req('GET', '/api/admin/logs')).status).toBe(403);
    expect((await new Client().req('GET', '/api/admin/logs')).status).toBe(401);

    const all = await root.req('GET', '/api/admin/logs?kind=audit&limit=500');
    expect(all.status).toBe(200);
    const msgs = all.body.entries.map((e: any) => `${e.message} ${e.username ?? ''} ${e.tenantId ?? ''}`);
    expect(msgs.some((m: string) => m.startsWith('auth.login failed') && m.includes('root'))).toBe(true);
    expect(msgs.some((m: string) => m.startsWith('auth.login ok') && m.includes('logadmin'))).toBe(true);
    expect(msgs.some((m: string) => m.startsWith('company.create ok'))).toBe(true);
    const ch = all.body.entries.find((e: any) => e.message.startsWith('channel.create'));
    expect(ch).toMatchObject({ username: 'logadmin', tenantId, level: expect.any(String) });
    expect(ch.ip).toBeTruthy();
    /* Bodies are never logged. */
    expect(JSON.stringify(all.body)).not.toContain('SECRETSECRET');
    expect(JSON.stringify(all.body)).not.toContain(PW);

    /* Filters: level, search, paging. */
    const warn = await root.req('GET', '/api/admin/logs?level=warn&q=auth.login');
    expect(warn.body.entries.length).toBeGreaterThan(0);
    expect(warn.body.entries.every((e: any) => e.level === 'warn' && e.message.includes('auth.login'))).toBe(true);
    const page1 = await root.req('GET', '/api/admin/logs?limit=2');
    expect(page1.body.entries).toHaveLength(2);
    expect(page1.body.hasMore).toBe(true);
    const page2 = await root.req('GET', `/api/admin/logs?limit=2&before=${page1.body.entries[1].id}`);
    expect(page2.body.entries[0].id).toBeLessThan(page1.body.entries[1].id);
    const newer = await root.req('GET', `/api/admin/logs?after=${page1.body.entries[0].id}`);
    expect(newer.body.entries.every((e: any) => e.id > page1.body.entries[0].id)).toBe(true);

    /* Sources and the text export. */
    const src = await root.req('GET', '/api/admin/logs/sources');
    expect(src.body.sources.map((s: any) => s.source)).toContain('AUDIT');
    const txt = await root.req('GET', '/api/admin/logs/export.txt?kind=audit');
    expect(typeof txt.body).toBe('string');
    expect(txt.body).toMatch(/INFO +\[AUDIT\] company\.create ok/);
  });
});


describe('assets (what runs the stack)', () => {
  const root = new Client();
  const admin = new Client();
  const other = new Client();
  const member = new Client();
  let assetWeb = 0;

  it('creates, validates and isolates assets per company', async () => {
    await root.login('root', PW);
    expect((await root.req('POST', '/api/admin/tenants', { name: 'Assetco', language: 'es', admin: { username: 'asa', password: PW } })).status).toBe(201);
    expect((await root.req('POST', '/api/admin/tenants', { name: 'Othercorp', language: 'en', admin: { username: 'oto', password: PW } })).status).toBe(201);
    await admin.login('asa', PW);
    await other.login('oto', PW);

    const web = await admin.req('POST', '/api/assets', {
      name: 'WEB01', type: 'server', criticality: 'high', environment: 'prod',
      hostname: 'web01.assetco.local', ip: '10.0.0.10, 2001:db8::10', brand: 'Dell', model: 'PowerEdge R650',
    });
    expect(web.status).toBe(201);
    expect(web.body.item).toMatchObject({ name: 'WEB01', criticality: 'high', ip: '10.0.0.10, 2001:db8::10', brand: 'Dell', model: 'PowerEdge R650' });
    assetWeb = web.body.item.id;

    expect((await admin.req('POST', '/api/assets', { name: 'web01' })).status).toBe(409);
    expect((await admin.req('POST', '/api/assets', { name: 'X', ip: '10.0.0.300' })).status).toBe(400);
    expect((await admin.req('POST', '/api/assets', { name: 'X', hostname: 'bad host!' })).status).toBe(400);
    expect((await admin.req('POST', '/api/assets', { name: 'X', criticality: 'extreme' })).status).toBe(400);
    expect((await admin.req('POST', '/api/assets', { name: 'X', type: 'spaceship' })).status).toBe(400);
    expect((await admin.req('POST', '/api/assets', { name: '' })).status).toBe(400);

    /* Another company can neither see, edit, delete nor link it. */
    expect((await other.req('GET', '/api/assets')).body.assets).toHaveLength(0);
    expect((await other.req('PUT', `/api/assets/${assetWeb}`, { name: 'Hijack' })).status).toBe(404);
    expect((await other.req('DELETE', `/api/assets/${assetWeb}`)).status).toBe(404);
    expect((await other.req('POST', '/api/tech-stack', { technology: 'Zimbra', assetIds: [assetWeb] })).status).toBe(400);

    /* Members read, never write. */
    expect((await admin.req('POST', '/api/users', { username: 'asm', password: PW, role: 'member' })).status).toBe(201);
    await member.login('asm', PW);
    expect((await member.req('GET', '/api/assets')).body.assets).toHaveLength(1);
    expect((await member.req('POST', '/api/assets', { name: 'M' })).status).toBe(403);
    expect((await member.req('PUT', `/api/assets/${assetWeb}`, { name: 'M' })).status).toBe(403);
  });

  it('links assets to stack rows from the stack, the asset and the CSV', async () => {
    const zimbra = await admin.req('POST', '/api/tech-stack', { technology: 'Zimbra', version: '9.0', assetIds: [assetWeb] });
    expect(zimbra.status).toBe(201);
    expect(zimbra.body.item.assets.map((a: any) => a.name)).toEqual(['WEB01']);

    /* CSV: new assets are created, existing rows get the listed assets. */
    const csv = 'technology,version,vendor,category,assets\nZimbra,9.0,Synacor,Email,MAIL01|web01\nNginx,1.24,,Web Server,WEB01; LB01\n';
    const preview = await admin.req('POST', '/api/tech-stack/import?dryRun=true&mode=append', undefined, { raw: csv });
    expect(preview.body.toInsert).toBe(1);
    expect(preview.body.assetLinksToExisting).toBe(1);
    expect(preview.body.assetsToCreate.sort()).toEqual(['LB01', 'MAIL01']);
    const done = await admin.req('POST', '/api/tech-stack/import?mode=append', undefined, { raw: csv });
    expect(done.body.imported).toBe(1);
    expect(done.body.assetsCreated).toBe(2);

    const stack = (await admin.req('GET', '/api/tech-stack')).body.stack;
    const byTech = Object.fromEntries(stack.map((s: any) => [s.technology, s.assets.map((a: any) => a.name)]));
    expect(byTech).toEqual({ Nginx: ['LB01', 'WEB01'], Zimbra: ['MAIL01', 'WEB01'] });

    /* Export round-trips the assets column. */
    const exported = await admin.req('GET', '/api/tech-stack/export.csv');
    expect(String(exported.body)).toContain('assets');
    expect(String(exported.body)).toMatch(/Zimbra,9\.0,,,MAIL01\|WEB01/);

    /* Editing a row's assets replaces them; omitting assetIds keeps them. */
    const nginx = stack.find((s: any) => s.technology === 'Nginx');
    const kept = await admin.req('PUT', `/api/tech-stack/${nginx.id}`, { technology: 'Nginx', version: '1.24' });
    expect(kept.body.item.assets).toHaveLength(2);
    const replaced = await admin.req('PUT', `/api/tech-stack/${nginx.id}`, { technology: 'Nginx', version: '1.24', assetIds: [] });
    expect(replaced.body.item.assets).toHaveLength(0);

    /* From the asset side. */
    const assets = (await admin.req('GET', '/api/assets')).body.assets;
    const lb = assets.find((a: any) => a.name === 'LB01');
    const upd = await admin.req('PUT', `/api/assets/${lb.id}`, { name: 'LB01', criticality: 'low', stackItemIds: [nginx.id] });
    expect(upd.body.item.stackItemIds).toEqual([nginx.id]);

    /* Deleting an asset unlinks it; deleting a stack row unlinks its assets. */
    const mail = assets.find((a: any) => a.name === 'MAIL01');
    expect((await admin.req('DELETE', `/api/assets/${mail.id}`)).status).toBe(200);
    const z = (await admin.req('GET', '/api/tech-stack')).body.stack.find((s: any) => s.technology === 'Zimbra');
    expect(z.assets.map((a: any) => a.name)).toEqual(['WEB01']);
  });

  it('shows affected assets on My Stack, in opted-in digests only, filtered by criticality', async () => {
    const { getSqlite } = await import('../db/client');
    getSqlite().prepare(`INSERT INTO articles (title, summary, source, severity, category, published_at, url) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run('Zimbra Collaboration zero-day exploited', 'Synacor Zimbra flaw', 'TestFeed', 'critical', 'VULNERABILITY', new Date().toISOString(), 'https://news.example/zimbra');
    getSqlite().prepare(`INSERT INTO articles (title, summary, source, severity, category, published_at, url) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run('Nginx resolver bug patched', 'nginx 1.24 fix', 'TestFeed', 'high', 'VULNERABILITY', new Date().toISOString(), 'https://news.example/nginx');

    const news = (await admin.req('GET', '/api/tech-stack/news')).body.news;
    const zimbraNews = news.find((n: any) => n.url === 'https://news.example/zimbra');
    expect(zimbraNews.affectedAssets.map((a: any) => a.name)).toEqual(['WEB01']);

    /* Default: no assets in the message. */
    const plain = await admin.req('POST', '/api/channels', { name: 'plain', type: 'rocketchat', webhookUrl: hookUrl, minSeverity: 'low', verifiedOnly: false, schedule: { type: 'interval', intervalHours: 6 } });
    expect(plain.body.channel.includeAssets).toBe(false);
    received.length = 0;
    expect((await admin.req('POST', `/api/channels/${plain.body.channel.id}/run`)).body.status).toBe('sent');
    expect(received[0].body.text).toContain('Zimbra');
    expect(received[0].body.text).not.toContain('WEB01');

    /* Opted in: assets with their criticality. */
    const withAssets = await admin.req('POST', '/api/channels', { name: 'soc', type: 'rocketchat', webhookUrl: hookUrl, minSeverity: 'low', verifiedOnly: false, includeAssets: true, schedule: { type: 'interval', intervalHours: 6 } });
    expect(withAssets.body.channel.includeAssets).toBe(true);
    received.length = 0;
    await admin.req('POST', `/api/channels/${withAssets.body.channel.id}/run`);
    expect(received[0].body.text).toMatch(/activos: WEB01 · web01\.assetco\.local · 10\.0\.0\.10, 2001:db8::10 \\?\(alta\\?\)/);

    /* Only news affecting a high-criticality asset: Nginx (LB01, low) is dropped. */
    const critical = await admin.req('POST', '/api/channels', { name: 'crit', type: 'rocketchat', webhookUrl: hookUrl, minSeverity: 'low', verifiedOnly: false, minAssetCriticality: 'high', schedule: { type: 'interval', intervalHours: 6 } });
    received.length = 0;
    const run = await admin.req('POST', `/api/channels/${critical.body.channel.id}/run`);
    expect(run.body.articleCount).toBe(1);
    expect(received[0].body.text).toContain('Zimbra');
    expect(received[0].body.text).not.toContain('Nginx');
    expect(received[0].body.text).not.toContain('WEB01');
    expect((await admin.req('POST', '/api/channels', { name: 'bad', type: 'rocketchat', webhookUrl: hookUrl, minAssetCriticality: 'extreme', schedule: { type: 'interval', intervalHours: 6 } })).status).toBe(400);
  });

  it('never includes assets in the AI summary prompt or LinkedIn', async () => {
    const { selectCandidates, withAssets, aiSummary } = await import('../services/digest');
    const { assetRepository } = await import('../repositories/assetRepository');
    const { tenantStack } = await import('../services/stackNews');
    const { tenantRepository } = await import('../repositories/tenantRepository');
    const tenant = tenantRepository.listBasic().find((t: any) => t.name === 'Assetco')!;
    const links = assetRepository.linksByStackItem(tenant.id);
    const channel = { id: 999999, type: 'slack', verifiedOnly: false, minSeverity: 'low', maxItems: 10, lastSentAt: null, minAssetCriticality: null } as any;
    const items = await selectCandidates(channel, tenantStack(tenant.id), new Date(), links);
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.assets === undefined)).toBe(true);
    expect(withAssets(items, links).some((i) => i.assets?.some((a) => a.name === 'WEB01'))).toBe(true);
    /* No AI key configured: no call; the prompt builder is never given assets anyway. */
    expect(await aiSummary(tenant.id, 'es', items)).toBeNull();

    /* Asset options are forced off for LinkedIn, whatever the request says. */
    const { parseAssetOptions } = await import('../controllers/channelController');
    expect(parseAssetOptions('linkedin', { includeAssets: true, minAssetCriticality: 'high' })).toEqual({ includeAssets: false, minAssetCriticality: null });
    expect(parseAssetOptions('linkedin', {}, { includeAssets: true, minAssetCriticality: 'high' })).toEqual({ includeAssets: false, minAssetCriticality: null });
    expect(parseAssetOptions('slack', { includeAssets: true })).toEqual({ includeAssets: true, minAssetCriticality: null });
  });
});

describe('assets CSV import/export', () => {
  const admin = new Client();
  const member = new Client();

  it('previews, creates, updates and links assets from a CSV', async () => {
    await admin.login('asa', PW);
    /* Spanish headers and values, semicolons, IPs and technologies in one cell. */
    const csv = '﻿Nombre;Tipo;Criticidad;Entorno;Hostname;IP;Marca;Modelo;Tecnologías\n' +
      'WEB01;servidor;media;prod;web01.assetco.es;10.0.0.10;HPE;DL380;Zimbra 9.0|Nginx\n' +
      'NEW-FW;firewall;Alta;prod;fw.assetco.local;"10.0.0.1, 203.0.113.9";Fortinet;FortiGate 60F;FortiOS\n' +
      'BAD1;spaceship;alta;;;;;;\n' +
      'BAD2;server;alta;;;10.0.0.999;;;\n' +
      'web01;server;baja;;;;;;\n';
    const preview = await admin.req('POST', '/api/assets/import?dryRun=true&mode=merge', undefined, { raw: csv });
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({ toCreate: 1, toUpdate: 1, toDelete: 0, duplicatesInFile: 1, errorCount: 2 });
    expect(preview.body.unknownTechnologies).toEqual(['FortiOS']);
    expect((await admin.req('GET', '/api/assets')).body.assets.find((a: any) => a.name === 'NEW-FW')).toBeUndefined();

    const done = await admin.req('POST', '/api/assets/import?mode=merge', undefined, { raw: csv });
    expect(done.body).toMatchObject({ created: 1, updated: 1, deleted: 0 });
    const list = (await admin.req('GET', '/api/assets')).body.assets;
    const web = list.find((a: any) => a.name === 'WEB01');
    expect(web).toMatchObject({ criticality: 'medium', brand: 'HPE', model: 'DL380', hostname: 'web01.assetco.es' });
    const stack = (await admin.req('GET', '/api/tech-stack')).body.stack;
    const idOf = (t: string) => stack.find((s: any) => s.technology === t).id;
    expect(web.stackItemIds.sort()).toEqual([idOf('Zimbra'), idOf('Nginx')].sort());
    expect(list.find((a: any) => a.name === 'NEW-FW')).toMatchObject({ type: 'firewall', criticality: 'high', ip: '10.0.0.1, 203.0.113.9' });

    /* A column left out keeps the stored value. */
    await admin.req('POST', '/api/assets/import?mode=merge', undefined, { raw: 'name,owner\nWEB01,Infra\n' });
    const web2 = (await admin.req('GET', '/api/assets')).body.assets.find((a: any) => a.name === 'WEB01');
    expect(web2).toMatchObject({ owner: 'Infra', brand: 'HPE', criticality: 'medium' });
    expect(web2.stackItemIds).toHaveLength(2);
  });

  it('exports, replaces and stays admin-only', async () => {
    const exported = String((await admin.req('GET', '/api/assets/export.csv')).body);
    expect(exported.split('\n')[0]).toContain('name,type,criticality');
    expect(exported).toMatch(/WEB01,server,medium,prod,web01\.assetco\.es,10\.0\.0\.10,HPE,DL380,Infra,,(Nginx 1\.24\|Zimbra 9\.0|Zimbra 9\.0\|Nginx 1\.24)/);
    expect(exported).toContain('"10.0.0.1;203.0.113.9"'.replace(/"/g, ''));

    const before = (await admin.req('GET', '/api/assets')).body.assets.length;
    const prev = await admin.req('POST', '/api/assets/import?dryRun=true&mode=replace', undefined, { raw: 'name\nWEB01\nNEW-FW\n' });
    expect(prev.body.toDelete).toBe(before - 2);
    const rep = await admin.req('POST', '/api/assets/import?mode=replace', undefined, { raw: 'name\nWEB01\nNEW-FW\n' });
    expect(rep.body.deleted).toBe(before - 2);
    expect((await admin.req('GET', '/api/assets')).body.assets.map((a: any) => a.name).sort()).toEqual(['NEW-FW', 'WEB01']);

    expect((await admin.req('POST', '/api/assets/import', undefined, { raw: 'tipo\nserver\n' })).body.errors[0].message).toMatch(/header/);
    await member.login('asm', PW);
    expect((await member.req('POST', '/api/assets/import?mode=merge', undefined, { raw: 'name\nX\n' })).status).toBe(403);
    expect((await member.req('GET', '/api/assets/export.csv')).status).toBe(200);
    expect(String((await member.req('GET', '/api/assets/template.csv')).body)).toContain('FW-PERIMETRO');
  });
});

describe('version-verified vulnerabilities', () => {
  const root = new Client();
  const admin = new Client();

  it('sends only CVEs confirmed against the installed version of each asset', async () => {
    const { setCveTransport } = await import('../services/vuln/cveSync');
    const fixtures = path.join(__dirname, 'fixtures', 'cve');
    const calls: string[] = [];
    setCveTransport(async (url: string) => {
      calls.push(url);
      const id = decodeURIComponent(url.match(/CVE-\d{4}-\d+/)![0]);
      const file = path.join(fixtures, `${id}.${url.includes('nvd.nist.gov') ? 'nvd' : 'cve'}.json`);
      if (!fs.existsSync(file)) return new Response('{}', { status: 404 });
      return new Response(fs.readFileSync(file), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }, 0);
    try {
      await root.login('root', PW);
      expect((await root.req('POST', '/api/admin/tenants', { name: 'Verico', language: 'es', admin: { username: 'vera', password: PW } })).status).toBe(201);
      await admin.login('vera', PW);

      /* One nginx row; each asset reports its own version. */
      const row = (await admin.req('POST', '/api/tech-stack', { technology: 'nginx', vendor: 'F5' })).body.item;
      const old = (await admin.req('POST', '/api/assets', { name: 'EDGE-OLD', criticality: 'high', stackItemIds: [row.id], stackVersions: { [row.id]: '1.22.1' } })).body.item;
      expect(old.stackVersions).toEqual({ [row.id]: '1.22.1' });
      await admin.req('POST', '/api/assets/import?mode=merge', undefined, { raw: 'name,criticality,technologies\nEDGE-NEW,high,nginx 1.31.8\n' });
      const assets = (await admin.req('GET', '/api/assets')).body.assets;
      expect(assets.find((a: any) => a.name === 'EDGE-NEW').stackVersions).toEqual({ [row.id]: '1.31.8' });
      /* Editing the stack row keeps per-asset versions. */
      await admin.req('PUT', `/api/tech-stack/${row.id}`, { technology: 'nginx', vendor: 'F5', assetIds: assets.map((a: any) => a.id) });
      const stackRow = (await admin.req('GET', '/api/tech-stack')).body.stack[0];
      expect(Object.fromEntries(stackRow.assets.map((a: any) => [a.name, a.version]))).toEqual({ 'EDGE-NEW': '1.31.8', 'EDGE-OLD': '1.22.1' });

      const { getSqlite } = await import('../db/client');
      const ins = getSqlite().prepare(`INSERT INTO articles (title, summary, source, severity, category, published_at, url) VALUES (?, ?, ?, ?, ?, ?, ?)`);
      ins.run('nginx mp4 module flaw (CVE-2024-7347)', 'Over-read in ngx_http_mp4_module', 'TestFeed', 'high', 'VULNERABILITY', new Date().toISOString(), 'https://news.example/nginx-7347');
      ins.run('nginx tuning tips', 'How to tune nginx workers', 'TestFeed', 'high', 'VULNERABILITY', new Date().toISOString(), 'https://news.example/nginx-tips');
      ins.run('PHP-CGI argument injection CVE-2024-4577 mentions nginx setups', 'nginx + php-fpm', 'TestFeed', 'critical', 'VULNERABILITY', new Date().toISOString(), 'https://news.example/php-4577');

      /* Default channel = verified only. */
      const ch = await admin.req('POST', '/api/channels', { name: 'SOC', type: 'rocketchat', webhookUrl: hookUrl, minSeverity: 'low', includeAssets: true, schedule: { type: 'interval', intervalHours: 6 } });
      expect(ch.body.channel.verifiedOnly).toBe(true);
      received.length = 0;
      const run = await admin.req('POST', `/api/channels/${ch.body.channel.id}/run`);
      expect(run.body.status).toBe('sent');
      expect(run.body.articleCount).toBe(1);
      const text = received[0].body.text;
      expect(text).toContain('CVE-2024-7347');
      /* Rocket.Chat markdown escapes the parentheses. */
      expect(text.replace(/\\/g, '')).toContain('nginx 1.22.1 (CVE-2024-7347, corregida en 1.27.1)');
      expect(text).toContain('EDGE-OLD');
      expect(text).not.toContain('EDGE-NEW');
      expect(text).not.toContain('tuning');
      expect(text).not.toContain('PHP-CGI');
      expect(calls.some((u) => u.includes('cveawg.mitre.org'))).toBe(true);

      /* Patching the last vulnerable asset clears it: nothing more to send. */
      await admin.req('PUT', `/api/assets/${old.id}`, { name: 'EDGE-OLD', criticality: 'high', stackItemIds: [row.id], stackVersions: { [row.id]: '1.27.1' } });
      const newsRes = await admin.req('GET', '/api/tech-stack/news');
      const news = newsRes.body.news;
      const n7347 = news.find((n: any) => n.url === 'https://news.example/nginx-7347');
      expect(n7347.vuln.status).toBe('not_affected');
      expect(news.find((n: any) => n.url === 'https://news.example/nginx-tips').vuln.status).toBe('no_cve');
      expect(news.find((n: any) => n.url === 'https://news.example/php-4577').vuln.status).toBe('not_affected');

      getSqlite().prepare('DELETE FROM channel_sent_articles').run();
      const again = await admin.req('POST', `/api/channels/${ch.body.channel.id}/run`);
      expect(again.body.status).toBe('skipped');
      expect(again.body.detail).toMatch(/No confirmed vulnerabilities/);

      /* Opting out restores the old behaviour (every stack match). */
      const upd = await admin.req('PUT', `/api/channels/${ch.body.channel.id}`, { verifiedOnly: false });
      expect(upd.body.channel.verifiedOnly).toBe(false);

      /* CPE override validation. */
      expect((await admin.req('PUT', `/api/tech-stack/${row.id}`, { technology: 'nginx', cpe: 'not a cpe' })).status).toBe(400);
      const cpe = await admin.req('PUT', `/api/tech-stack/${row.id}`, { technology: 'nginx', cpe: 'cpe:2.3:a:f5:nginx_open_source:*:*:*:*:*:*:*:*' });
      expect(cpe.body.item.cpe).toBe('f5:nginx_open_source');
    } finally {
      setCveTransport(null);
    }
  });
});
