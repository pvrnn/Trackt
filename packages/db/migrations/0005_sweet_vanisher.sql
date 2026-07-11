DROP INDEX "media_part_media_id_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "media_part_media_id_idx" ON "media_part" USING btree ("media_id","kind","number");