CREATE TABLE `app_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ts` text NOT NULL,
	`level` text NOT NULL,
	`source` text NOT NULL,
	`kind` text NOT NULL,
	`message` text NOT NULL,
	`user_id` integer,
	`username` text,
	`tenant_id` integer,
	`ip` text
);
--> statement-breakpoint
CREATE INDEX `idx_app_logs_ts` ON `app_logs` (`ts`);--> statement-breakpoint
CREATE INDEX `idx_app_logs_source` ON `app_logs` (`source`,`ts`);