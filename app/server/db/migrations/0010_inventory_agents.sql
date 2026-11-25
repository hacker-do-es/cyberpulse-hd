CREATE TABLE `inventory_tokens` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` integer NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`prefix` text NOT NULL,
	`created_by` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`expires_at` text,
	`last_used_at` text,
	`last_used_ip` text,
	`revoked_at` text,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_tokens_token_hash_unique` ON `inventory_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_inventory_tokens_tenant` ON `inventory_tokens` (`tenant_id`);--> statement-breakpoint
ALTER TABLE `assets` ADD `agent_id` text;--> statement-breakpoint
ALTER TABLE `assets` ADD `agent_version` text;--> statement-breakpoint
ALTER TABLE `assets` ADD `os_name` text;--> statement-breakpoint
ALTER TABLE `assets` ADD `os_version` text;--> statement-breakpoint
ALTER TABLE `assets` ADD `last_report_at` text;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_assets_tenant_agent` ON `assets` (`tenant_id`,`agent_id`);--> statement-breakpoint
ALTER TABLE `stack_item_assets` ADD `package` text;--> statement-breakpoint
ALTER TABLE `stack_item_assets` ADD `osv_cves` text;--> statement-breakpoint
ALTER TABLE `stack_item_assets` ADD `osv_checked_at` text;--> statement-breakpoint
ALTER TABLE `stack_item_assets` ADD `missing_count` integer DEFAULT 0 NOT NULL;