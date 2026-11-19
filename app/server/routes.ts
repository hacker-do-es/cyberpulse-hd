import express from 'express';
import rateLimit from 'express-rate-limit';
import QRCode from 'qrcode';
import { getDb } from './db';
import { encryptSecret, decryptSecret } from './crypto';
import {
  attemptLogin, createSession, destroySession, sessionCookieOptions, SESSION_COOKIE,
  requireAuth, requireRole, requireTenant, requireTenantAdmin, setActiveTenant,
  validatePasswordStrength, verifyPassword, getPasswordHash, setUserPassword,
  startTotpEnrolment, confirmTotpEnrolment, disableTotp, createUser, USERNAME_RE, loadSession,
  type Role,
} from './auth';
import { parseStackCsv, stackKey, toStackCsv, CSV_TEMPLATE, CSV_MAX_BYTES } from './csv';
import { ANTHROPIC_MODELS, DEFAULT_ANTHROPIC_MODEL, DEFAULT_OPENAI_MODEL, complete, getTenantAiConfig, validateOpenAiBaseUrl, AiError } from './ai';
import { validateWebhookUrl, WebhookError, type ChannelType } from './webhooks';
import { isValidTimeZone, validateSchedule, parseWeekdays, type Schedule } from './schedule';
import { runChannel, sendTestMessage, rescheduleChannel, rescheduleTenant, SEVERITIES, type ChannelRow } from './digest';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function tenantId(req: express.Request): number {
  return req.auth!.tenantId as number;
}

function str(v: unknown, max = 200): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length === 0 || t.length > max ? null : t;
}

function optStr(v: unknown, max = 200): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

function idParam(req: express.Request): number {
  const n = Number(req.params.id);
  return Number.isInteger(n) && n > 0 ? n : -1;
}

function mask(secret: string): string {
  if (!secret) return '';
  return secret.length <= 8 ? '••••' : `${secret.slice(0, 4)}••••${secret.slice(-4)}`;
}

function wrap(fn: (req: express.Request, res: express.Response) => unknown | Promise<unknown>) {
  return async (req: express.Request, res: express.Response) => {
    try {
      await fn(req, res);
    } catch (err: any) {
      console.error('[API]', req.method, req.path, err);
      if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
    }
  };
}

const writeLimiter = rateLimit({
  windowMs: 60_000,
  limit: parseInt(process.env.CYBERPULSE_RATE_WRITE || '', 10) || 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests, slow down.' },
});

/* ------------------------------------------------------------------ */
/*  Auth                                                               */
/* ------------------------------------------------------------------ */

export const authRouter = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many login attempts, try again later.' },
});

authRouter.post('/login', loginLimiter, wrap((req, res) => {
  const { username, password, totp } = req.body ?? {};
  const result = attemptLogin(username, password, totp);
  if (!result.ok) {
    return res.status(result.status).json({ error: result.error, totpRequired: result.totpRequired ?? false });
  }
  const token = createSession(result.user);
  res.cookie(SESSION_COOKIE, token, sessionCookieOptions(req));
  res.json({ ok: true });
}));

authRouter.post('/logout', wrap((req, res) => {
  const ctx = loadSession(req);
  if (ctx) destroySession(ctx.sessionId);
  res.clearCookie(SESSION_COOKIE, { ...sessionCookieOptions(req), maxAge: undefined });
  res.json({ ok: true });
}));

authRouter.get('/me', requireAuth, wrap((req, res) => {
  const { user, tenantId: active } = req.auth!;
  const db = getDb();
  const tenants = user.role === 'superadmin'
    ? db.prepare(`SELECT id, name, active FROM tenants ORDER BY name`).all()
    : db.prepare(`SELECT id, name, active FROM tenants WHERE id = ?`).all(user.tenantId);
  const t = active
    ? db.prepare(`SELECT id, name, language, timezone, ai_provider, ai_key FROM tenants WHERE id = ?`).get(active) as any
    : null;
  const activeTenant = t
    ? { id: t.id, name: t.name, language: t.language, timezone: t.timezone, aiProvider: t.ai_provider, aiConfigured: t.ai_provider !== 'none' && Boolean(t.ai_key) }
    : null;
  res.json({
    user: { id: user.id, username: user.username, displayName: user.displayName, role: user.role, totpEnabled: user.totpEnabled },
    tenants: (tenants as any[]).map((t) => ({ id: t.id, name: t.name, active: Boolean(t.active) })),
    activeTenant,
  });
}));

