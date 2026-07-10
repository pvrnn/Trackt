CREATE TABLE "catalog_media" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"synonyms" text[] DEFAULT '{}' NOT NULL,
	"year" integer,
	"status" text,
	"genres" text[] DEFAULT '{}' NOT NULL,
	"episode_count" integer,
	"season_count" integer,
	"chapter_count" integer,
	"volume_count" integer,
	"external_ids" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"description" text,
	"cover_url" text,
	"seq" bigint DEFAULT 0 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "catalog_media_seq_idx" ON "catalog_media" USING btree ("seq");--> statement-breakpoint
CREATE INDEX "catalog_media_kind_idx" ON "catalog_media" USING btree ("kind");