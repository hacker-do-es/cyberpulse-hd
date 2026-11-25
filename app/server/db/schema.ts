import { sql } from 'drizzle-orm';
import { sqliteTable, integer, text, index, uniqueIndex, primaryKey, check } from 'drizzle-orm/sqlite-core';

/* Single source of truth for the database structure. Changes here are turned
   into SQL migrations with `npm run db:generate` (drizzle-kit) and applied on
   startup by server/db/migrate.ts.

   Timestamps are stored as SQLite UTC text ("YYYY-MM-DD HH:MM:SS"), which is
   what CURRENT_TIMESTAMP and datetime() produce, so SQL comparisons and the
   scheduler's toSqlUtc() agree. */

const now = sql`CURRENT_TIMESTAMP`;

/* ------------------------------------------------------------------ */
/*  Shared news corpus                                                 */
/* ------------------------------------------------------------------ */

export const articles = sqliteTable('articles', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  summary: text('summary'),
  source: text('source').notNull(),
  severity: text('severity').default('medium'),
  category: text('category').default('GENERAL'),
  publishedAt: text('published_at'),
  publishDate: text('publish_date'),
  readTime: text('read_time'),
  url: text('url').notNull().unique(),
  fetchedAt: text('fetched_at').default(now),
}, (t) => [
  index('idx_articles_source').on(t.source),
  index('idx_articles_fetched').on(t.fetchedAt),
  index('idx_articles_published').on(t.publishedAt),
  index('idx_articles_severity').on(t.severity),
]);

export const sources = sqliteTable('sources', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  rssUrl: text('rss_url').notNull(),
  category: text('category').default('GENERAL'),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  articleCount: integer('article_count').notNull().default(0),
  lastFetch: text('last_fetch'),
  custom: integer('custom', { mode: 'boolean' }).notNull().default(false),
});

export const fetchLog = sqliteTable('fetch_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  source: text('source'),
  articlesFound: integer('articles_found').notNull().default(0),
  articlesNew: integer('articles_new').notNull().default(0),
  error: text('error'),
  fetchedAt: text('fetched_at').default(now),
}, (t) => [index('idx_fetch_log_fetched').on(t.fetchedAt)]);

/* ------------------------------------------------------------------ */
/*  Companies, users, sessions                                         */
/* ------------------------------------------------------------------ */

export const AI_PROVIDERS = ['none', 'anthropic', 'openai'] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

export const tenants = sqliteTable('tenants', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  timezone: text('timezone').notNull().default('Europe/Madrid'),
  language: text('language', { enum: ['en', 'es'] }).notNull().default('es'),
  aiProvider: text('ai_provider', { enum: AI_PROVIDERS }).notNull().default('none'),
  aiModel: text('ai_model'),
  aiKey: text('ai_key'),
  aiBaseUrl: text('ai_base_url'),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').default(now),
}, (t) => [
  /* Company names are unique regardless of case ("Acme" = "acme"). */
  uniqueIndex('tenants_name_nocase').on(sql`lower(${t.name})`),
  check('tenants_ai_provider_check', sql`${t.aiProvider} IN ('none', 'anthropic', 'openai')`),
  check('tenants_language_check', sql`${t.language} IN ('en', 'es')`),
]);

export const ROLES = ['superadmin', 'admin', 'member'] as const;
export type Role = (typeof ROLES)[number];

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  username: text('username').notNull(),
  displayName: text('display_name'),
  passwordHash: text('password_hash').notNull(),
  role: text('role', { enum: ROLES }).notNull(),
  totpSecret: text('totp_secret'),
  totpEnabled: integer('totp_enabled', { mode: 'boolean' }).notNull().default(false),
  totpLastStep: integer('totp_last_step'),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  failedLogins: integer('failed_logins').notNull().default(0),
  lockedUntil: text('locked_until'),
  lastLoginAt: text('last_login_at'),
  createdAt: text('created_at').default(now),
}, (t) => [
  /* Usernames are unique and matched regardless of case. */
  uniqueIndex('users_username_nocase').on(sql`lower(${t.username})`),
  index('idx_users_tenant').on(t.tenantId),
  check('users_role_check', sql`${t.role} IN ('superadmin', 'admin', 'member')`),
  /* A superadmin belongs to no company; everyone else to exactly one. */
  check('users_tenant_check', sql`(${t.role} = 'superadmin' AND ${t.tenantId} IS NULL) OR (${t.role} <> 'superadmin' AND ${t.tenantId} IS NOT NULL)`),
]);

