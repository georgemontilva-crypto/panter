CREATE TABLE `launcher_apps` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(80) NOT NULL,
	`category` enum('juego','app') NOT NULL DEFAULT 'juego',
	`target` varchar(400) NOT NULL,
	`args` varchar(200),
	`image_url` varchar(400),
	`active` boolean NOT NULL DEFAULT true,
	`created_at` bigint NOT NULL,
	CONSTRAINT `launcher_apps_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `stations` ADD `catalog` text;--> statement-breakpoint
ALTER TABLE `stations` ADD `catalog_at` bigint;