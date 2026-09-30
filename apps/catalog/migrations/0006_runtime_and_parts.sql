CREATE TABLE "catalog_media_part" (
	"media_id" uuid NOT NULL,
	"number" numeric(8, 2) NOT NULL,
	"title" text,
	"runtime_minutes" integer,
	"air_date" date,
	CONSTRAINT "catalog_media_part_media_id_number_pk" PRIMARY KEY("media_id","number")
);
--> statement-breakpoint
ALTER TABLE "catalog_media" ADD COLUMN "runtime_minutes" integer;--> statement-breakpoint
ALTER TABLE "catalog_media_part" ADD CONSTRAINT "catalog_media_part_media_id_catalog_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."catalog_media"("id") ON DELETE cascade ON UPDATE no action;