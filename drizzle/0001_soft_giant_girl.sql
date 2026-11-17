CREATE TABLE `order_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`order_id` int NOT NULL,
	`product_id` int NOT NULL,
	`name` varchar(80) NOT NULL,
	`unit_cents` int NOT NULL,
	`qty` int NOT NULL,
	CONSTRAINT `order_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `orders` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`staff_id` int NOT NULL,
	`total_cents` int NOT NULL,
	`status` enum('paid','refunded') NOT NULL DEFAULT 'paid',
	`created_at` bigint NOT NULL,
	`refunded_at` bigint,
	`refunded_by` int,
	CONSTRAINT `orders_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `products` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(80) NOT NULL,
	`category` varchar(40) NOT NULL DEFAULT 'General',
	`price_cents` int NOT NULL,
	`active` boolean NOT NULL DEFAULT true,
	`created_at` bigint NOT NULL,
	CONSTRAINT `products_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `wallet_tx` MODIFY COLUMN `type` enum('topup','card_sale','session','refund','bonus','adjust','purchase') NOT NULL;--> statement-breakpoint
ALTER TABLE `wallet_tx` ADD `order_id` int;--> statement-breakpoint
CREATE INDEX `order_items_order` ON `order_items` (`order_id`);--> statement-breakpoint
CREATE INDEX `orders_user` ON `orders` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `orders_created` ON `orders` (`created_at`);