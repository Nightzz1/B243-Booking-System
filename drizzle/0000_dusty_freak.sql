CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"booking_date" date NOT NULL,
	"slot_index" integer NOT NULL,
	"member_name" varchar(20) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bookings_slot_index_range" CHECK ("bookings"."slot_index" BETWEEN 0 AND 9),
	CONSTRAINT "bookings_member_name_nonempty" CHECK (char_length(btrim("bookings"."member_name")) BETWEEN 1 AND 20)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "idx_bookings_date_slot_unique" ON "bookings" USING btree ("booking_date","slot_index");