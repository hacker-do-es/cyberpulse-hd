CREATE TABLE `linkedin_page_accounts` (
	`user_id` integer PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`name` text,
	`picture_url` text,
	`access_token` text NOT NULL,
	`scope` text,
	`expires_at` text NOT NULL,
	`connected_at` text DEFAULT CURRENT_TIMESTAMP,
	`organizations` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `linkedin_accounts` ADD `organizations` text;--> statement-breakpoint
ALTER TABLE `linkedin_posts` ADD `author` text;