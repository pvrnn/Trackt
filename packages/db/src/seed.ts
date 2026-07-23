import { sql } from 'drizzle-orm';
import type { Db } from './index.js';
import { media } from './schema/media.js';
import { SEED_MEDIA } from './seed-data.js';

/**
 * Insert the dev fixture catalog. Idempotent: deterministic IDs make re-seeding an
 * upsert, so edits to seed-data.ts land on existing rows.
 */
export async function seedMedia(db: Db): Promise<void> {
  await db
    .insert(media)
    .values(SEED_MEDIA)
    .onConflictDoUpdate({
      target: media.id,
      set: {
        title: sql`excluded.title`,
        slug: sql`excluded.slug`,
        synonyms: sql`excluded.synonyms`,
        genres: sql`excluded.genres`,
        year: sql`excluded.year`,
        partCount: sql`excluded.part_count`,
        seasonNumber: sql`excluded.season_number`,
        description: sql`excluded.description`,
        coverUrl: sql`excluded.cover_url`,
        releaseDate: sql`excluded.release_date`,
        status: sql`excluded.status`,
        externalIds: sql`excluded.external_ids`,
        source: sql`excluded.source`,
        moderation: sql`excluded.moderation`,
        updatedAt: new Date(),
      },
    });
}