authRouter.post('/active-tenant', requireAuth, requireRole('superadmin'), wrap((req, res) => {
  const id = req.body?.tenantId;
  if (id === null) {
    setActiveTenant(req.auth!.sessionId, null);
    return res.json({ ok: true });
  }
  const tenant = getDb().prepare(`SELECT id FROM tenants WHERE id = ?`).get(Number(id));
  if (!tenant) return res.status(404).json({ error: 'Company not found' });
  setActiveTenant(req.auth!.sessionId, Number(id));
  res.json({ ok: true });
}));

authRouter.post('/password', requireAuth, writeLimiter, wrap((req, res) => {
  const { currentPassword, newPassword } = req.body ?? {};
  const hash = getPasswordHash(req.auth!.user.id);
  if (!hash || typeof currentPassword !== 'string' || !verifyPassword(currentPassword, hash)) {
    return res.status(400).json({ error: 'Current password is incorrect' });
  }
  const weak = validatePasswordStrength(newPassword);
  if (weak) return res.status(400).json({ error: weak });
  setUserPassword(req.auth!.user.id, newPassword);
  /* All sessions are gone, including this one; issue a fresh one. */
  const token = createSession(req.auth!.user);
  res.cookie(SESSION_COOKIE, token, sessionCookieOptions(req));
  res.json({ ok: true });
}));

authRouter.post('/totp/setup', requireAuth, writeLimiter, wrap(async (req, res) => {
  const { user } = req.auth!;
  if (user.totpEnabled) return res.status(409).json({ error: 'Two-factor authentication is already enabled' });
  const secret = startTotpEnrolment(user.id);
  const uri = `otpauth://totp/${encodeURIComponent(`Hacker-Do CyberPulse:${user.username}`)}?secret=${secret}&issuer=${encodeURIComponent('Hacker-Do CyberPulse')}&algorithm=SHA1&digits=6&period=30`;
  const qr = await QRCode.toDataURL(uri, { margin: 1, width: 220 });
  res.json({ secret, uri, qr });
}));

authRouter.post('/totp/enable', requireAuth, writeLimiter, wrap((req, res) => {
  if (!confirmTotpEnrolment(req.auth!.user.id, req.body?.code)) {
    return res.status(400).json({ error: 'Invalid code, check the time on your phone and try again' });
  }
  res.json({ ok: true });
}));

authRouter.post('/totp/disable', requireAuth, writeLimiter, wrap((req, res) => {
  const hash = getPasswordHash(req.auth!.user.id);
  if (!hash || typeof req.body?.password !== 'string' || !verifyPassword(req.body.password, hash)) {
    return res.status(400).json({ error: 'Password is incorrect' });
  }
  disableTotp(req.auth!.user.id);
  res.json({ ok: true });
}));

/* ------------------------------------------------------------------ */
/*  Tenant: tech stack                                                 */
/* ------------------------------------------------------------------ */

/* Mounted behind requireAuth in index.ts. */
export const tenantRouter = express.Router();

function stackRows(tid: number) {
  return (getDb().prepare(
    `SELECT * FROM user_tech_stack WHERE tenant_id = ? ORDER BY technology COLLATE NOCASE, version`
  ).all(tid) as any[]).map((row) => ({
    id: row.id,
    technology: row.technology,
    version: row.version || undefined,
    vendor: row.vendor || undefined,
    category: row.category || undefined,
    createdAt: row.created_at,
  }));
}

tenantRouter.get('/tech-stack', requireTenant, wrap((req, res) => {
  res.json({ stack: stackRows(tenantId(req)) });
}));

tenantRouter.post('/tech-stack', ...requireTenantAdmin, writeLimiter, wrap((req, res) => {
  const technology = str(req.body?.technology, 100);
  if (!technology) return res.status(400).json({ error: 'technology is required (max 100 characters)' });
  const version = optStr(req.body?.version, 100);
  const db = getDb();
  const exists = (db.prepare(`SELECT technology, version FROM user_tech_stack WHERE tenant_id = ?`).all(tenantId(req)) as any[])
    .some((r) => stackKey(r) === stackKey({ technology, version }));
  if (exists) return res.status(409).json({ error: 'That technology and version are already in the stack' });
  const result = db.prepare(
    `INSERT INTO user_tech_stack (tenant_id, technology, version, vendor, category) VALUES (?, ?, ?, ?, ?)`
  ).run(tenantId(req), technology, version, optStr(req.body?.vendor, 100), optStr(req.body?.category, 100));
  const row = db.prepare(`SELECT * FROM user_tech_stack WHERE id = ?`).get(result.lastInsertRowid) as any;
  res.status(201).json({
    item: {
      id: row.id, technology: row.technology, version: row.version || undefined,
      vendor: row.vendor || undefined, category: row.category || undefined, createdAt: row.created_at,
    },
  });
}));

