CREATE TYPE "public"."rsvp_response" AS ENUM('going', 'maybe', 'declined');--> statement-breakpoint
CREATE TYPE "public"."watch_party_status" AS ENUM('scheduled', 'live', 'ended', 'cancelled');--> statement-breakpoint
CREATE TABLE "discord_guild_settings" (
	"guild_id" text PRIMARY KEY NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discord_watch_party" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"message_id" text,
	"voice_channel_id" text,
	"host_discord_id" text NOT NULL,
	"media_id" uuid NOT NULL,
	"part_number" integer,
	"scheduled_at" timestamp with time zone NOT NULL,
	"status" "watch_party_status" DEFAULT 'scheduled' NOT NULL,
	"fallback_minutes" integer,
	"duration_seconds" integer,
	"item_started_at" timestamp with time zone,
	"paused_at" timestamp with time zone,
	"paused_ms" integer DEFAULT 0 NOT NULL,
	"item_credited_at" timestamp with time zone,
	"reminded_at" timestamp with time zone,
	"rendered_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discord_watch_party_rsvp" (
	"party_id" uuid NOT NULL,
	"discord_user_id" text NOT NULL,
	"response" "rsvp_response" NOT NULL,
	"responded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discord_watch_party_rsvp_party_id_discord_user_id_pk" PRIMARY KEY("party_id","discord_user_id")
);
--> statement-breakpoint
ALTER TABLE "discord_watch_party" ADD CONSTRAINT "discord_watch_party_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discord_watch_party_rsvp" ADD CONSTRAINT "discord_watch_party_rsvp_party_id_discord_watch_party_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."discord_watch_party"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "discord_watch_party_status_idx" ON "discord_watch_party" USING btree ("status","scheduled_at");