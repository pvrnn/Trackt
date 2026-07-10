-- Backfill year from release_date for rows created before the slim-catalog pivot (ADR-0001).
UPDATE "media" SET "year" = EXTRACT(YEAR FROM "release_date")::int WHERE "release_date" IS NOT NULL;--> statement-breakpoint
-- array_to_string is only STABLE; expression indexes need an IMMUTABLE function.
-- This wrapper (and the index below) is owned by this migration, not the drizzle schema:
-- drizzle-kit cannot express the function dependency.
CREATE OR REPLACE FUNCTION immutable_array_to_string(text[], text)
  RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$ SELECT array_to_string($1, $2) $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "media_synonyms_trgm_idx" ON "media"
  USING gin (immutable_array_to_string("synonyms", ' ') gin_trgm_ops);