tenantRouter.delete('/tech-stack/:id', ...requireTenantAdmin, writeLimiter, wrap((req, res) => {
  const result = getDb().prepare(`DELETE FROM user_tech_stack WHERE id = ? AND tenant_id = ?`).run(idParam(req), tenantId(req));
  if (result.changes === 0) return res.status(404).json({ error: 'Tech stack item not found' });
  res.json({ success: true });
}));

/* Preview (dryRun: true) and import share one parser, so what the admin sees
   in the preview is exactly what gets written. */
tenantRouter.post('/tech-stack/import', ...requireTenantAdmin, writeLimiter,
  express.text({ type: 'text/csv', limit: CSV_MAX_BYTES + 1024 }),
  wrap((req, res) => {
    const csv = typeof req.body === 'string' ? req.body : req.body?.csv;
    const mode = (req.query.mode ?? req.body?.mode) === 'replace' ? 'replace' : 'append';
    const dryRun = String(req.query.dryRun ?? req.body?.dryRun) === 'true';
    if (typeof csv !== 'string') return res.status(400).json({ error: 'Send the CSV as text/csv or as {"csv": "..."}' });

    const parsed = parseStackCsv(csv);
    const tid = tenantId(req);
    const db = getDb();

    const existing = mode === 'append'
      ? new Set((db.prepare(`SELECT technology, version FROM user_tech_stack WHERE tenant_id = ?`).all(tid) as any[]).map(stackKey))
      : new Set<string>();
    const toInsert = parsed.rows.filter((r) => !existing.has(stackKey(r)));
    const alreadyPresent = parsed.rows.length - toInsert.length;

    const summary = {
      mode,
      valid: parsed.rows.length,
      toInsert: toInsert.length,
      alreadyPresent,
      duplicatesInFile: parsed.duplicates,
      errors: parsed.errors.slice(0, 100),
      errorCount: parsed.errors.length,
      willRemove: mode === 'replace'
        ? (db.prepare(`SELECT COUNT(*) AS c FROM user_tech_stack WHERE tenant_id = ?`).get(tid) as { c: number }).c
        : 0,
      preview: toInsert.slice(0, 200),
    };

    if (dryRun) return res.json({ dryRun: true, ...summary });
    if (parsed.rows.length === 0) {
      return res.status(400).json({ error: 'No valid rows to import', ...summary });
    }

    const insert = db.prepare(`INSERT INTO user_tech_stack (tenant_id, technology, version, vendor, category) VALUES (?, ?, ?, ?, ?)`);
    db.transaction(() => {
      if (mode === 'replace') db.prepare(`DELETE FROM user_tech_stack WHERE tenant_id = ?`).run(tid);
      for (const r of toInsert) insert.run(tid, r.technology, r.version ?? null, r.vendor ?? null, r.category ?? null);
    })();

    res.json({ dryRun: false, imported: toInsert.length, ...summary, preview: undefined });
  }));

tenantRouter.get('/tech-stack/export.csv', requireTenant, wrap((req, res) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="tech-stack.csv"');
  res.send('﻿' + toStackCsv(stackRows(tenantId(req))));
}));

tenantRouter.get('/tech-stack/template.csv', wrap((_req, res) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="tech-stack-template.csv"');
  res.send('﻿' + CSV_TEMPLATE);
}));

/* ------------------------------------------------------------------ */
/*  Tenant: settings (language, timezone, AI provider)                 */
/* ------------------------------------------------------------------ */

function tenantSettings(tid: number) {
  const row = getDb().prepare(`SELECT * FROM tenants WHERE id = ?`).get(tid) as any;
  const key = row.ai_key ? decryptSecret(row.ai_key) : '';
  return {
    id: row.id,
    name: row.name,
    language: row.language,
    timezone: row.timezone,
    ai: {
      provider: row.ai_provider,
      model: row.ai_model || (row.ai_provider === 'openai' ? DEFAULT_OPENAI_MODEL : DEFAULT_ANTHROPIC_MODEL),
      baseUrl: row.ai_base_url || '',
      keySet: Boolean(key),
      keyHint: mask(key),
    },
    options: {
      anthropicModels: ANTHROPIC_MODELS,
      defaultOpenAiModel: DEFAULT_OPENAI_MODEL,
    },
  };
}

tenantRouter.get('/tenant/settings', ...requireTenantAdmin, wrap((req, res) => {
  res.json(tenantSettings(tenantId(req)));
}));

