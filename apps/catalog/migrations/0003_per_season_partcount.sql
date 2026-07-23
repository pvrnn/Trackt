-- Per-season media + single part count (ADR-0003).
-- A series/anime "media" is now a single season, so the four count columns
-- (episode/season/chapter/volume) collapse to one `part_count` (episodes for a
-- series/anime season, chapters for manga/webtoon, null for movies), plus a
-- `season_number` identifying a flat season. Pre-launch: the catalog is empty,
-- so this is a straight drop-and-add with no backfill.
ALTER TABLE "catalog_media" DROP COLUMN "episode_count";--> statement-breakpoint
ALTER TABLE "catalog_media" DROP COLUMN "season_count";--> statement-breakpoint
ALTER TABLE "catalog_media" DROP COLUMN "chapter_count";--> statement-breakpoint
ALTER TABLE "catalog_media" DROP COLUMN "volume_count";--> statement-breakpoint
ALTER TABLE "catalog_media" ADD COLUMN "part_count" integer;--> statement-breakpoint
ALTER TABLE "catalog_media" ADD COLUMN "season_number" integer;
