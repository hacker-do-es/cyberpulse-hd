PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_users` (
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
	CONSTRAINT "users_role_check" CHECK("__new_users"."role" IN ('superadmin', 'support', 'admin', 'operator', 'member')),
	CONSTRAINT "users_tenant_check" CHECK(("__new_users"."role" IN ('superadmin', 'support') AND "__new_users"."tenant_id" IS NULL) OR ("__new_users"."role" NOT IN ('superadmin', 'support') AND "__new_users"."tenant_id" IS NOT NULL))
);
--> statement-breakpoint
INSERT INTO `__new_users`("id", "tenant_id", "username", "display_name", "password_hash", "role", "totp_secret", "totp_enabled", "totp_last_step", "active", "failed_logins", "locked_until", "last_login_at", "created_at") SELECT "id", "tenant_id", "username", "display_name", "password_hash", "role", "totp_secret", "totp_enabled", "totp_last_step", "active", "failed_logins", "locked_until", "last_login_at", "created_at" FROM `users`;--> statement-breakpoint
DROP TABLE `users`;--> statement-breakpoint
ALTER TABLE `__new_users` RENAME TO `users`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_nocase` ON `users` (lower("username"));--> statement-breakpoint
CREATE INDEX `idx_users_tenant` ON `users` (`tenant_id`);