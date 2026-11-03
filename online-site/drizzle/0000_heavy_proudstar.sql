CREATE TABLE `stock_adjustments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`adjust_date` text NOT NULL,
	`product_id` integer NOT NULL,
	`type` text NOT NULL,
	`quantity` real NOT NULL,
	`notes` text DEFAULT '',
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "adjustments_type" CHECK("stock_adjustments"."type" IN ('Return','Damage','Loss','Manual Add','Manual Minus'))
);
--> statement-breakpoint
CREATE TABLE `customers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`mobile` text DEFAULT '',
	`address` text DEFAULT '',
	`opening_due` real DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `app_meta` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `company_orders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`order_date` text NOT NULL,
	`product_id` integer NOT NULL,
	`quantity` real NOT NULL,
	`bag_weight` real DEFAULT 50 NOT NULL,
	`rate` real NOT NULL,
	`total_amount` real NOT NULL,
	`status` text NOT NULL,
	`delivery_date` text DEFAULT '',
	`invoice_no` text DEFAULT '',
	`notes` text DEFAULT '',
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "orders_status" CHECK("company_orders"."status" IN ('Pending','Confirmed','Delivered'))
);
--> statement-breakpoint
CREATE TABLE `customer_payments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`payment_date` text NOT NULL,
	`customer_id` integer NOT NULL,
	`amount` real NOT NULL,
	`account` text NOT NULL,
	`notes` text DEFAULT '',
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "payments_account" CHECK("customer_payments"."account" IN ('Cash','Bank'))
);
--> statement-breakpoint
CREATE TABLE `products` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`product_code` text DEFAULT '' NOT NULL,
	`bag_weight` real DEFAULT 50 NOT NULL,
	`opening_stock` real DEFAULT 0 NOT NULL,
	`default_rate` real DEFAULT 0 NOT NULL,
	`low_stock_level` real DEFAULT 10 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `products_name_unique` ON `products` (`name`);--> statement-breakpoint
CREATE TABLE `sales` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`sale_date` text NOT NULL,
	`customer_id` integer NOT NULL,
	`product_id` integer NOT NULL,
	`quantity` real NOT NULL,
	`rate` real NOT NULL,
	`total_amount` real NOT NULL,
	`paid_amount` real DEFAULT 0 NOT NULL,
	`account` text NOT NULL,
	`notes` text DEFAULT '',
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "sales_account" CHECK("sales"."account" IN ('Cash','Bank'))
);
--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`txn_date` text NOT NULL,
	`type` text NOT NULL,
	`amount` real NOT NULL,
	`account` text NOT NULL,
	`notes` text DEFAULT '',
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "transactions_account" CHECK("transactions"."account" IN ('Cash','Bank')),
	CONSTRAINT "transactions_type" CHECK("transactions"."type" IN ('Company Payment','Expense','Transport Cost','Other Income','Other Expense','Bank Deposit','Bank Withdraw'))
);
