-- Federated search (ADR-0002): live pg_trgm search against catalog_media.
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE INDEX "catalog_media_title_trgm_idx" ON "catalog_media" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
-- array_to_string is only STABLE; expression indexes need an IMMUTABLE function.
-- This wrapper (and the index below) is owned by this migration, not the drizzle
-- schema: drizzle-kit cannot express the function dependency. Mirrors
-- packages/db/migrations/0003_year_backfill_and_synonyms_index.sql.
CREATE OR REPLACE FUNCTION immutable_array_to_string(text[], text)
  RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$ SELECT array_to_string($1, $2) $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "catalog_media_synonyms_trgm_idx" ON "catalog_media"
  USING gin (immutable_array_to_string("synonyms", ' ') gin_trgm_ops);
