import type { MediaKind } from './media.js';

/**
 * Weights for the media search rank shared by the instance search
 * (`apps/api/src/lib/search.ts`) and the central catalog
 * (`apps/catalog/src/routes/v1/search.ts`) — see ADR-0010. The two services
 * build their own SQL against their own tables, so the numbers live here to
 * stop the composite drifting: a hit's `rank` is compared across both result
 * streams when federation merges them (ADR-0002).
 *
 * `rank = tier + text + formatClass + popularity`, where the tier is the
 * integer part (5 exact, 4 prefix, 3 substring, 2 synonym substring, 1
 * similarity-only hit) and the weights deliberately sum to 0.95, so no
 * combination of signals can reach the next tier. Inside a tier:
 *
 * - `text` — trigram similarity against the title or the synonym blob, 0–1. It
 *   is the primary signal, so an explicit `re:zero season 2` still finds that
 *   season rather than the original.
 * - `formatClass` — 1 for a main format, 0 for a derived one, counted **only
 *   when the query names the work** (the exact and prefix tiers): several works
 *   sharing a title or starting with the query means the query is a franchise
 *   name, and a spin-off must not outrank the work it spun off from just
 *   because its shorter title trigrams better. Elsewhere the query is a
 *   description rather than a name, and a short that matches it best is the
 *   right answer.
 * - `popularity` — `providerScore / 100`, worth 0.25 of similarity, which
 *   separates equally-relevant rows (adjacent seasons) without letting a
 *   better-rated sequel overtake the original.
 */
export const SEARCH_RANK_WEIGHTS = {
  text: 0.6,
  formatClass: 0.2,
  popularity: 0.15,
} as const;

/**
 * `metadata.format` values that mark a work as derived from another. The
 * vocabulary is the provider's own, lowercased with `_` folded to a space by
 * `providerMetadata` (`scripts/mal-scrape`), so AniList's `TV_SHORT` arrives as
 * `tv short` — matching on the underscore form silently matches nothing.
 *
 * Only formats known to be derivative are listed: anything else counts as a
 * main work, because demoting an unfamiliar vocabulary would be a guess (TMDB
 * rows carry no `format` at all). `ona` is deliberately main — web-first
 * originals like Cyberpunk: Edgerunners are released as ONA.
 */
export const DERIVATIVE_FORMATS = {
  anime: ['tv short', 'special', 'ova', 'music', 'pv', 'cm'],
  manga: ['one shot'],
} as const satisfies Partial<Record<MediaKind, readonly string[]>>;

/**
 * Popularity assumed for rows whose provider publishes no score — every TMDB
 * row. A neutral 0.5 keeps the signal from punishing whole catalogs that simply
 * do not report ratings, rather than reading "unknown" as "bad".
 */
export const UNKNOWN_POPULARITY = 0.5;
