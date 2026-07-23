-- Per-season media + single part count (ADR-0003).
-- A series/anime "media" is now a single season (Breaking Bad S1 and S2 are two
-- rows with distinct canonical ids). The four count columns collapse to one
-- `part_count` (episodes for a series/anime season, chapters for manga/webtoon,
-- null for movies), plus a `season_number` for series/anime seasons. Pre-launch:
-- no rows to migrate, so this is a straight drop-and-add.
ALTER TABLE "media" DROP COLUMN "episode_count";--> statement-breakpoint
ALTER TABLE "media" DROP COLUMN "season_count";--> statement-breakpoint
ALTER TABLE "media" DROP COLUMN "chapter_count";--> statement-breakpoint
ALTER TABLE "media" DROP COLUMN "volume_count";--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "part_count" integer;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "season_number" integer;
