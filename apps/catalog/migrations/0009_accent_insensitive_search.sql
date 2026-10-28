CREATE EXTENSION IF NOT EXISTS unaccent;--> statement-breakpoint
CREATE OR REPLACE FUNCTION immutable_unaccent(text)
  RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "catalog_media_title_unaccent_trgm_idx" ON "catalog_media"
  USING gin (immutable_unaccent(lower("title")) gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "catalog_media_synonyms_unaccent_trgm_idx" ON "catalog_media"
  USING gin (immutable_unaccent(lower(immutable_array_to_string("synonyms", ' '))) gin_trgm_ops);