export const sessions = sqliteTable('sessions', {
  /* SHA-256 of the cookie token; the token itself is never stored. */
  id: text('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  activeTenantId: integer('active_tenant_id').references(() => tenants.id, { onDelete: 'set null' }),
  expiresAt: text('expires_at').notNull(),
  createdAt: text('created_at').default(now),
}, (t) => [
  index('idx_sessions_user').on(t.userId),
  index('idx_sessions_expires').on(t.expiresAt),
]);

/* ------------------------------------------------------------------ */
/*  Per-company data                                                   */
/* ------------------------------------------------------------------ */

export const techStack = sqliteTable('user_tech_stack', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  tenantId: integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  technology: text('technology').notNull(),
  version: text('version'),
  vendor: text('vendor'),
  category: text('category'),
  /* Optional "vendor:product" as CVE records name it (e.g. "f5:nginx"),
     for when the technology's name alone does not identify the product. */
  cpe: text('cpe'),
  createdAt: text('created_at').default(now),
}, (t) => [index('idx_tech_stack_tenant').on(t.tenantId)]);

/* Client assets (servers, firewalls, SaaS, apps…) per company. Stack rows
   link to the assets that run them, so a news match can say which of the
   client's assets it affects. Asset names are sensitive (they map the
   client's attack surface): they are never sent to the AI provider nor to
   LinkedIn, and digests only include them on channels that opt in. */
export const ASSET_TYPES = ['server', 'workstation', 'laptop', 'network', 'firewall', 'cloud', 'saas', 'application', 'database', 'mobile', 'iot', 'identity', 'monitoring', 'cicd', 'automation', 'siem', 'vpn', 'dns', 'proxy', 'security', 'other'] as const;
export type AssetType = (typeof ASSET_TYPES)[number];
export const ASSET_CRITICALITIES = ['low', 'medium', 'high'] as const;
export type AssetCriticality = (typeof ASSET_CRITICALITIES)[number];

export const assets = sqliteTable('assets', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  tenantId: integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  type: text('type', { enum: ASSET_TYPES }).notNull().default('other'),
  criticality: text('criticality', { enum: ASSET_CRITICALITIES }).notNull().default('medium'),
  environment: text('environment'),
  hostname: text('hostname'),
  ip: text('ip'),
  brand: text('brand'),
  model: text('model'),
  owner: text('owner'),
  notes: text('notes'),
  createdAt: text('created_at').default(now),
  updatedAt: text('updated_at').default(now),
  /* Inventory agent (F2): sha256 of the host's machine id, so a renamed
     host is still the same asset; what it last reported and when. */
  agentId: text('agent_id'),
  agentVersion: text('agent_version'),
  osName: text('os_name'),
  osVersion: text('os_version'),
  lastReportAt: text('last_report_at'),
}, (t) => [
  uniqueIndex('idx_assets_tenant_agent').on(t.tenantId, t.agentId),
  uniqueIndex('idx_assets_tenant_name').on(t.tenantId, sql`${t.name} COLLATE NOCASE`),
  check('assets_type_check', sql`${t.type} IN ('server', 'workstation', 'laptop', 'network', 'firewall', 'cloud', 'saas', 'application', 'database', 'mobile', 'iot', 'identity', 'monitoring', 'cicd', 'automation', 'siem', 'vpn', 'dns', 'proxy', 'security', 'other')`),
  check('assets_criticality_check', sql`${t.criticality} IN ('low', 'medium', 'high')`),
]);

/* Which assets run each stack row (many to many, same company). */
export const SOFTWARE_SOURCES = ['manual', 'csv', 'script', 'github'] as const;
export type SoftwareSource = (typeof SOFTWARE_SOURCES)[number];

/* Which assets run each stack row (many to many, same company), and the
   version installed on that asset. NULL version = the stack row's own. */