tenantRouter.put('/tenant/settings', ...requireTenantAdmin, writeLimiter, wrap((req, res) => {
  const tid = tenantId(req);
  const body = req.body ?? {};
  const db = getDb();
  const current = db.prepare(`SELECT * FROM tenants WHERE id = ?`).get(tid) as any;

  const language = body.language === undefined ? current.language : body.language;
  if (!['es', 'en'].includes(language)) return res.status(400).json({ error: 'language must be "es" or "en"' });
  const timezone = body.timezone === undefined ? current.timezone : body.timezone;
  if (!isValidTimeZone(timezone)) return res.status(400).json({ error: 'Unknown time zone' });

  const ai = body.ai ?? {};
  const provider = ai.provider === undefined ? current.ai_provider : ai.provider;
  if (!['none', 'anthropic', 'openai'].includes(provider)) return res.status(400).json({ error: 'Unknown AI provider' });

  let model: string | null = ai.model === undefined ? current.ai_model : optStr(ai.model, 100);
  let baseUrl: string | null = ai.baseUrl === undefined ? current.ai_base_url : optStr(ai.baseUrl, 300);
  if (provider === 'anthropic') {
    model = model && (ANTHROPIC_MODELS as readonly string[]).includes(model) ? model : DEFAULT_ANTHROPIC_MODEL;
    baseUrl = null;
  } else if (provider === 'openai') {
    if (model && !/^[a-zA-Z0-9._:-]{1,100}$/.test(model)) return res.status(400).json({ error: 'Invalid model name' });
    model = model || DEFAULT_OPENAI_MODEL;
    if (baseUrl) {
      const v = validateOpenAiBaseUrl(baseUrl);
      if ('error' in v) return res.status(400).json({ error: v.error });
      baseUrl = v.url;
    }
  } else {
    model = null;
    baseUrl = null;
  }

  /* The key is write-only: omitted keeps it, "" clears it. Switching
     provider without a new key clears the old one rather than sending a
     Claude key to OpenAI or the other way round. */
  let aiKey: string | null = current.ai_key;
  if (typeof ai.apiKey === 'string') {
    const k = ai.apiKey.trim();
    if (k.length > 500) return res.status(400).json({ error: 'API key is too long' });
    aiKey = k ? encryptSecret(k) : null;
  } else if (provider !== current.ai_provider) {
    aiKey = null;
  }
  if (provider === 'none') aiKey = null;

  db.prepare(`UPDATE tenants SET language = ?, timezone = ?, ai_provider = ?, ai_model = ?, ai_base_url = ?, ai_key = ? WHERE id = ?`)
    .run(language, timezone, provider, model, baseUrl, aiKey, tid);
  if (timezone !== current.timezone) rescheduleTenant(tid);
  res.json(tenantSettings(tid));
}));

tenantRouter.post('/tenant/ai/test', ...requireTenantAdmin, writeLimiter, wrap(async (req, res) => {
  const cfg = getTenantAiConfig(tenantId(req));
  if (!cfg) return res.status(409).json({ error: 'Save an AI provider and API key first' });
  try {
    const text = await complete(cfg, {
      system: 'You are a connectivity check.',
      prompt: 'Reply with exactly: OK',
      maxTokens: 200,
    });
    res.json({ ok: true, provider: cfg.provider, model: cfg.model, reply: text.slice(0, 50) });
  } catch (err) {
    const e = err instanceof AiError ? err : new AiError('AI request failed');
    res.status(e.status >= 400 && e.status < 600 ? e.status : 502).json({ error: e.message });
  }
}));

/* ------------------------------------------------------------------ */
/*  Tenant: output channels + schedule                                 */
/* ------------------------------------------------------------------ */

function channelOut(row: ChannelRow) {
  const url = decryptSecret(row.webhook_url);
  let host = '';
  try {
    host = new URL(url).host;
  } catch { /* ignore */ }
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    webhookHint: host ? `${host}/…${url.slice(-4)}` : '',
    active: Boolean(row.active),
    schedule: {
      type: row.schedule_type,
      intervalHours: row.interval_hours,
      timeOfDay: row.time_of_day,
      weekdays: parseWeekdays(row.weekdays),
    },
    minSeverity: row.min_severity,
    maxItems: row.max_items,
    useAi: Boolean(row.use_ai),
    header: row.header_text,
    footer: row.footer_text,
    lastRunAt: row.last_run_at,
    lastSentAt: row.last_sent_at,
    nextRunAt: row.next_run_at,
  };
}

interface ChannelInput {
  name: string;
  type: ChannelType;
  webhookUrl?: string;
  active: boolean;
  schedule: Schedule;
  minSeverity: string;
  maxItems: number;
  useAi: boolean;
  header: string | null;
  footer: string | null;
}

export const MAX_HEADER_LENGTH = 150;
export const MAX_FOOTER_LENGTH = 300;

