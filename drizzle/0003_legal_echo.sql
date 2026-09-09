CREATE TABLE "booking_settings" (
	"id" varchar(16) PRIMARY KEY NOT NULL,
	"semester_start" date NOT NULL,
	"semester_end" date NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_settings_semester_range" CHECK ("booking_settings"."semester_end" >= "booking_settings"."semester_start")
);
--> statement-breakpoint
ALTER TABLE "bookings" DROP CONSTRAINT "bookings_slot_index_range";--> statement-breakpoint
ALTER TABLE "booking_settings" ADD CONSTRAINT "booking_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_slot_index_range" CHECK ("bookings"."slot_index" BETWEEN 0 AND 12);