import {
  canonicalMediaId,
  canonicalSeriesSeasonId,
  IDENTITY_PROVIDER_BY_KIND,
  type SlimMedia,
} from '@trackt/shared';

export type CanonicalIdCheck = { ok: true } | { ok: false; error: string };

/**
 * The publish path's identity guard: recompute the canonical id from the body's
 * own `externalIds` and refuse anything that doesn't match.
 *
 * Canonical ids are frozen forever (ADR-0001) — every instance derives the same
 * UUID for the same work with no coordination, which is the whole reason
 * catalogs are interchangeable. A publisher that posts a mistyped or invented id
 * would poison that permanently, and no later migration can tell the good rows
 * from the bad. So the id is not trusted as input; it is *verified* as a
 * checksum of the external id it claims to encode.
 */
export function checkCanonicalId(media: SlimMedia): CanonicalIdCheck {
  const provider = IDENTITY_PROVIDER_BY_KIND[media.kind];
  // Webtoons have no upstream identity provider (ADR-0001): they are user-created
  // and keep random UUIDs, so there is nothing to recompute against.
  if (!provider) return { ok: true };

  const externalId = media.externalIds[provider];
  if (externalId === undefined || String(externalId) === '') {
    return {
      ok: false,
      error: `missing externalIds.${provider}, which defines canonical identity for kind '${media.kind}'`,
    };
  }

  let expected: string;
  if (media.kind === 'series') {
    // A series row is one SEASON (ADR-0003) and its key folds in the season
    // number, because `externalIds.tmdb` is the *show* id — shared by every
    // season, so it cannot identify this row on its own.
    if (media.seasonNumber === null) {
      return { ok: false, error: 'series media must carry a seasonNumber (ADR-0003)' };
    }
    expected = canonicalSeriesSeasonId(externalId, media.seasonNumber);
  } else {
    // Anime carry a seasonNumber too, but AniList already issues a distinct id
    // per season/cour, so the external id alone identifies the row.
    expected = canonicalMediaId(media.kind, externalId);
  }

  if (expected !== media.id) {
    return {
      ok: false,
      error: `canonical id mismatch: externalIds.${provider}=${String(externalId)} derives ${expected}, body claims ${media.id}`,
    };
  }
  return { ok: true };
}
