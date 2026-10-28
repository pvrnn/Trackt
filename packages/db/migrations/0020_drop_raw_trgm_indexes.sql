DROP INDEX "media_title_trgm_idx";--> statement-breakpoint
-- Superseded by media_title_unaccent_trgm_idx (0019): no query matches the raw
-- title any more, and a GIN index is paid for on every insert.
DROP INDEX IF EXISTS "media_synonyms_trgm_idx";
