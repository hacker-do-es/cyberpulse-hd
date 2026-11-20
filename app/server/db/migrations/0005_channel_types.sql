-- Rebuilds channels to widen the type CHECK (telegram, discord, linkedin).
-- The PRAGMAs below are no-ops inside the migrator transaction; client.ts
-- turns foreign keys off around migrations so the rebuild does not
-- cascade into deliveries / channel_sent_articles.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_channels` (
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
	`header_html` text,
	`footer_html` text,
	`last_run_at` text,
	`last_sent_at` text,
	`next_run_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "channels_type_check" CHECK("__new_channels"."type" IN ('slack', 'rocketchat', 'email', 'telegram', 'discord', 'linkedin')),
	CONSTRAINT "channels_schedule_type_check" CHECK("__new_channels"."schedule_type" IN ('interval', 'weekly'))
);
--> statement-breakpoint
INSERT INTO `__new_channels`("id", "tenant_id", "name", "type", "webhook_url", "active", "schedule_type", "interval_hours", "time_of_day", "weekdays", "min_severity", "max_items", "use_ai", "header_text", "footer_text", "header_html", "footer_html", "last_run_at", "last_sent_at", "next_run_at", "created_at") SELECT "id", "tenant_id", "name", "type", "webhook_url", "active", "schedule_type", "interval_hours", "time_of_day", "weekdays", "min_severity", "max_items", "use_ai", "header_text", "footer_text", "header_html", "footer_html", "last_run_at", "last_sent_at", "next_run_at", "created_at" FROM `channels`;--> statement-breakpoint
DROP TABLE `channels`;--> statement-breakpoint
ALTER TABLE `__new_channels` RENAME TO `channels`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_channels_tenant` ON `channels` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_channels_next_run` ON `channels` (`next_run_at`);