/* header: null/'' = default. footer: null = default, '' = none. */
function parseBranding(body: any, existing?: ChannelRow): { header: string | null; footer: string | null } | { error: string } {
  let header = existing?.header_text ?? null;
  if (body?.header !== undefined) {
    if (body.header !== null && typeof body.header !== 'string') return { error: 'header must be text' };
    const h = (body.header ?? '').replace(/[\r\n]+/g, ' ').trim();
    if (h.length > MAX_HEADER_LENGTH) return { error: `Header can be at most ${MAX_HEADER_LENGTH} characters` };
    header = h || null;
  }
  let footer = existing ? existing.footer_text : null;
  if (body?.footer !== undefined) {
    if (body.footer !== null && typeof body.footer !== 'string') return { error: 'footer must be text' };
    if (body.footer === null) footer = null;
    else {
      const lines = body.footer.split(/\r?\n/).map((l: string) => l.trim()).filter(Boolean);
      if (lines.length > 3) return { error: 'Footer can have at most 3 lines' };
      const f = lines.join('\n');
      if (f.length > MAX_FOOTER_LENGTH) return { error: `Footer can be at most ${MAX_FOOTER_LENGTH} characters` };
      footer = f;
    }
  }
  return { header, footer };
}

function parseChannelInput(body: any, existing?: ChannelRow): { value: ChannelInput } | { error: string } {
  const name = str(body?.name, 80) ?? existing?.name;
  if (!name) return { error: 'Name is required (max 80 characters)' };
  const type = (body?.type ?? existing?.type) as ChannelType;
  if (type !== 'slack' && type !== 'rocketchat') return { error: 'type must be "slack" or "rocketchat"' };

  let webhookUrl: string | undefined;
  if (body?.webhookUrl !== undefined && body.webhookUrl !== '') {
    const v = validateWebhookUrl(type, body.webhookUrl);
    if ('error' in v) return { error: v.error };
    webhookUrl = v.url.toString();
  } else if (!existing) {
    return { error: 'Webhook URL is required' };
  } else if (type !== existing.type) {
    return { error: 'Changing the channel type needs a new webhook URL' };
  }

  const s = body?.schedule ?? (existing ? {
    type: existing.schedule_type, intervalHours: existing.interval_hours,
    timeOfDay: existing.time_of_day, weekdays: parseWeekdays(existing.weekdays),
  } : undefined);
  if (!s) return { error: 'schedule is required' };
  const schedule: Schedule = {
    type: s.type,
    intervalHours: s.type === 'interval' ? Number(s.intervalHours) : null,
    timeOfDay: s.type === 'weekly' ? s.timeOfDay : null,
    weekdays: s.type === 'weekly' && Array.isArray(s.weekdays) ? [...new Set<number>(s.weekdays.map(Number))].sort() : null,
  };
  const schedErr = validateSchedule(schedule);
  if (schedErr) return { error: schedErr };

  const minSeverity = body?.minSeverity ?? existing?.min_severity ?? 'medium';
  if (!(SEVERITIES as readonly string[]).includes(minSeverity)) return { error: 'Unknown severity' };
  const maxItems = Number(body?.maxItems ?? existing?.max_items ?? 15);
  if (!Number.isInteger(maxItems) || maxItems < 1 || maxItems > 50) return { error: 'maxItems must be 1-50' };

  const branding = parseBranding(body, existing);
  if ('error' in branding) return { error: branding.error };

  return {
    value: {
      name, type, webhookUrl, schedule, minSeverity, maxItems, ...branding,
      active: body?.active === undefined ? (existing ? Boolean(existing.active) : true) : Boolean(body.active),
      useAi: body?.useAi === undefined ? (existing ? Boolean(existing.use_ai) : true) : Boolean(body.useAi),
    },
  };
}

function getChannel(req: express.Request): ChannelRow | undefined {
  return getDb().prepare(`SELECT * FROM channels WHERE id = ? AND tenant_id = ?`).get(idParam(req), tenantId(req)) as ChannelRow | undefined;
}

const MAX_CHANNELS_PER_TENANT = 20;

tenantRouter.get('/channels', ...requireTenantAdmin, wrap((req, res) => {
  const rows = getDb().prepare(`SELECT * FROM channels WHERE tenant_id = ? ORDER BY name`).all(tenantId(req)) as ChannelRow[];
  res.json({ channels: rows.map(channelOut) });
}));

