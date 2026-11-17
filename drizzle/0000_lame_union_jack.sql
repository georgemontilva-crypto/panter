CREATE TABLE `sessions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`station_id` int NOT NULL,
	`status` enum('active','ended') NOT NULL DEFAULT 'active',
	`started_at` bigint NOT NULL,
	`ends_at` bigint NOT NULL,
	`grace_ends_at` bigint NOT NULL,
	`ended_at` bigint,
	`minutes_paid` int NOT NULL,
	`cost_cents` int NOT NULL,
	`refund_cents` int NOT NULL DEFAULT 0,
	`started_by` int,
	`end_reason` varchar(30),
	CONSTRAINT `sessions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` varchar(40) NOT NULL,
	`value` text NOT NULL,
	CONSTRAINT `settings_key` PRIMARY KEY(`key`)
);
--> statement-breakpoint
CREATE TABLE `stations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`kind` enum('pc','ps5','switch','sim') NOT NULL,
	`number` int NOT NULL,
	`enabled` boolean NOT NULL DEFAULT true,
	`note` varchar(160),
	`device_token_hash` varchar(64),
	`pair_code` varchar(6),
	`pair_code_at` bigint,
	`last_seen_at` bigint,
	`agent_version` varchar(20),
	`unlock_until` bigint,
	CONSTRAINT `stations_id` PRIMARY KEY(`id`),
	CONSTRAINT `stations_kind_number` UNIQUE(`kind`,`number`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` int AUTO_INCREMENT NOT NULL,
	`role` enum('member','cashier','admin') NOT NULL DEFAULT 'member',
	`name` varchar(120) NOT NULL,
	`phone` varchar(20),
	`email` varchar(190),
	`password_hash` varchar(100),
	`member_code` varchar(16) NOT NULL,
	`card_token` varchar(40) NOT NULL,
	`has_card` boolean NOT NULL DEFAULT false,
	`balance_cents` int NOT NULL DEFAULT 0,
	`visits_count` int NOT NULL DEFAULT 0,
	`active` boolean NOT NULL DEFAULT true,
	`created_at` bigint NOT NULL,
	`created_by` int,
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_phone_unique` UNIQUE(`phone`),
	CONSTRAINT `users_email_unique` UNIQUE(`email`),
	CONSTRAINT `users_member_code_unique` UNIQUE(`member_code`),
	CONSTRAINT `users_card_token_unique` UNIQUE(`card_token`)
);
--> statement-breakpoint
CREATE TABLE `visits` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`visit_date` varchar(10) NOT NULL,
	`source` enum('session','checkin') NOT NULL,
	`created_at` bigint NOT NULL,
	CONSTRAINT `visits_id` PRIMARY KEY(`id`),
	CONSTRAINT `visits_user_day` UNIQUE(`user_id`,`visit_date`)
);
--> statement-breakpoint
CREATE TABLE `wallet_tx` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`type` enum('topup','card_sale','session','refund','bonus','adjust') NOT NULL,
	`amount_cents` int NOT NULL,
	`balance_after_cents` int NOT NULL,
	`paid_cents` int NOT NULL DEFAULT 0,
	`method` enum('efectivo_usd','efectivo_bs','pago_movil','punto','zelle','otro'),
	`reference` varchar(80),
	`note` varchar(200),
	`session_id` int,
	`staff_id` int,
	`created_at` bigint NOT NULL,
	CONSTRAINT `wallet_tx_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `sessions_station` ON `sessions` (`station_id`,`status`);--> statement-breakpoint
CREATE INDEX `sessions_user` ON `sessions` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `stations_token` ON `stations` (`device_token_hash`);--> statement-breakpoint
CREATE INDEX `visits_day` ON `visits` (`visit_date`);--> statement-breakpoint
CREATE INDEX `wallet_tx_user` ON `wallet_tx` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `wallet_tx_created` ON `wallet_tx` (`created_at`);