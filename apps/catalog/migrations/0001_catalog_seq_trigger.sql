-- seq is the monotonic change cursor behind /v1/catalog/changes (ADR-0001).
-- The trigger bumps it on every write so instances can page `WHERE seq > since`.
-- Caveat: values can commit out of order under concurrent writers — the publish
-- path must be single-writer.
CREATE SEQUENCE IF NOT EXISTS "catalog_seq";--> statement-breakpoint
CREATE OR REPLACE FUNCTION bump_catalog_seq() RETURNS trigger LANGUAGE plpgsql AS
$$ BEGIN NEW.seq := nextval('catalog_seq'); RETURN NEW; END $$;--> statement-breakpoint
CREATE TRIGGER catalog_media_seq BEFORE INSERT OR UPDATE ON "catalog_media"
  FOR EACH ROW EXECUTE FUNCTION bump_catalog_seq();
