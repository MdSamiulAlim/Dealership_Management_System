CREATE TABLE `backup_jobs` (
	`day` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`lease_token` text NOT NULL,
	`lease_until` integer NOT NULL,
	`backup_id` text,
	`attempts` integer DEFAULT 1 NOT NULL,
	`updated_at` text NOT NULL,
	`error` text DEFAULT '' NOT NULL
);