tenantRouter.post('/channels', ...requireTenantAdmin, writeLimiter, wrap((req, res) => {
  const parsed = parseChannelInput(req.body);
  if ('error' in parsed) return res.status(400).json({ error: parsed.error });
  const v = parsed.value;
  const db = getDb();
  const count = (db.prepare(`SELECT COUNT(*) AS c FROM channels WHERE tenant_id = ?`).get(tenantId(req)) as { c: number }).c;
  if (count >= MAX_CHANNELS_PER_TENANT) return res.status(409).json({ error: `A company can have at most ${MAX_CHANNELS_PER_TENANT} channels` });
  const result = db.prepare(`
    INSERT INTO channels (tenant_id, name, type, webhook_url, active, schedule_type, interval_hours, time_of_day, weekdays, min_severity, max_items, use_ai, header_text, footer_text)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    tenantId(req), v.name, v.type, encryptSecret(v.webhookUrl!), v.active ? 1 : 0,
    v.schedule.type, v.schedule.intervalHours, v.schedule.timeOfDay, v.schedule.weekdays?.join(',') ?? null,
    v.minSeverity, v.maxItems, v.useAi ? 1 : 0, v.header, v.footer,
  );
  const id = Number(result.lastInsertRowid);
  rescheduleChannel(id);
  res.status(201).json({ channel: channelOut(db.prepare(`SELECT * FROM channels WHERE id = ?`).get(id) as ChannelRow) });
}));

tenantRouter.put('/channels/:id', ...requireTenantAdmin, writeLimiter, wrap((req, res) => {
  const existing = getChannel(req);
  if (!existing) return res.status(404).json({ error: 'Channel not found' });
  const parsed = parseChannelInput(req.body, existing);
  if ('error' in parsed) return res.status(400).json({ error: parsed.error });
  const v = parsed.value;
  const db = getDb();
  db.prepare(`
    UPDATE channels SET name = ?, type = ?, webhook_url = ?, active = ?, schedule_type = ?, interval_hours = ?,
      time_of_day = ?, weekdays = ?, min_severity = ?, max_items = ?, use_ai = ?, header_text = ?, footer_text = ?
    WHERE id = ? AND tenant_id = ?
  `).run(
    v.name, v.type, v.webhookUrl ? encryptSecret(v.webhookUrl) : existing.webhook_url, v.active ? 1 : 0,
    v.schedule.type, v.schedule.intervalHours, v.schedule.timeOfDay, v.schedule.weekdays?.join(',') ?? null,
    v.minSeverity, v.maxItems, v.useAi ? 1 : 0, v.header, v.footer, existing.id, tenantId(req),
  );
  rescheduleChannel(existing.id);
  res.json({ channel: channelOut(db.prepare(`SELECT * FROM channels WHERE id = ?`).get(existing.id) as ChannelRow) });
}));

tenantRouter.delete('/channels/:id', ...requireTenantAdmin, writeLimiter, wrap((req, res) => {
  const result = getDb().prepare(`DELETE FROM channels WHERE id = ? AND tenant_id = ?`).run(idParam(req), tenantId(req));
  if (result.changes === 0) return res.status(404).json({ error: 'Channel not found' });
  res.json({ success: true });
}));

const sendLimiter = rateLimit({
  windowMs: 60_000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many manual sends, wait a minute.' },
});

tenantRouter.post('/channels/:id/test', ...requireTenantAdmin, sendLimiter, wrap(async (req, res) => {
  const channel = getChannel(req);
  if (!channel) return res.status(404).json({ error: 'Channel not found' });
  try {
    await sendTestMessage(channel);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(502).json({ error: err instanceof WebhookError ? err.message : 'Webhook request failed' });
  }
}));

tenantRouter.post('/channels/:id/run', ...requireTenantAdmin, sendLimiter, wrap(async (req, res) => {
  const channel = getChannel(req);
  if (!channel) return res.status(404).json({ error: 'Channel not found' });
  const result = await runChannel(channel.id, 'manual');
  res.status(result.status === 'error' ? 502 : 200).json(result);
}));

tenantRouter.get('/channels/:id/deliveries', ...requireTenantAdmin, wrap((req, res) => {
  const channel = getChannel(req);
  if (!channel) return res.status(404).json({ error: 'Channel not found' });
  const rows = getDb().prepare(
    `SELECT id, trigger, status, article_count AS articleCount, detail, created_at AS createdAt
     FROM deliveries WHERE channel_id = ? ORDER BY id DESC LIMIT 50`
  ).all(channel.id);
  res.json({ deliveries: rows });
}));

/* ------------------------------------------------------------------ */
/*  Tenant: users                                                      */
/* ------------------------------------------------------------------ */

function userOut(r: any) {
  return {
    id: r.id,
    username: r.username,
    displayName: r.display_name,
    role: r.role as Role,
    active: Boolean(r.active),
    totpEnabled: Boolean(r.totp_enabled),
    lastLoginAt: r.last_login_at,
    createdAt: r.created_at,
  };
}

tenantRouter.get('/users', ...requireTenantAdmin, wrap((req, res) => {
  const rows = getDb().prepare(`SELECT * FROM users WHERE tenant_id = ? ORDER BY username`).all(tenantId(req));
  res.json({ users: rows.map(userOut) });
}));

tenantRouter.post('/users', ...requireTenantAdmin, writeLimiter, wrap((req, res) => {
  const { username, password, role, displayName } = req.body ?? {};
  if (typeof username !== 'string' || !USERNAME_RE.test(username)) {
    return res.status(400).json({ error: 'Username: 3-64 characters, letters, digits and . _ @ -' });
  }
  if (role !== 'admin' && role !== 'member') return res.status(400).json({ error: 'role must be admin or member' });
  const weak = validatePasswordStrength(password);
  if (weak) return res.status(400).json({ error: weak });
  try {
    const id = createUser({ username, password, role, tenantId: tenantId(req), displayName: optStr(displayName, 80) });
    res.status(201).json({ user: userOut(getDb().prepare(`SELECT * FROM users WHERE id = ?`).get(id)) });
  } catch (err: any) {
    if (String(err?.message).includes('UNIQUE')) return res.status(409).json({ error: 'That username is taken' });
    throw err;
  }
}));

function getTenantUser(req: express.Request): any {
  return getDb().prepare(`SELECT * FROM users WHERE id = ? AND tenant_id = ?`).get(idParam(req), tenantId(req));
}

function wouldRemoveLastAdmin(tid: number, userId: number): boolean {
  const c = getDb().prepare(
    `SELECT COUNT(*) AS c FROM users WHERE tenant_id = ? AND role = 'admin' AND active = 1 AND id <> ?`
  ).get(tid, userId) as { c: number };
  return c.c === 0;
}

tenantRouter.patch('/users/:id', ...requireTenantAdmin, writeLimiter, wrap((req, res) => {
  const user = getTenantUser(req);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const { role, active, displayName, password, resetTotp } = req.body ?? {};
  const db = getDb();
  const isSelf = user.id === req.auth!.user.id;

  if (role !== undefined) {
    if (role !== 'admin' && role !== 'member') return res.status(400).json({ error: 'role must be admin or member' });
    if (role === 'member' && user.role === 'admin' && wouldRemoveLastAdmin(user.tenant_id, user.id) && req.auth!.user.role !== 'superadmin') {
      return res.status(409).json({ error: 'A company needs at least one active admin' });
    }
  }
  if (active === false && isSelf) return res.status(409).json({ error: 'You cannot disable your own account' });
  if (active === false && user.role === 'admin' && wouldRemoveLastAdmin(user.tenant_id, user.id) && req.auth!.user.role !== 'superadmin') {
    return res.status(409).json({ error: 'A company needs at least one active admin' });
  }
  if (password !== undefined) {
    const weak = validatePasswordStrength(password);
    if (weak) return res.status(400).json({ error: weak });
  }

  db.transaction(() => {
    if (role !== undefined) db.prepare(`UPDATE users SET role = ? WHERE id = ?`).run(role, user.id);
    if (active !== undefined) {
      db.prepare(`UPDATE users SET active = ? WHERE id = ?`).run(active ? 1 : 0, user.id);
      if (!active) db.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(user.id);
    }
    if (displayName !== undefined) db.prepare(`UPDATE users SET display_name = ? WHERE id = ?`).run(optStr(displayName, 80), user.id);
    if (resetTotp === true) disableTotp(user.id);
  })();
  if (password !== undefined) setUserPassword(user.id, password);

  res.json({ user: userOut(db.prepare(`SELECT * FROM users WHERE id = ?`).get(user.id)) });
}));

tenantRouter.delete('/users/:id', ...requireTenantAdmin, writeLimiter, wrap((req, res) => {
  const user = getTenantUser(req);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.id === req.auth!.user.id) return res.status(409).json({ error: 'You cannot delete your own account' });
  if (user.role === 'admin' && wouldRemoveLastAdmin(user.tenant_id, user.id) && req.auth!.user.role !== 'superadmin') {
    return res.status(409).json({ error: 'A company needs at least one active admin' });
  }
  getDb().prepare(`DELETE FROM users WHERE id = ?`).run(user.id);
  res.json({ success: true });
}));

/* ------------------------------------------------------------------ */
/*  Superadmin: companies                                              */
/* ------------------------------------------------------------------ */

export const adminRouter = express.Router();
adminRouter.use(requireAuth, requireRole('superadmin'));

function tenantSummary(id?: number) {
  const sql = `
    SELECT t.id, t.name, t.language, t.timezone, t.active, t.ai_provider, t.created_at,
      (SELECT COUNT(*) FROM users u WHERE u.tenant_id = t.id) AS users,
      (SELECT COUNT(*) FROM user_tech_stack s WHERE s.tenant_id = t.id) AS stack,
      (SELECT COUNT(*) FROM channels c WHERE c.tenant_id = t.id) AS channels
    FROM tenants t ${id ? 'WHERE t.id = ?' : ''} ORDER BY t.name`;
  const rows = (id ? getDb().prepare(sql).all(id) : getDb().prepare(sql).all()) as any[];
  return rows.map((r) => ({
    id: r.id, name: r.name, language: r.language, timezone: r.timezone, active: Boolean(r.active),
    aiProvider: r.ai_provider, createdAt: r.created_at,
    counts: { users: r.users, stack: r.stack, channels: r.channels },
  }));
}

adminRouter.get('/tenants', wrap((_req, res) => {
  res.json({ tenants: tenantSummary() });
}));

/* Creates the company and, optionally, its first admin in one step. */
adminRouter.post('/tenants', writeLimiter, wrap((req, res) => {
  const name = str(req.body?.name, 100);
  if (!name) return res.status(400).json({ error: 'Company name is required (max 100 characters)' });
  const language = req.body?.language ?? 'es';
  if (!['es', 'en'].includes(language)) return res.status(400).json({ error: 'language must be "es" or "en"' });
  const timezone = req.body?.timezone ?? 'Europe/Madrid';
  if (!isValidTimeZone(timezone)) return res.status(400).json({ error: 'Unknown time zone' });

  const admin = req.body?.admin;
  if (admin) {
    if (typeof admin.username !== 'string' || !USERNAME_RE.test(admin.username)) {
      return res.status(400).json({ error: 'Admin username: 3-64 characters, letters, digits and . _ @ -' });
    }
    const weak = validatePasswordStrength(admin.password);
    if (weak) return res.status(400).json({ error: `Admin password: ${weak}` });
  }

  const db = getDb();
  try {
    const id = db.transaction(() => {
      const t = db.prepare(`INSERT INTO tenants (name, language, timezone) VALUES (?, ?, ?)`).run(name, language, timezone);
      const tid = Number(t.lastInsertRowid);
      if (admin) createUser({ username: admin.username, password: admin.password, role: 'admin', tenantId: tid, displayName: optStr(admin.displayName, 80) });
      return tid;
    })();
    res.status(201).json({ tenant: tenantSummary(id)[0] });
  } catch (err: any) {
    if (String(err?.message).includes('UNIQUE')) {
      return res.status(409).json({ error: String(err.message).includes('users.username') ? 'That admin username is taken' : 'A company with that name already exists' });
    }
    throw err;
  }
}));

adminRouter.patch('/tenants/:id', writeLimiter, wrap((req, res) => {
  const id = idParam(req);
  const db = getDb();
  if (!db.prepare(`SELECT id FROM tenants WHERE id = ?`).get(id)) return res.status(404).json({ error: 'Company not found' });
  const { name, active } = req.body ?? {};
  try {
    if (name !== undefined) {
      const n = str(name, 100);
      if (!n) return res.status(400).json({ error: 'Company name is required (max 100 characters)' });
      db.prepare(`UPDATE tenants SET name = ? WHERE id = ?`).run(n, id);
    }
  } catch (err: any) {
    if (String(err?.message).includes('UNIQUE')) return res.status(409).json({ error: 'A company with that name already exists' });
    throw err;
  }
  if (active !== undefined) {
    db.prepare(`UPDATE tenants SET active = ? WHERE id = ?`).run(active ? 1 : 0, id);
    if (!active) db.prepare(`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE tenant_id = ?)`).run(id);
  }
  res.json({ tenant: tenantSummary(id)[0] });
}));

/* Irreversible: cascades to users, stack, channels and delivery history.
   The caller must repeat the company name. */
adminRouter.delete('/tenants/:id', writeLimiter, wrap((req, res) => {
  const id = idParam(req);
  const db = getDb();
  const row = db.prepare(`SELECT name FROM tenants WHERE id = ?`).get(id) as { name: string } | undefined;
  if (!row) return res.status(404).json({ error: 'Company not found' });
  if (typeof req.body?.confirmName !== 'string' || req.body.confirmName.trim().toLowerCase() !== row.name.toLowerCase()) {
    return res.status(400).json({ error: 'Type the company name to confirm' });
  }
  db.prepare(`DELETE FROM tenants WHERE id = ?`).run(id);
  res.json({ success: true });
}));
