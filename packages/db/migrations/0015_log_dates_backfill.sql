-- Backfill user_media.started_at / finished_at, dead since migration 0000 (ADR-0007).
-- Without this, /history ships empty for everyone already using the instance.
-- Hand-written: drizzle-kit cannot express a data migration.

-- Dates from the check-ins that prove them (UTC, per loadStreak's convention).
WITH bounds AS (
  SELECT p.user_id, mp.media_id,
         min((p.watched_at AT TIME ZONE 'UTC')::date) AS first_day,
         max((p.watched_at AT TIME ZONE 'UTC')::date) AS last_day
  FROM progress p JOIN media_part mp ON mp.id = p.part_id
  GROUP BY p.user_id, mp.media_id
)
UPDATE user_media um SET
  started_at  = b.first_day,
  finished_at = CASE WHEN um.status = 'completed' THEN b.last_day ELSE NULL END
FROM bounds b
WHERE b.user_id = um.user_id AND b.media_id = um.media_id;
--> statement-breakpoint
-- Movies and anything logged without a check-in: the row's own age is the only
-- evidence there is, so this half is an admitted guess (ADR-0007) — an import
-- marked completed long after the fact gets the import date. Acceptable only
-- because every date is editable by hand, and better than an empty history.
-- Deliberately not applied to `planned`: a watchlist entry has no viewing date,
-- and inventing one would file it into the history.
UPDATE user_media SET
  started_at  = COALESCE(started_at, (created_at AT TIME ZONE 'UTC')::date),
  finished_at = CASE WHEN status = 'completed'
                     THEN COALESCE(finished_at, (updated_at AT TIME ZONE 'UTC')::date) END
WHERE status <> 'planned';
