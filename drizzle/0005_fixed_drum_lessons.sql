ALTER TYPE "public"."schedule_entry_type" ADD VALUE 'lesson';--> statement-breakpoint
CREATE TABLE "drum_lessons" (
	"id" uuid PRIMARY KEY NOT NULL,
	"class_name" varchar(80) NOT NULL,
	"semester_start" date NOT NULL,
	"semester_end" date NOT NULL,
	"start_week" date NOT NULL,
	"weekday" integer NOT NULL,
	"first_slot_index" integer NOT NULL,
	"last_occurrence_date" date,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "drum_lessons_class_name_nonempty" CHECK (char_length(btrim("drum_lessons"."class_name")) BETWEEN 1 AND 80),
	CONSTRAINT "drum_lessons_semester_range" CHECK ("drum_lessons"."semester_end" >= "drum_lessons"."semester_start"),
	CONSTRAINT "drum_lessons_start_week_monday" CHECK (extract(isodow from "drum_lessons"."start_week") = 1),
	CONSTRAINT "drum_lessons_start_in_semester" CHECK ("drum_lessons"."start_week" BETWEEN "drum_lessons"."semester_start" AND "drum_lessons"."semester_end"),
	CONSTRAINT "drum_lessons_weekday_range" CHECK ("drum_lessons"."weekday" BETWEEN 1 AND 7),
	CONSTRAINT "drum_lessons_first_slot_range" CHECK ("drum_lessons"."first_slot_index" BETWEEN 0 AND 11),
	CONSTRAINT "drum_lessons_last_occurrence_range" CHECK ("drum_lessons"."last_occurrence_date" IS NULL OR ("drum_lessons"."last_occurrence_date" BETWEEN "drum_lessons"."start_week" AND "drum_lessons"."semester_end" AND extract(isodow from "drum_lessons"."last_occurrence_date") = "drum_lessons"."weekday"))
);--> statement-breakpoint
CREATE TABLE "drum_lesson_pauses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"lesson_id" uuid NOT NULL,
	"pause_week" date NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "drum_lesson_pauses_week_monday" CHECK (extract(isodow from "drum_lesson_pauses"."pause_week") = 1)
);--> statement-breakpoint
CREATE TABLE "lesson_cancellation_audits" (
	"id" uuid PRIMARY KEY NOT NULL,
	"lesson_id" uuid,
	"booking_id" uuid NOT NULL,
	"booking_user_id" uuid,
	"booking_member_name" varchar(80) NOT NULL,
	"booking_date" date NOT NULL,
	"slot_index" integer NOT NULL,
	"cancelled_by" uuid,
	"reason" varchar(200) NOT NULL,
	"cancelled_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lesson_cancellation_audits_reason_nonempty" CHECK (char_length(btrim("lesson_cancellation_audits"."reason")) BETWEEN 1 AND 200),
	CONSTRAINT "lesson_cancellation_audits_slot_index_range" CHECK ("lesson_cancellation_audits"."slot_index" BETWEEN 0 AND 12)
);--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "lesson_id" uuid;--> statement-breakpoint
ALTER TABLE "drum_lessons" ADD CONSTRAINT "drum_lessons_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drum_lesson_pauses" ADD CONSTRAINT "drum_lesson_pauses_lesson_id_drum_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."drum_lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drum_lesson_pauses" ADD CONSTRAINT "drum_lesson_pauses_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_lesson_id_drum_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."drum_lessons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_cancellation_audits" ADD CONSTRAINT "lesson_cancellation_audits_lesson_id_drum_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."drum_lessons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_cancellation_audits" ADD CONSTRAINT "lesson_cancellation_audits_booking_user_id_users_id_fk" FOREIGN KEY ("booking_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_cancellation_audits" ADD CONSTRAINT "lesson_cancellation_audits_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_drum_lessons_semester" ON "drum_lessons" USING btree ("semester_start", "semester_end");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_drum_lesson_pauses_lesson_week_unique" ON "drum_lesson_pauses" USING btree ("lesson_id", "pause_week");--> statement-breakpoint
CREATE INDEX "idx_bookings_lesson_date" ON "bookings" USING btree ("lesson_id", "booking_date");--> statement-breakpoint
CREATE INDEX "idx_lesson_cancellation_audits_date" ON "lesson_cancellation_audits" USING btree ("booking_date");
