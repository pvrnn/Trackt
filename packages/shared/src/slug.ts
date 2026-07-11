/**
 * URL slugs for media entries. Deterministic so the catalog sync job and
 * importers derive the same slug for the same work everywhere.
 *
 * Slugs are unique per instance (`media_slug_idx`); callers resolve collisions
 * between different works (same title + year) by appending a discriminator —
 * see the sync job's id-fragment fallback.
 */
export function mediaSlug(title: string, year?: number | null): string {
  const base = title
    .normalize('NFKD')
    // Strip combining marks left over from decomposition (é → e).
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  // Titles without any latin characters (e.g. 葬送のフリーレン) slugify to
  // nothing — fall back to a neutral stem so the slug stays non-empty.
  const stem = base || 'media';
  return year == null ? stem : `${stem}-${year}`;
}
