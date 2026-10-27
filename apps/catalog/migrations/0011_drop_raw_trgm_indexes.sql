DROP INDEX "catalog_media_title_trgm_idx";--> statement-breakpoint
-- Superseded by catalog_media_title_unaccent_trgm_idx (0009).
DROP INDEX IF EXISTS "catalog_media_synonyms_trgm_idx";
