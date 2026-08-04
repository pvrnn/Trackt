import { canonicalMediaId, type SlimMedia } from '@trackt/shared';

export type CanonicalIdCheck = { ok: true } | { ok: false; error: string };

/**
 * The publish path's identity guard: recompute the canonical id from the body's
 * own identity attributes and refuse anything that doesn't match.
 *
 * Canonical ids are frozen forever (ADR-0001) — every instance derives the same
 * UUID for the same work with no coordination, which is the whole reason
 * catalogs are interchangeable. A publisher that posts a mistyped or invented id
 * would poison that permanently, and no later migration can tell the good rows
 * from the bad. So the id is not trusted as input; it is *verified* as a
 * checksum of the attributes it claims to encode.
 *
 * Since ADR-0005 those attributes are the work's own (kind, title, year, season,
 * discriminator) rather than a provider's numbering, so this guard no longer
 * requires `externalIds` to contain anything at all.
 *
 * Note the asymmetry with the stored row: identity is settled at FIRST publish
 * and frozen, so this guard only ever runs on the incoming body. Renaming an
 * already-published work is handled as an update that leaves `id` alone (and,
 * where the rename means the row was misidentified, by an alias).
 */
export function checkCanonicalId(media: SlimMedia): CanonicalIdCheck {
  // A series row is one SEASON (ADR-0003) and the show title is shared across
  // seasons by design, so without the season number the key cannot separate them.
  if (media.kind === 'series' && media.seasonNumber === null) {
    return { ok: false, error: 'series media must carry a seasonNumber (ADR-0003)' };
  }

  let expected: string;
  try {
    expected = canonicalMediaId({
      kind: media.kind,
      title: media.title,
      year: media.year,
      // Anime carry a seasonNumber too and it belongs in the key for the same
      // reason as series: nothing else distinguishes two cours of one show.
      seasonNumber: media.seasonNumber,
      discriminator: media.discriminator,
    });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }

  if (expected !== media.id) {
    return {
      ok: false,
      error: `canonical id mismatch: '${media.title}' (${media.kind}, ${media.year ?? 'no year'}) derives ${expected}, body claims ${media.id}`,
    };
  }
  return { ok: true };
}
