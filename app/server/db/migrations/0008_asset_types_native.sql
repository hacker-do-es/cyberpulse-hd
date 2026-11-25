PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_assets` (
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
	CONSTRAINT "assets_type_check" CHECK("__new_assets"."type" IN ('server', 'workstation', 'laptop', 'network', 'firewall', 'cloud', 'saas', 'application', 'database', 'mobile', 'iot', 'identity', 'monitoring', 'cicd', 'automation', 'siem', 'vpn', 'dns', 'proxy', 'security', 'other')),
	CONSTRAINT "assets_criticality_check" CHECK("__new_assets"."criticality" IN ('low', 'medium', 'high'))
);
--> statement-breakpoint
INSERT INTO `__new_assets`("id", "tenant_id", "name", "type", "criticality", "environment", "hostname", "ip", "brand", "model", "owner", "notes", "created_at", "updated_at") SELECT "id", "tenant_id", "name", "type", "criticality", "environment", "hostname", "ip", "brand", "model", "owner", "notes", "created_at", "updated_at" FROM `assets`;--> statement-breakpoint
DROP TABLE `assets`;--> statement-breakpoint
ALTER TABLE `__new_assets` RENAME TO `assets`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_assets_tenant_name` ON `assets` (`tenant_id`,"name" COLLATE NOCASE);