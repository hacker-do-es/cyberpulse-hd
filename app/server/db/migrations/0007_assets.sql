CREATE TABLE `assets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` integer NOT NULL,
	`name` text NOT NULL,
	`type` text DEFAULT 'other' NOT NULL,
	`criticality` text DEFAULT 'medium' NOT NULL,
	`environment` text,
	`hostname` text,
	`ip` text,
	`brand` text,
	`model` text,
	`owner` text,
	`notes` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "assets_type_check" CHECK("assets"."type" IN ('server', 'workstation', 'laptop', 'network', 'firewall', 'cloud', 'saas', 'application', 'database', 'mobile', 'iot', 'other')),
	CONSTRAINT "assets_criticality_check" CHECK("assets"."criticality" IN ('low', 'medium', 'high'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_assets_tenant_name` ON `assets` (`tenant_id`,"name" COLLATE NOCASE);--> statement-breakpoint
CREATE TABLE `stack_item_assets` (
	`stack_item_id` integer NOT NULL,
	`asset_id` integer NOT NULL,
	PRIMARY KEY(`stack_item_id`, `asset_id`),
	FOREIGN KEY (`stack_item_id`) REFERENCES `user_tech_stack`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_stack_item_assets_asset` ON `stack_item_assets` (`asset_id`);--> statement-breakpoint
ALTER TABLE `channels` ADD `include_assets` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `channels` ADD `min_asset_criticality` text;