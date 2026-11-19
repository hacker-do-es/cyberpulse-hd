CREATE TABLE `articles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`summary` text,
	`source` text NOT NULL,
	`severity` text DEFAULT 'medium',
	`category` text DEFAULT 'GENERAL',
	`published_at` text,
	`publish_date` text,
	`read_time` text,
	`url` text NOT NULL,
	`fetched_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE UNIQUE INDEX `articles_url_unique` ON `articles` (`url`);--> statement-breakpoint
CREATE INDEX `idx_articles_source` ON `articles` (`source`);--> statement-breakpoint
CREATE INDEX `idx_articles_fetched` ON `articles` (`fetched_at`);--> statement-breakpoint
CREATE INDEX `idx_articles_published` ON `articles` (`published_at`);--> statement-breakpoint
CREATE INDEX `idx_articles_severity` ON `articles` (`severity`);--> statement-breakpoint
CREATE TABLE `channel_sent_articles` (
	`channel_id` integer NOT NULL,
	`article_id` integer NOT NULL,
	`sent_at` text DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY(`channel_id`, `article_id`),
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_channel_sent_at` ON `channel_sent_articles` (`sent_at`);--> statement-breakpoint
CREATE TABLE `channels` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` integer NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`webhook_url` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`schedule_type` text DEFAULT 'weekly' NOT NULL,
	`interval_hours` integer,
	`time_of_day` text,
	`weekdays` text,
	`min_severity` text DEFAULT 'medium' NOT NULL,
	`max_items` integer DEFAULT 15 NOT NULL,
	`use_ai` integer DEFAULT true NOT NULL,
	`header_text` text,
	`footer_text` text,
	`last_run_at` text,
	`last_sent_at` text,
	`next_run_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "channels_type_check" CHECK("channels"."type" IN ('slack', 'rocketchat')),
	CONSTRAINT "channels_schedule_type_check" CHECK("channels"."schedule_type" IN ('interval', 'weekly'))
);
--> statement-breakpoint
CREATE INDEX `idx_channels_tenant` ON `channels` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_channels_next_run` ON `channels` (`next_run_at`);--> statement-breakpoint
CREATE TABLE `deliveries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`channel_id` integer NOT NULL,
	`tenant_id` integer NOT NULL,
	`trigger` text DEFAULT 'schedule' NOT NULL,
	`status` text NOT NULL,
	`article_count` integer DEFAULT 0 NOT NULL,
	`detail` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "deliveries_status_check" CHECK("deliveries"."status" IN ('sent', 'skipped', 'error'))
);
--> statement-breakpoint
CREATE INDEX `idx_deliveries_channel` ON `deliveries` (`channel_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `fetch_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source` text,
	`articles_found` integer DEFAULT 0 NOT NULL,
	`articles_new` integer DEFAULT 0 NOT NULL,
	`error` text,
	`fetched_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE INDEX `idx_fetch_log_fetched` ON `fetch_log` (`fetched_at`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`active_tenant_id` integer,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`active_tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_sessions_user` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_sessions_expires` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `sources` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`rss_url` text NOT NULL,
	`category` text DEFAULT 'GENERAL',
	`active` integer DEFAULT true NOT NULL,
	`article_count` integer DEFAULT 0 NOT NULL,
	`last_fetch` text,
	`custom` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sources_name_unique` ON `sources` (`name`);--> statement-breakpoint
CREATE TABLE `user_tech_stack` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` integer NOT NULL,
	`technology` text NOT NULL,
	`version` text,
	`vendor` text,
	`category` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_tech_stack_tenant` ON `user_tech_stack` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `tenants` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`timezone` text DEFAULT 'Europe/Madrid' NOT NULL,
	`language` text DEFAULT 'es' NOT NULL,
	`ai_provider` text DEFAULT 'none' NOT NULL,
	`ai_model` text,
	`ai_key` text,
	`ai_base_url` text,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT "tenants_ai_provider_check" CHECK("tenants"."ai_provider" IN ('none', 'anthropic', 'openai')),
	CONSTRAINT "tenants_language_check" CHECK("tenants"."language" IN ('en', 'es'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tenants_name_nocase` ON `tenants` (lower("name"));--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` integer,
	`username` text NOT NULL,
	`display_name` text,
	`password_hash` text NOT NULL,
	`role` text NOT NULL,
	`totp_secret` text,
	`totp_enabled` integer DEFAULT false NOT NULL,
	`totp_last_step` integer,
	`active` integer DEFAULT true NOT NULL,
	`failed_logins` integer DEFAULT 0 NOT NULL,
	`locked_until` text,
	`last_login_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "users_role_check" CHECK("users"."role" IN ('superadmin', 'admin', 'member')),
	CONSTRAINT "users_tenant_check" CHECK(("users"."role" = 'superadmin' AND "users"."tenant_id" IS NULL) OR ("users"."role" <> 'superadmin' AND "users"."tenant_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_nocase` ON `users` (lower("username"));--> statement-breakpoint
CREATE INDEX `idx_users_tenant` ON `users` (`tenant_id`);