CREATE TABLE `cve_records` (
	`cve_id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`data` text,
	`fetched_at` text NOT NULL,
	`nvd_fetched_at` text,
	`error` text
);
--> statement-breakpoint
CREATE INDEX `idx_cve_records_fetched` ON `cve_records` (`fetched_at`);--> statement-breakpoint
ALTER TABLE `channels` ADD `verified_only` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `stack_item_assets` ADD `version` text;--> statement-breakpoint
ALTER TABLE `stack_item_assets` ADD `source` text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE `stack_item_assets` ADD `last_seen_at` text;--> statement-breakpoint
ALTER TABLE `stack_item_assets` ADD `updated_at` text;--> statement-breakpoint
ALTER TABLE `user_tech_stack` ADD `cpe` text;