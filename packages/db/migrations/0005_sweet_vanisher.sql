-- Dedup guard: collapse duplicate (media_id, kind, number) parts before the
-- unique index below, otherwise pre-existing duplicates crash-loop the migrator.
-- Keeper = the duplicate with the most progress check-ins (ties: lowest id, so
-- reruns are deterministic). NULL numbers are left alone — the unique index
-- treats NULLs as distinct. Check-ins on losing rows are re-pointed at the
-- keeper (the progress PK dedups per user/repeat), as are child parts and
-- polymorphic part ratings/comments, before the losers are deleted.
CREATE TEMP TABLE media_part_dupes AS
WITH counted AS (
  SELECT mp.id, mp.media_id, mp.kind, mp.number,
         (SELECT count(*) FROM progress p WHERE p.part_id = mp.id) AS refs
  FROM media_part mp
  WHERE mp.number IS NOT NULL
), ranked AS (
  SELECT id,
         first_value(id) OVER w AS keeper_id,
         row_number() OVER w AS rn
  FROM counted
  WINDOW w AS (
    PARTITION BY media_id, kind, number
    ORDER BY refs DESC, id ASC
    ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
  )
)
SELECT id, keeper_id FROM ranked WHERE rn > 1;--> statement-breakpoint
INSERT INTO progress (user_id, part_id, watched_at, repeat_index)
SELECT p.user_id, d.keeper_id, p.watched_at, p.repeat_index
FROM progress p
JOIN media_part_dupes d ON d.id = p.part_id
ON CONFLICT DO NOTHING;--> statement-breakpoint
DELETE FROM progress WHERE part_id IN (SELECT id FROM media_part_dupes);--> statement-breakpoint
UPDATE media_part mp SET parent_id = d.keeper_id
FROM media_part_dupes d WHERE mp.parent_id = d.id;--> statement-breakpoint
UPDATE comment c SET target_id = d.keeper_id
FROM media_part_dupes d WHERE c.target_type = 'part' AND c.target_id = d.id;--> statement-breakpoint
UPDATE rating r SET target_id = d.keeper_id
FROM media_part_dupes d
WHERE r.target_type = 'part' AND r.target_id = d.id
  AND NOT EXISTS (
    SELECT 1 FROM rating r2
    WHERE r2.user_id = r.user_id AND r2.target_type = 'part' AND r2.target_id = d.keeper_id
  );--> statement-breakpoint
DELETE FROM rating r USING media_part_dupes d
WHERE r.target_type = 'part' AND r.target_id = d.id;--> statement-breakpoint
DELETE FROM media_part WHERE id IN (SELECT id FROM media_part_dupes);--> statement-breakpoint
DROP TABLE media_part_dupes;--> statement-breakpoint
DROP INDEX "media_part_media_id_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "media_part_media_id_idx" ON "media_part" USING btree ("media_id","kind","number");
