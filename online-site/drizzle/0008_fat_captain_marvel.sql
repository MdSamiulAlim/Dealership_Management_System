CREATE TABLE `app_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer
);
--> statement-breakpoint
CREATE INDEX `app_session_expiry` ON `app_sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `login_rate_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `login_limit_expiry` ON `login_rate_limits` (`expires_at`);--> statement-breakpoint
ALTER TABLE `transactions` ADD `transfer_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `transaction_transfer_account` ON `transactions` (`transfer_id`,`account`);