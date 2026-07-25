-- Typed media relations (ADR-0004).
-- Directed edges between works, stored in ONE direction only; the inverse
-- reading (prequel/source/parent) is derived by consumers, never stored. The
-- 3-column PK lets one pair carry two true edges and makes publishing
-- idempotent; the no-self CHECK is what lets the read route UNION ALL its two
-- branches without a dedup sort. Purely additive — no existing rows to touch.
CREATE TABLE "catalog_media_relation" (
	"from_id" uuid NOT NULL,
	"to_id" uuid NOT NULL,
	"type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_media_relation_from_id_to_id_type_pk" PRIMARY KEY("from_id","to_id","type"),
	CONSTRAINT "catalog_media_relation_no_self" CHECK ("catalog_media_relation"."from_id" <> "catalog_media_relation"."to_id")
);
--> statement-breakpoint
ALTER TABLE "catalog_media_relation" ADD CONSTRAINT "catalog_media_relation_from_id_catalog_media_id_fk" FOREIGN KEY ("from_id") REFERENCES "public"."catalog_media"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_media_relation" ADD CONSTRAINT "catalog_media_relation_to_id_catalog_media_id_fk" FOREIGN KEY ("to_id") REFERENCES "public"."catalog_media"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "catalog_media_relation_to_idx" ON "catalog_media_relation" USING btree ("to_id");