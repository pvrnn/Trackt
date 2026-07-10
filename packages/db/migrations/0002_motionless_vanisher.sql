ALTER TABLE "media" ADD COLUMN "synonyms" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "genres" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "year" integer;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "episode_count" integer;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "season_count" integer;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "chapter_count" integer;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "volume_count" integer;