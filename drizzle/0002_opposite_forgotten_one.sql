CREATE TABLE `party_packages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(80) NOT NULL,
	`description` varchar(400),
	`price_cents` int NOT NULL,
	`duration_minutes` int NOT NULL DEFAULT 120,
	`guests` int NOT NULL DEFAULT 10,
	`active` boolean NOT NULL DEFAULT true,
	`created_at` bigint NOT NULL,
	CONSTRAINT `party_packages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `purchases` (
	`id` int AUTO_INCREMENT NOT NULL,
	`supplier` varchar(120) NOT NULL,
	`invoice_number` varchar(40),
	`invoice_date` varchar(10) NOT NULL,
	`category` varchar(40) NOT NULL DEFAULT 'Otros',
	`description` varchar(300),
	`total_cents` int NOT NULL,
	`paid_at` bigint,
	`method` enum('efectivo_usd','efectivo_bs','pago_movil','punto','zelle','otro'),
	`reference` varchar(80),
	`created_by` int NOT NULL,
	`created_at` bigint NOT NULL,
	CONSTRAINT `purchases_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `quote_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`quote_id` int NOT NULL,
	`description` varchar(160) NOT NULL,
	`qty` int NOT NULL DEFAULT 1,
	`unit_cents` int NOT NULL,
	`sort` int NOT NULL DEFAULT 0,
	CONSTRAINT `quote_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `quote_payments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`quote_id` int NOT NULL,
	`amount_cents` int NOT NULL,
	`method` enum('efectivo_usd','efectivo_bs','pago_movil','punto','zelle','otro') NOT NULL,
	`reference` varchar(80),
	`staff_id` int NOT NULL,
	`created_at` bigint NOT NULL,
	CONSTRAINT `quote_payments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `quotes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`customer_name` varchar(120) NOT NULL,
	`customer_phone` varchar(20),
	`customer_email` varchar(190),
	`occasion` varchar(120),
	`event_at` bigint,
	`duration_minutes` int NOT NULL DEFAULT 120,
	`guests` int NOT NULL DEFAULT 10,
	`notes` text,
	`status` enum('draft','sent','approved','scheduled','done','cancelled') NOT NULL DEFAULT 'draft',
	`total_cents` int NOT NULL DEFAULT 0,
	`paid_cents` int NOT NULL DEFAULT 0,
	`receipt_number` int,
	`paid_at` bigint,
	`created_by` int NOT NULL,
	`created_at` bigint NOT NULL,
	`updated_at` bigint NOT NULL,
	CONSTRAINT `quotes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `role` enum('member','cashier','kitchen','admin','owner') NOT NULL DEFAULT 'member';--> statement-breakpoint
ALTER TABLE `order_items` ADD `kitchen` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `kitchen_status` enum('none','pending','preparing','ready','delivered') DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `note` varchar(160);--> statement-breakpoint
ALTER TABLE `orders` ADD `ready_at` bigint;--> statement-breakpoint
ALTER TABLE `orders` ADD `delivered_at` bigint;--> statement-breakpoint
ALTER TABLE `products` ADD `kitchen` boolean DEFAULT true NOT NULL;--> statement-breakpoint
CREATE INDEX `purchases_date` ON `purchases` (`invoice_date`);--> statement-breakpoint
CREATE INDEX `quote_items_quote` ON `quote_items` (`quote_id`);--> statement-breakpoint
CREATE INDEX `quote_payments_quote` ON `quote_payments` (`quote_id`);--> statement-breakpoint
CREATE INDEX `quote_payments_created` ON `quote_payments` (`created_at`);--> statement-breakpoint
CREATE INDEX `quotes_status` ON `quotes` (`status`);--> statement-breakpoint
CREATE INDEX `quotes_event` ON `quotes` (`event_at`);--> statement-breakpoint
CREATE INDEX `orders_kitchen` ON `orders` (`kitchen_status`);