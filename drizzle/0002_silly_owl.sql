ALTER TABLE "users" ADD COLUMN "phone" varchar(32);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "wechat" varchar(64);--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_phone_nonempty" CHECK ("users"."phone" IS NULL OR char_length(btrim("users"."phone")) BETWEEN 1 AND 32);--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_wechat_nonempty" CHECK ("users"."wechat" IS NULL OR char_length(btrim("users"."wechat")) BETWEEN 1 AND 64);