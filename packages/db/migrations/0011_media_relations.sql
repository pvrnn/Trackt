-- Typed media relations (ADR-0004).
-- Directed edges between media rows, stored in ONE direction only; the inverse
-- reading (prequel/source/parent) is derived at read time, never stored. Only
-- *published* edges land here — adjacent series seasons are derived per request
-- from external_ids->>'tmdb' + season_number and deliberately never written,
-- which is what the media_external_tmdb_idx below serves (the existing jsonb GIN
-- index covers containment, not `->>` equality). Purely additive.
CREATE TYPE "public"."media_relation_type" AS ENUM('sequel', 'adaptation', 'spinoff', 'related');--> statement-breakpoint
CREATE TABLE "media_relation" (
	"from_id" uuid NOT NULL,
	"to_id" uuid NOT NULL,
	"type" "media_relation_type" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_relation_from_id_to_id_type_pk" PRIMARY KEY("from_id","to_id","type"),
	CONSTRAINT "media_relation_no_self" CHECK ("media_relation"."from_id" <> "media_relation"."to_id")
);
--> statement-breakpoint
ALTER TABLE "media_relation" ADD CONSTRAINT "media_relation_from_id_media_id_fk" FOREIGN KEY ("from_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_relation" ADD CONSTRAINT "media_relation_to_id_media_id_fk" FOREIGN KEY ("to_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_relation_to_idx" ON "media_relation" USING btree ("to_id");--> statement-breakpoint
CREATE INDEX "media_external_tmdb_idx" ON "media" USING btree (("external_ids" ->> 'tmdb'));