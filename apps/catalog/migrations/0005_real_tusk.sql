CREATE TABLE "catalog_media_alias" (
	"alias_id" uuid PRIMARY KEY NOT NULL,
	"canonical_id" uuid NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_media_alias_no_self" CHECK ("catalog_media_alias"."alias_id" <> "catalog_media_alias"."canonical_id")
);
--> statement-breakpoint
ALTER TABLE "catalog_media" ADD COLUMN "discriminator" text;--> statement-breakpoint
ALTER TABLE "catalog_media_alias" ADD CONSTRAINT "catalog_media_alias_canonical_id_catalog_media_id_fk" FOREIGN KEY ("canonical_id") REFERENCES "public"."catalog_media"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "catalog_media_alias_canonical_idx" ON "catalog_media_alias" USING btree ("canonical_id");