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
  createdAt: text('created_at').default(now),
}, (t) => [index('idx_tech_stack_tenant').on(t.tenantId)]);

export const CHANNEL_TYPES = ['slack', 'rocketchat'] as const;
export type ChannelType = (typeof CHANNEL_TYPES)[number];
export const SCHEDULE_TYPES = ['interval', 'weekly'] as const;

export const channels = sqliteTable('channels', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  tenantId: integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  type: text('type', { enum: CHANNEL_TYPES }).notNull(),
  /* Encrypted at rest (AES-256-GCM, see lib/crypto.ts). */
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
  lastRunAt: text('last_run_at'),
  lastSentAt: text('last_sent_at'),
  nextRunAt: text('next_run_at'),
  createdAt: text('created_at').default(now),
}, (t) => [
  index('idx_channels_tenant').on(t.tenantId),
  index('idx_channels_next_run').on(t.nextRunAt),
  check('channels_type_check', sql`${t.type} IN ('slack', 'rocketchat')`),
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
export type NewChannel = typeof channels.$inferInsert;
export type DeliveryRow = typeof deliveries.$inferSelect;
