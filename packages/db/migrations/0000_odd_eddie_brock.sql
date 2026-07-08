CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE TYPE "public"."log_status" AS ENUM('planned', 'in_progress', 'completed', 'dropped', 'paused');--> statement-breakpoint
CREATE TYPE "public"."media_kind" AS ENUM('movie', 'series', 'anime', 'manga', 'webtoon');--> statement-breakpoint
CREATE TYPE "public"."media_source" AS ENUM('provider', 'user');--> statement-breakpoint
CREATE TYPE "public"."media_status" AS ENUM('announced', 'airing', 'publishing', 'ended', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."moderation_status" AS ENUM('verified', 'unverified', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."part_kind" AS ENUM('season', 'episode', 'volume', 'chapter');--> statement-breakpoint
CREATE TYPE "public"."report_status" AS ENUM('open', 'resolved', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."target_type" AS ENUM('media', 'part');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('user', 'moderator', 'admin');--> statement-breakpoint
CREATE TYPE "public"."visibility" AS ENUM('public', 'followers', 'private');--> statement-breakpoint
CREATE TABLE "account" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"username" text,
	"bio" text,
	"role" "user_role" DEFAULT 'user' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email"),
	CONSTRAINT "user_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "media_kind" NOT NULL,
	"title" text NOT NULL,
	"original_title" text,
	"slug" text NOT NULL,
	"description" text,
	"cover_url" text,
	"release_date" date,
	"status" "media_status",
	"external_ids" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source" "media_source" DEFAULT 'provider' NOT NULL,
	"created_by" uuid,
	"moderation" "moderation_status" DEFAULT 'verified' NOT NULL,
	"community_uuid" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media_part" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"media_id" uuid NOT NULL,
	"parent_id" uuid,
	"kind" "part_kind" NOT NULL,
	"number" numeric(8, 2),
	"title" text,
	"air_date" date,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "progress" (
	"user_id" uuid NOT NULL,
	"part_id" uuid NOT NULL,
	"watched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"repeat_index" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "progress_user_id_part_id_repeat_index_pk" PRIMARY KEY("user_id","part_id","repeat_index")
);
--> statement-breakpoint
CREATE TABLE "user_media" (
	"user_id" uuid NOT NULL,
	"media_id" uuid NOT NULL,
	"status" "log_status" DEFAULT 'planned' NOT NULL,
	"repeats" integer DEFAULT 0 NOT NULL,
	"started_at" date,
	"finished_at" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_media_user_id_media_id_pk" PRIMARY KEY("user_id","media_id")
);
--> statement-breakpoint
CREATE TABLE "activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"verb" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"target_type" "target_type" NOT NULL,
	"target_id" uuid NOT NULL,
	"parent_comment_id" uuid,
	"body" text NOT NULL,
	"has_spoilers" boolean DEFAULT false NOT NULL,
	"is_hidden" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "follow" (
	"follower_id" uuid NOT NULL,
	"followee_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "follow_follower_id_followee_id_pk" PRIMARY KEY("follower_id","followee_id"),
	CONSTRAINT "follow_no_self" CHECK ("follow"."follower_id" <> "follow"."followee_id")
);
--> statement-breakpoint
CREATE TABLE "rating" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"target_type" "target_type" NOT NULL,
	"target_id" uuid NOT NULL,
	"score" numeric(3, 1),
	"review" text,
	"has_spoilers" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rating_user_target_unique" UNIQUE("user_id","target_type","target_id"),
	CONSTRAINT "rating_score_range" CHECK ("rating"."score" >= 0 AND "rating"."score" <= 10)
);
--> statement-breakpoint
CREATE TABLE "report" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reporter_id" uuid NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"status" "report_status" DEFAULT 'open' NOT NULL,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "favorite" (
	"user_id" uuid NOT NULL,
	"media_id" uuid NOT NULL,
	"kind" "media_kind" NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "favorite_user_id_media_id_pk" PRIMARY KEY("user_id","media_id")
);
--> statement-breakpoint
CREATE TABLE "list" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"is_ranked" boolean DEFAULT false NOT NULL,
	"is_collaborative" boolean DEFAULT false NOT NULL,
	"visibility" "visibility" DEFAULT 'public' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "list_item" (
	"list_id" uuid NOT NULL,
	"media_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"added_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "list_item_list_id_media_id_pk" PRIMARY KEY("list_id","media_id")
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_part" ADD CONSTRAINT "media_part_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_part" ADD CONSTRAINT "media_part_parent_id_media_part_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."media_part"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progress" ADD CONSTRAINT "progress_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progress" ADD CONSTRAINT "progress_part_id_media_part_id_fk" FOREIGN KEY ("part_id") REFERENCES "public"."media_part"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_media" ADD CONSTRAINT "user_media_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_media" ADD CONSTRAINT "user_media_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment" ADD CONSTRAINT "comment_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment" ADD CONSTRAINT "comment_parent_comment_id_comment_id_fk" FOREIGN KEY ("parent_comment_id") REFERENCES "public"."comment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow" ADD CONSTRAINT "follow_follower_id_user_id_fk" FOREIGN KEY ("follower_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow" ADD CONSTRAINT "follow_followee_id_user_id_fk" FOREIGN KEY ("followee_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rating" ADD CONSTRAINT "rating_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report" ADD CONSTRAINT "report_reporter_id_user_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report" ADD CONSTRAINT "report_resolved_by_user_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favorite" ADD CONSTRAINT "favorite_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favorite" ADD CONSTRAINT "favorite_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list" ADD CONSTRAINT "list_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_item" ADD CONSTRAINT "list_item_list_id_list_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."list"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_item" ADD CONSTRAINT "list_item_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_item" ADD CONSTRAINT "list_item_added_by_user_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_id_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "media_slug_idx" ON "media" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "media_kind_idx" ON "media" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "media_moderation_idx" ON "media" USING btree ("moderation");--> statement-breakpoint
CREATE INDEX "media_external_ids_gin_idx" ON "media" USING gin ("external_ids");--> statement-breakpoint
CREATE INDEX "media_title_trgm_idx" ON "media" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "media_part_media_id_idx" ON "media_part" USING btree ("media_id","kind","number");--> statement-breakpoint
CREATE INDEX "media_part_parent_id_idx" ON "media_part" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "progress_part_id_idx" ON "progress" USING btree ("part_id");--> statement-breakpoint
CREATE INDEX "progress_user_watched_idx" ON "progress" USING btree ("user_id","watched_at");--> statement-breakpoint
CREATE INDEX "user_media_media_id_idx" ON "user_media" USING btree ("media_id");--> statement-breakpoint
CREATE INDEX "user_media_status_idx" ON "user_media" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "activity_user_created_idx" ON "activity" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "activity_created_idx" ON "activity" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "comment_target_idx" ON "comment" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "comment_user_id_idx" ON "comment" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "comment_parent_idx" ON "comment" USING btree ("parent_comment_id");--> statement-breakpoint
CREATE INDEX "follow_followee_idx" ON "follow" USING btree ("followee_id");--> statement-breakpoint
CREATE INDEX "rating_target_idx" ON "rating" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "report_status_idx" ON "report" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "favorite_user_kind_idx" ON "favorite" USING btree ("user_id","kind","position");--> statement-breakpoint
CREATE INDEX "list_owner_idx" ON "list" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "list_item_media_idx" ON "list_item" USING btree ("media_id");