CREATE TABLE `linkedin_queue` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` integer NOT NULL,
	`channel_id` integer,
	`created_by` integer,
	`author_user_id` integer NOT NULL,
	`author` text NOT NULL,
	`author_label` text,
	`text` text NOT NULL,
	`articles` text,
	`status` text NOT NULL,
	`scheduled_for` text,
	`decided_by` integer,
	`decided_at` text,
	`published_at` text,
	`post_urn` text,
	`error` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`author_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`decided_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_linkedin_queue_tenant` ON `linkedin_queue` (`tenant_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_linkedin_queue_due` ON `linkedin_queue` (`status`,`scheduled_for`);--> statement-breakpoint
CREATE INDEX `idx_linkedin_queue_channel` ON `linkedin_queue` (`channel_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `channels` ADD `li_user_id` integer REFERENCES users(id) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `channels` ADD `li_author` text;--> statement-breakpoint
ALTER TABLE `channels` ADD `post_format` text;--> statement-breakpoint
ALTER TABLE `channels` ADD `post_tone` text;--> statement-breakpoint
ALTER TABLE `channels` ADD `post_length` text;--> statement-breakpoint
ALTER TABLE `channels` ADD `post_language` text;--> statement-breakpoint
ALTER TABLE `channels` ADD `posts_per_run` integer;--> statement-breakpoint
ALTER TABLE `channels` ADD `max_posts_per_day` integer;--> statement-breakpoint
ALTER TABLE `channels` ADD `require_approval` integer;