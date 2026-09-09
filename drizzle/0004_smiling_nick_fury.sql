ALTER TABLE "booking_settings" ADD COLUMN "last_pruned_week" date;--> statement-breakpoint
UPDATE "booking_settings"
SET "semester_start" = "semester_start" - (extract(isodow from "semester_start")::integer - 1),
	"semester_end" = "semester_end" - (extract(isodow from "semester_end")::integer % 7);--> statement-breakpoint
ALTER TABLE "booking_settings" ADD CONSTRAINT "booking_settings_semester_start_monday" CHECK (extract(isodow from "booking_settings"."semester_start") = 1);--> statement-breakpoint
ALTER TABLE "booking_settings" ADD CONSTRAINT "booking_settings_semester_end_sunday" CHECK (extract(isodow from "booking_settings"."semester_end") = 7);
