CREATE TABLE `linkedin_accounts` (
	`user_id` integer PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`name` text,
	`picture_url` text,
	`access_token` text NOT NULL,
	`scope` text,
	`expires_at` text NOT NULL,
	`connected_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `linkedin_posts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`tenant_id` integer,
	`post_urn` text NOT NULL,
	`chars` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_linkedin_posts_user` ON `linkedin_posts` (`user_id`,`created_at`);