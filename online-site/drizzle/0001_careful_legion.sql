CREATE TABLE `invoice_items` (
	`id` text PRIMARY KEY NOT NULL,
	`invoice_id` text NOT NULL,
	`sale_id` integer NOT NULL,
	`product_id` integer NOT NULL,
	`product_name` text NOT NULL,
	`product_code` text DEFAULT '' NOT NULL,
	`quantity` real NOT NULL,
	`rate` real NOT NULL,
	`line_total` real NOT NULL,
	`returned_quantity` real DEFAULT 0 NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_items_sale_id_unique` ON `invoice_items` (`sale_id`);--> statement-breakpoint
CREATE TABLE `invoice_returns` (
	`id` text PRIMARY KEY NOT NULL,
	`invoice_id` text NOT NULL,
	`return_date` text NOT NULL,
	`credit` real NOT NULL,
	`refund` real NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`items_json` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `invoices` (
	`id` text PRIMARY KEY NOT NULL,
	`invoice_no` text NOT NULL,
	`sale_date` text NOT NULL,
	`customer_id` integer NOT NULL,
	`subtotal` real NOT NULL,
	`discount` real DEFAULT 0 NOT NULL,
	`total_amount` real NOT NULL,
	`paid_amount` real DEFAULT 0 NOT NULL,
	`account` text NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`returned_total` real DEFAULT 0 NOT NULL,
	`refunded` real DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`last_op` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "invoice_account" CHECK("invoices"."account" IN ('Cash','Bank')),
	CONSTRAINT "invoice_status" CHECK("invoices"."status" IN ('active','void'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invoices_invoice_no_unique` ON `invoices` (`invoice_no`);--> statement-breakpoint
CREATE TABLE `sync_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`payload_hash` text NOT NULL,
	`entity` text NOT NULL,
	`result_id` text,
	`changed` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE `transactions` ADD `category` text DEFAULT 'General' NOT NULL;--> statement-breakpoint
ALTER TABLE `transactions` ADD `reference` text DEFAULT '' NOT NULL;