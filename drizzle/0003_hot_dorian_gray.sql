CREATE TABLE `time_credits` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`kind` enum('pc','ps5','switch','sim') NOT NULL,
	`minutes` int NOT NULL DEFAULT 0,
	`updated_at` bigint NOT NULL,
	CONSTRAINT `time_credits_id` PRIMARY KEY(`id`),
	CONSTRAINT `time_credits_user_kind` UNIQUE(`user_id`,`kind`)
);
--> statement-breakpoint
ALTER TABLE `wallet_tx` MODIFY COLUMN `type` enum('topup','card_sale','session','refund','bonus','adjust','purchase','time') NOT NULL;--> statement-breakpoint
ALTER TABLE `sessions` ADD `credit_minutes` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `sessions` ADD `saved_minutes` int DEFAULT 0 NOT NULL;