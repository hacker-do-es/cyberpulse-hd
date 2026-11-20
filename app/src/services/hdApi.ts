/* Client for the multitenant endpoints (auth, company settings, channels,
   users, companies). Same-origin cookie session + CSRF header on writes. */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ErrorBody = Record<string, any>;

export class ApiError extends Error {
  status: number;
  data: ErrorBody;
  constructor(message: string, status: number, data: ErrorBody) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

async function call<T>(method: string, url: string, body?: unknown, opts: { raw?: string; contentType?: string } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (method !== 'GET') headers['X-Requested-With'] = 'cyberpulse';
  let payload: BodyInit | undefined;
  if (opts.raw !== undefined) {
    payload = opts.raw;
    headers['Content-Type'] = opts.contentType ?? 'text/plain';
  } else if (body !== undefined) {
    payload = JSON.stringify(body);
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(url, { method, headers, body: payload, credentials: 'same-origin' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data?.error || data?.detail || `Request failed (${res.status})`, res.status, data);
  return data as T;
}

/* ------------------------------------------------------------------ */
/*  Auth                                                               */
/* ------------------------------------------------------------------ */

export type Role = 'superadmin' | 'admin' | 'member';

export interface Me {
  user: { id: number; username: string; displayName: string | null; role: Role; totpEnabled: boolean };
  tenants: Array<{ id: number; name: string; active: boolean }>;
  activeTenant: null | {
    id: number;
    name: string;
    language: 'es' | 'en';
    timezone: string;
    aiProvider: 'none' | 'anthropic' | 'openai';
    aiConfigured: boolean;
  };
}

export const authApi = {
  me: () => call<Me>('GET', '/api/auth/me'),
  login: (username: string, password: string, totp?: string) =>
    call<{ ok: true }>('POST', '/api/auth/login', { username, password, totp }),
  logout: () => call<{ ok: true }>('POST', '/api/auth/logout'),
  setActiveTenant: (tenantId: number | null) => call<{ ok: true }>('POST', '/api/auth/active-tenant', { tenantId }),
  changePassword: (currentPassword: string, newPassword: string) =>
    call<{ ok: true }>('POST', '/api/auth/password', { currentPassword, newPassword }),
  totpSetup: () => call<{ secret: string; uri: string; qr: string }>('POST', '/api/auth/totp/setup'),
  totpEnable: (code: string) => call<{ ok: true }>('POST', '/api/auth/totp/enable', { code }),
  totpDisable: (password: string) => call<{ ok: true }>('POST', '/api/auth/totp/disable', { password }),
};

/* ------------------------------------------------------------------ */
/*  Tech stack CSV                                                     */
/* ------------------------------------------------------------------ */

export interface ImportSummary {
  dryRun: boolean;
  mode: 'append' | 'replace';
  valid: number;
  toInsert: number;
  alreadyPresent: number;
  duplicatesInFile: number;
  errors: Array<{ line: number; message: string }>;
  errorCount: number;
  willRemove: number;
  preview?: Array<{ technology: string; version?: string; vendor?: string; category?: string }>;
  imported?: number;
}

export const stackApi = {
  importCsv: (csv: string, mode: 'append' | 'replace', dryRun: boolean) =>
    call<ImportSummary>('POST', `/api/tech-stack/import?mode=${mode}&dryRun=${dryRun}`, undefined, { raw: csv, contentType: 'text/csv' }),
};

/* ------------------------------------------------------------------ */
/*  Company settings                                                   */
/* ------------------------------------------------------------------ */

export interface TenantSettings {
  id: number;
  name: string;
  language: 'es' | 'en';
  timezone: string;
  ai: { provider: 'none' | 'anthropic' | 'openai'; model: string; baseUrl: string; keySet: boolean; keyHint: string };
  options: { anthropicModels: string[]; defaultOpenAiModel: string };
}

export interface TenantSettingsUpdate {
  language?: string;
  timezone?: string;
  ai?: { provider?: string; model?: string; baseUrl?: string; apiKey?: string };
}

export const settingsApi = {
  get: () => call<TenantSettings>('GET', '/api/tenant/settings'),
  update: (u: TenantSettingsUpdate) => call<TenantSettings>('PUT', '/api/tenant/settings', u),
  testAi: () => call<{ ok: true; provider: string; model: string; reply: string }>('POST', '/api/tenant/ai/test'),
};

/* ------------------------------------------------------------------ */
/*  Channels                                                           */
/* ------------------------------------------------------------------ */

export type Severity = 'low' | 'medium' | 'high' | 'critical';

export interface ChannelSchedule {
  type: 'interval' | 'weekly';
  intervalHours: number | null;
  timeOfDay: string | null;
  weekdays: number[];
}

export type ChannelType = 'slack' | 'rocketchat' | 'discord' | 'telegram' | 'email';
export type SmtpSecurity = 'tls' | 'starttls';

export interface SmtpSettings {
  host: string;
  port: number;
  security: SmtpSecurity;
  user: string;
  fromAddress: string;
  fromName: string;
}

export interface Channel {
  id: number;
  name: string;
  type: ChannelType;
  webhookHint: string;
  /** Email channels only; the SMTP password is never returned. */
  email: { recipients: string[]; smtp: SmtpSettings & { passwordSet: boolean } } | null;
  /** Telegram channels only; the bot token is never returned. */
  telegram: { chatId: string; botId: string; tokenSet: true } | null;
  active: boolean;
  schedule: ChannelSchedule;
  minSeverity: Severity;
  maxItems: number;
  useAi: boolean;
  /** Custom digest header; null = default. */
  header: string | null;
  /** Custom digest footer; null = default, '' = no footer. */
  footer: string | null;
  /** Email only: sanitised header HTML; null = default. */
  headerHtml: string | null;
  /** Email only: sanitised footer HTML; null = default, '' = none. */
  footerHtml: string | null;
  lastRunAt: string | null;
  lastSentAt: string | null;
  nextRunAt: string | null;
}

export interface ChannelInput {
  name: string;
  type: ChannelType;
  webhookUrl?: string;
  /** Telegram: empty botToken on update = keep the stored one. */
  telegram?: { botToken?: string; chatId: string };
  recipients?: string[];
  /** Empty password on update = keep the stored one. */
  smtp?: SmtpSettings & { password?: string };
  headerHtml?: string | null;
  footerHtml?: string | null;
  active: boolean;
  schedule: ChannelSchedule;
  minSeverity: Severity;
  maxItems: number;
  useAi: boolean;
  header?: string | null;
  footer?: string | null;
}

export interface Delivery {
  id: number;
  trigger: 'schedule' | 'manual';
  status: 'sent' | 'skipped' | 'error';
  articleCount: number;
  detail: string;
  createdAt: string;
}

export const channelsApi = {
  list: () => call<{ channels: Channel[] }>('GET', '/api/channels').then((r) => r.channels),
  create: (c: ChannelInput) => call<{ channel: Channel }>('POST', '/api/channels', c).then((r) => r.channel),
  update: (id: number, c: ChannelInput) => call<{ channel: Channel }>('PUT', `/api/channels/${id}`, c).then((r) => r.channel),
  remove: (id: number) => call<{ success: true }>('DELETE', `/api/channels/${id}`),
  test: (id: number) => call<{ ok: true }>('POST', `/api/channels/${id}/test`),
  run: (id: number) => call<{ status: string; articleCount: number; detail: string }>('POST', `/api/channels/${id}/run`),
  deliveries: (id: number) => call<{ deliveries: Delivery[] }>('GET', `/api/channels/${id}/deliveries`).then((r) => r.deliveries),
  previewEmail: (b: { header: string | null; headerHtml: string | null; footerHtml: string | null }) =>
    call<{ html: string }>('POST', '/api/channels/preview-email', b).then((r) => r.html),
};

/* ------------------------------------------------------------------ */
/*  Users (within the active company)                                  */
/* ------------------------------------------------------------------ */

export interface TenantUser {
  id: number;
  username: string;
  displayName: string | null;
  role: 'admin' | 'member';
  active: boolean;
  totpEnabled: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export const usersApi = {
  list: () => call<{ users: TenantUser[] }>('GET', '/api/users').then((r) => r.users),
  create: (u: { username: string; password: string; role: 'admin' | 'member'; displayName?: string }) =>
    call<{ user: TenantUser }>('POST', '/api/users', u).then((r) => r.user),
  update: (id: number, u: Partial<{ role: 'admin' | 'member'; active: boolean; displayName: string; password: string; resetTotp: boolean }>) =>
    call<{ user: TenantUser }>('PATCH', `/api/users/${id}`, u).then((r) => r.user),
  remove: (id: number) => call<{ success: true }>('DELETE', `/api/users/${id}`),
};

/* ------------------------------------------------------------------ */
/*  Companies (superadmin)                                             */
/* ------------------------------------------------------------------ */

export interface TenantSummary {
  id: number;
  name: string;
  language: string;
  timezone: string;
  active: boolean;
  aiProvider: string;
  createdAt: string;
  counts: { users: number; stack: number; channels: number };
}

export const adminApi = {
  list: () => call<{ tenants: TenantSummary[] }>('GET', '/api/admin/tenants').then((r) => r.tenants),
  create: (t: { name: string; language: string; timezone: string; admin?: { username: string; password: string; displayName?: string } }) =>
    call<{ tenant: TenantSummary }>('POST', '/api/admin/tenants', t).then((r) => r.tenant),
  update: (id: number, t: { name?: string; active?: boolean }) =>
    call<{ tenant: TenantSummary }>('PATCH', `/api/admin/tenants/${id}`, t).then((r) => r.tenant),
  remove: (id: number, confirmName: string) => call<{ success: true }>('DELETE', `/api/admin/tenants/${id}`, { confirmName }),
};

/* ------------------------------------------------------------------ */
/*  LinkedIn publishing (per user)                                     */
/* ------------------------------------------------------------------ */

export interface LinkedInOrganization {
  urn: string;
  name: string | null;
  role: string;
}

export interface LinkedInConnection {
  connected: boolean;
  expired: boolean;
  expiresAt: string | null;
}

/* 'main' = own profile (or both, with a single LinkedIn app); 'pages' = the
   separate Community Management app for Company Pages. */
export type LinkedInApp = 'main' | 'pages';

export interface LinkedInStatus {
  configured: boolean;
  /* The server can post as the member (main app). */
  memberPosting: boolean;
  /* Company Pages use their own app and connection (pagesConnection). */
  pagesApp: boolean;
  pagesConnection: LinkedInConnection | null;
  /* The server asks for Company Page permissions (Community Management). */
  orgPosting: boolean;
  connected: boolean;
  canPostAsMember: boolean;
  canPostAsOrganization: boolean;
  organizations: LinkedInOrganization[];
  expired: boolean;
  name: string | null;
  pictureUrl: string | null;
  expiresAt: string | null;
  maxChars: number;
}

export const linkedinApi = {
  status: () => call<LinkedInStatus>('GET', '/api/linkedin'),
  /* Full-page navigation: LinkedIn's consent screen, then back to the app. */
  connectUrl: (returnTo: 'generate' | 'account', app: LinkedInApp = 'main') => `/api/linkedin/connect?return=${returnTo}&app=${app}`,
  disconnect: (app: LinkedInApp = 'main') => call<{ success: true }>('DELETE', `/api/linkedin?app=${app}`),
  /* author: 'member' or a Page URN from status.organizations. */
  publish: (text: string, author: string) => call<{ urn: string; url: string }>('POST', '/api/linkedin/posts', { text, author }),
  refreshOrganizations: () => call<{ organizations: LinkedInOrganization[] }>('POST', '/api/linkedin/organizations/refresh'),
};

/* ------------------------------------------------------------------ */
/*  Application log (superadmin)                                       */
/* ------------------------------------------------------------------ */

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEntry {
  id: number;
  ts: string;
  level: LogLevel;
  source: string;
  kind: 'app' | 'audit';
  message: string;
  userId: number | null;
  username: string | null;
  tenantId: number | null;
  ip: string | null;
}

export interface LogFilter {
  level?: LogLevel[];
  source?: string[];
  kind?: 'app' | 'audit' | '';
  q?: string;
  from?: string;
  to?: string;
}

export function logQuery(f: LogFilter, extra: Record<string, string | number | undefined> = {}): string {
  const p = new URLSearchParams();
  if (f.level?.length) p.set('level', f.level.join(','));
  if (f.source?.length) p.set('source', f.source.join(','));
  if (f.kind) p.set('kind', f.kind);
  if (f.q?.trim()) p.set('q', f.q.trim());
  if (f.from) p.set('from', f.from);
  if (f.to) p.set('to', f.to);
  for (const [k, v] of Object.entries(extra)) if (v !== undefined) p.set(k, String(v));
  return p.toString();
}

export const logsApi = {
  list: (f: LogFilter, page: { before?: number; after?: number; limit?: number } = {}) =>
    call<{ entries: LogEntry[]; hasMore: boolean; total: number }>('GET', `/api/admin/logs?${logQuery(f, page)}`),
  sources: () => call<{ sources: Array<{ source: string; n: number }> }>('GET', '/api/admin/logs/sources').then((r) => r.sources),
  exportUrl: (f: LogFilter) => `/api/admin/logs/export.txt?${logQuery(f)}`,
};
