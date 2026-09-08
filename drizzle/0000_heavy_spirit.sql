CREATE TABLE `bookings` (
	`id` text PRIMARY KEY NOT NULL,
	`booking_date` text NOT NULL,
	`slot_index` integer NOT NULL,
	`member_name` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_bookings_date_slot_unique` ON `bookings` (`booking_date`,`slot_index`);
--> statement-breakpoint
PRAGMA optimize;