export const stackItemAssets = sqliteTable('stack_item_assets', {
  stackItemId: integer('stack_item_id').notNull().references(() => techStack.id, { onDelete: 'cascade' }),
  assetId: integer('asset_id').notNull().references(() => assets.id, { onDelete: 'cascade' }),
  version: text('version'),
  source: text('source').notNull().default('manual'),
  lastSeenAt: text('last_seen_at'),
  /* No default: SQLite cannot ADD COLUMN with CURRENT_TIMESTAMP; set by code. */
  updatedAt: text('updated_at'),
  /* Agent-reported distro package ("Debian:13|openssh" = OSV ecosystem and
     source package), checked against OSV, which knows the distro's
     backported fixes; osvCves = CVE ids OSV says affect this exact package
     version. missingCount = consecutive agent reports without it. */
  package: text('package'),
  osvCves: text('osv_cves'),
  osvCheckedAt: text('osv_checked_at'),
  missingCount: integer('missing_count').notNull().default(0),
}, (t) => [
  primaryKey({ columns: [t.stackItemId, t.assetId] }),
  index('idx_stack_item_assets_asset').on(t.assetId),
]);

export const CHANNEL_TYPES = ['slack', 'rocketchat', 'email', 'telegram', 'discord', 'linkedin'] as const;
export type ChannelType = (typeof CHANNEL_TYPES)[number];
export const SCHEDULE_TYPES = ['interval', 'weekly'] as const;

export const channels = sqliteTable('channels', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  tenantId: integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  type: text('type', { enum: CHANNEL_TYPES }).notNull(),
  /* Encrypted at rest (AES-256-GCM, see lib/crypto.ts). Slack/Rocket.Chat/
     Discord: the webhook URL. Email: JSON with the recipients and the
     channel's own SMTP settings, password included (services/mail/target.ts).
     Telegram: JSON {botToken, chatId} (services/webhooks/telegram.ts). */
  webhookUrl: text('webhook_url').notNull(),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  scheduleType: text('schedule_type', { enum: SCHEDULE_TYPES }).notNull().default('weekly'),
  intervalHours: integer('interval_hours'),
  timeOfDay: text('time_of_day'),
  /* Comma-separated 0-6 (Sunday = 0). */
  weekdays: text('weekdays'),
  minSeverity: text('min_severity').notNull().default('medium'),
  maxItems: integer('max_items').notNull().default(15),
  useAi: integer('use_ai', { mode: 'boolean' }).notNull().default(true),
  /* NULL = default text; empty footer = no footer. */
  headerText: text('header_text'),
  footerText: text('footer_text'),
  /* Email only, sanitised HTML. NULL = default; empty footer = no footer. */
  headerHtml: text('header_html'),
  footerHtml: text('footer_html'),
  lastRunAt: text('last_run_at'),
  lastSentAt: text('last_sent_at'),
  nextRunAt: text('next_run_at'),
  createdAt: text('created_at').default(now),
  /* LinkedIn channels only: whose connection publishes, as whom
     ('member' or urn:li:organization:N), how posts are written, how many,
     and whether a person approves each post first. */
  liUserId: integer('li_user_id').references(() => users.id, { onDelete: 'set null' }),
  liAuthor: text('li_author'),
  postFormat: text('post_format'),
  postTone: text('post_tone'),
  postLength: text('post_length'),
  postLanguage: text('post_language'),
  postsPerRun: integer('posts_per_run'),
  maxPostsPerDay: integer('max_posts_per_day'),
  requireApproval: integer('require_approval', { mode: 'boolean' }),
  /* Digest channels only (never LinkedIn): list the affected assets under
     each news item, and optionally only send news that affects an asset at
     or above this criticality (NULL = any news matching the stack). */
  includeAssets: integer('include_assets', { mode: 'boolean' }).notNull().default(false),
  minAssetCriticality: text('min_asset_criticality'),
  /* Digest channels only: send just the news whose CVE is confirmed to
     affect the installed version of an asset or stack row. */
  verifiedOnly: integer('verified_only', { mode: 'boolean' }).notNull().default(true),
}, (t) => [
  index('idx_channels_tenant').on(t.tenantId),
  index('idx_channels_next_run').on(t.nextRunAt),
  check('channels_type_check', sql`${t.type} IN ('slack', 'rocketchat', 'email', 'telegram', 'discord', 'linkedin')`),
  check('channels_schedule_type_check', sql`${t.scheduleType} IN ('interval', 'weekly')`),
]);

