CREATE TYPE "public"."schedule_entry_type" AS ENUM('booking', 'activity');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('system_admin', 'club_admin', 'member');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account" varchar(32) NOT NULL,
	"password_hash" varchar(255) NOT NULL,
	"display_name" varchar(40) NOT NULL,
	"contact" varchar(100) NOT NULL,
	"role" "user_role" DEFAULT 'member' NOT NULL,
	"status" "user_status" DEFAULT 'pending' NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_account_format" CHECK ("users"."account" ~ '^[a-z0-9_-]{3,32}$'),
	CONSTRAINT "users_display_name_nonempty" CHECK (char_length(btrim("users"."display_name")) BETWEEN 1 AND 40),
	CONSTRAINT "users_contact_nonempty" CHECK (char_length(btrim("users"."contact")) BETWEEN 1 AND 100)
);
--> statement-breakpoint
ALTER TABLE "bookings" DROP CONSTRAINT "bookings_member_name_nonempty";--> statement-breakpoint
ALTER TABLE "bookings" ALTER COLUMN "member_name" SET DATA TYPE varchar(80);--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "entry_type" "schedule_entry_type" DEFAULT 'booking' NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_sessions_token_hash_unique" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "idx_sessions_user" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_sessions_expires" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_users_account_unique" ON "users" USING btree ("account");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_users_single_system_admin" ON "users" USING btree ("role") WHERE "users"."role" = 'system_admin';--> statement-breakpoint
CREATE INDEX "idx_users_status_created" ON "users" USING btree ("status","created_at");--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_bookings_user_date" ON "bookings" USING btree ("user_id","booking_date");--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_member_name_nonempty" CHECK (char_length(btrim("bookings"."member_name")) BETWEEN 1 AND 80);