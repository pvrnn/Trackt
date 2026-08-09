CREATE TYPE "public"."friendship_status" AS ENUM('pending', 'accepted');--> statement-breakpoint
ALTER TABLE "follow" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "follow" CASCADE;--> statement-breakpoint
CREATE INDEX "user_username_trgm_idx" ON "user" USING gin ("username" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "user_name_trgm_idx" ON "user" USING gin ("name" gin_trgm_ops);