export const DELIVERY_STATUSES = ['sent', 'skipped', 'error'] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export const deliveries = sqliteTable('deliveries', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  channelId: integer('channel_id').notNull().references(() => channels.id, { onDelete: 'cascade' }),
  tenantId: integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  trigger: text('trigger').notNull().default('schedule'),
  status: text('status', { enum: DELIVERY_STATUSES }).notNull(),
  articleCount: integer('article_count').notNull().default(0),
  detail: text('detail'),
  createdAt: text('created_at').default(now),
}, (t) => [
  index('idx_deliveries_channel').on(t.channelId, t.createdAt),
  check('deliveries_status_check', sql`${t.status} IN ('sent', 'skipped', 'error')`),
]);

/* Which articles a channel already delivered, so none is ever repeated. */
export const channelSentArticles = sqliteTable('channel_sent_articles', {
  channelId: integer('channel_id').notNull().references(() => channels.id, { onDelete: 'cascade' }),
  articleId: integer('article_id').notNull(),
  sentAt: text('sent_at').default(now),
}, (t) => [
  primaryKey({ columns: [t.channelId, t.articleId] }),
  index('idx_channel_sent_at').on(t.sentAt),
]);

/* ------------------------------------------------------------------ */
/*  Row types                                                          */
/* ------------------------------------------------------------------ */

export type ArticleRow = typeof articles.$inferSelect;
export type NewArticle = typeof articles.$inferInsert;
export type SourceRow = typeof sources.$inferSelect;
export type TenantRow = typeof tenants.$inferSelect;
export type UserRow = typeof users.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
export type StackRow = typeof techStack.$inferSelect;
export type ChannelRow = typeof channels.$inferSelect;
export type AssetRow = typeof assets.$inferSelect;
export type NewChannel = typeof channels.$inferInsert;
export type DeliveryRow = typeof deliveries.$inferSelect;

/* ------------------------------------------------------------------ */
/*  LinkedIn publishing (per user)                                     */
/* ------------------------------------------------------------------ */

/* One connected LinkedIn member per CyberPulse user. The access token is
   encrypted at rest (lib/crypto.ts) and never returned by the API. */
export const linkedinAccounts = sqliteTable('linkedin_accounts', {
  userId: integer('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  /* OpenID Connect `sub`: the member id used in urn:li:person:<id>. */
  memberId: text('member_id').notNull(),
  name: text('name'),
  pictureUrl: text('picture_url'),
  accessToken: text('access_token').notNull(),
  scope: text('scope'),
  expiresAt: text('expires_at').notNull(),
  connectedAt: text('connected_at').default(now),
  /* JSON [{urn,name,role}]: Company Pages the member can post as
     (Community Management only); null = not looked up. */
  organizations: text('organizations'),
});

export type LinkedinAccountRow = typeof linkedinAccounts.$inferSelect;

/* Second connection per user when Company Pages use their own LinkedIn app
   (Community Management only; see config.ts). Same shape as above. */
export const linkedinPageAccounts = sqliteTable('linkedin_page_accounts', {
  userId: integer('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  /* From the Page roles (that app has no OpenID); may be empty. */
  memberId: text('member_id').notNull(),
  name: text('name'),
  pictureUrl: text('picture_url'),
  accessToken: text('access_token').notNull(),
  scope: text('scope'),
  expiresAt: text('expires_at').notNull(),
  connectedAt: text('connected_at').default(now),
  organizations: text('organizations'),
});

/* Audit trail: who published what, from which company. */
export const linkedinPosts = sqliteTable('linkedin_posts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'set null' }),
  postUrn: text('post_urn').notNull(),
  /* urn:li:person:… or urn:li:organization:… (null on rows before 0003). */
  author: text('author'),
  chars: integer('chars').notNull(),
  createdAt: text('created_at').default(now),
}, (t) => [index('idx_linkedin_posts_user').on(t.userId, t.createdAt)]);

/* ------------------------------------------------------------------ */
/*  Application log (superadmin "Logs" tab)                            */
/* ------------------------------------------------------------------ */

/* Server log lines plus audit events, kept 14 days / 50k rows
   (services/logs/logStore.ts). Messages are redacted before insert. */
export const appLogs = sqliteTable('app_logs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  /* ISO 8601 UTC with milliseconds, e.g. 2026-11-20T14:05:01.123Z */
  ts: text('ts').notNull(),
  level: text('level', { enum: ['info', 'warn', 'error'] }).notNull(),
  /* Leading [TAG] of the line (SCRAPER, DIGEST, ...), AUDIT, or APP. */
  source: text('source').notNull(),
  kind: text('kind', { enum: ['app', 'audit'] }).notNull(),
  message: text('message').notNull(),
  userId: integer('user_id'),
  username: text('username'),
  tenantId: integer('tenant_id'),
  ip: text('ip'),
}, (t) => [index('idx_app_logs_ts').on(t.ts), index('idx_app_logs_source').on(t.source, t.ts)]);

export type AppLogRow = typeof appLogs.$inferSelect;

/* ------------------------------------------------------------------ */
/*  LinkedIn publishing queue                                          */
/* ------------------------------------------------------------------ */

/* Posts waiting for approval or for their time, from a LinkedIn channel or
   scheduled by hand in Generate Post; published ones stay as history.
   pending → (approve) scheduled → publishing → published | failed;
   pending → rejected; pending/scheduled → cancelled. */
export const LINKEDIN_QUEUE_STATUSES = ['pending', 'scheduled', 'publishing', 'published', 'failed', 'rejected', 'cancelled'] as const;
export type LinkedinQueueStatus = (typeof LINKEDIN_QUEUE_STATUSES)[number];

export const linkedinQueue = sqliteTable('linkedin_queue', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  tenantId: integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  /* NULL for posts scheduled by hand. */
  channelId: integer('channel_id').references(() => channels.id, { onDelete: 'set null' }),
  createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
  /* Whose LinkedIn connection publishes it. */
  authorUserId: integer('author_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  /* 'member' or urn:li:organization:N, and its display name at the time. */
  author: text('author').notNull(),
  authorLabel: text('author_label'),
  text: text('text').notNull(),
  /* JSON [{id,title,url}] the post is about. */
  articles: text('articles'),
  status: text('status', { enum: LINKEDIN_QUEUE_STATUSES }).notNull(),
  /* UTC 'YYYY-MM-DD HH:MM:SS'; NULL while pending approval. */
  scheduledFor: text('scheduled_for'),
  decidedBy: integer('decided_by').references(() => users.id, { onDelete: 'set null' }),
  decidedAt: text('decided_at'),
  publishedAt: text('published_at'),
  postUrn: text('post_urn'),
  error: text('error'),
  createdAt: text('created_at').default(now),
}, (t) => [
  index('idx_linkedin_queue_tenant').on(t.tenantId, t.status),
  index('idx_linkedin_queue_due').on(t.status, t.scheduledFor),
  index('idx_linkedin_queue_channel').on(t.channelId, t.createdAt),
]);

export type LinkedinQueueRow = typeof linkedinQueue.$inferSelect;


/* ------------------------------------------------------------------ */
/*  CVE data (shared, cached)                                          */
/* ------------------------------------------------------------------ */

/* What CVE.org (the CNA's record) and NVD (CPE configurations) say about
   which product versions a CVE affects, normalised (services/vuln). Shared
   by every company; refreshed by the vuln job. */
export const cveRecords = sqliteTable('cve_records', {
  cveId: text('cve_id').primaryKey(),
  /* ok = fetched (possibly without product data yet), not_found, error */
  status: text('status').notNull(),
  /* JSON: { products: AffectedProduct[], cvss: number | null } */
  data: text('data'),
  fetchedAt: text('fetched_at').notNull(),
  nvdFetchedAt: text('nvd_fetched_at'),
  error: text('error'),
}, (t) => [index('idx_cve_records_fetched').on(t.fetchedAt)]);

export type CveRecordRow = typeof cveRecords.$inferSelect;

/* ------------------------------------------------------------------ */
/*  Inventory agents                                                   */
/* ------------------------------------------------------------------ */

/* Per-company tokens the inventory agents use to report. Only the sha256
   is stored; the token is shown once when created. Scope: inventory write. */
export const inventoryTokens = sqliteTable('inventory_tokens', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  tenantId: integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  /* First characters, to recognise the token in lists ("cpi_AbC1…"). */
  prefix: text('prefix').notNull(),
  createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: text('created_at').default(now),
  expiresAt: text('expires_at'),
  lastUsedAt: text('last_used_at'),
  lastUsedIp: text('last_used_ip'),
  revokedAt: text('revoked_at'),
}, (t) => [index('idx_inventory_tokens_tenant').on(t.tenantId)]);

export type InventoryTokenRow = typeof inventoryTokens.$inferSelect;
