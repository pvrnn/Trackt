# ADR-0003: Per-season media entities and a single part count

**Status:** Accepted — 2026-07-22
**Amends:** ADR-0001 (point 1's slim contract, point 2's canonical key format)

## Context

ADR-0001 modelled one `media` row as a whole work — Breaking Bad, all five
seasons, was a single row carrying four count columns (`episode_count`,
`season_count`, `chapter_count`, `volume_count`), of which only one or two ever
applied to a given kind. Two problems fell out of that:

1. **Muddy counts.** Every row reserved all four counts; a series filled two, a
   movie none, and the shape invited confusion (a movie with an `episode_count`,
   a manga with a `season_count`).
2. **Season identity.** AniList — the identity provider for anime/manga
   (ADR-0001 point 2) — already issues a **separate ID per season/cour**, so
   forcing anime into one whole-show row fought its own provider. TMDB
   (movie/series) models the whole show, so series was the row that needed to
   change to match.

The catalog was still empty (pre-launch), so this was the cheapest possible
moment to change the model — no data to migrate.

## Decision

1. **A `media` row is a single trackable unit.** For `series` and `anime` that
   unit is **one season**: Breaking Bad S1 and S2 are two rows with distinct
   canonical IDs, no parent "show" row (flat — search returns each season,
   labelled by season number). `movie` stays a single film; `manga`/`webtoon`
   stay one whole-work row counted in chapters. Manga is **not** split per
   volume.

2. **One `part_count`, not four.** The four count columns collapse to a single
   nullable `part_count`: episodes for a series/anime season, chapters for
   manga/webtoon, null for movies. The part *kind* is derived from media kind
   (`PART_KIND_BY_MEDIA` in `packages/shared/src/media.ts`), so it needs no
   storage. A nullable `season_number` identifies which season a series/anime
   row is (null for other kinds).

3. **Canonical key for a series season** (frozen forever, like every canonical
   key) is the show's TMDB id plus the season number:
   `tmdb:series:<showTmdbId>:<seasonNumber>` → e.g. `tmdb:series:1396:1`. Built
   via `canonicalSeriesSeasonId(showTmdbId, seasonNumber)`
   (`packages/shared/src/canonical-id.ts`). The row stores
   `external_ids: { tmdb: <showId> }` plus `season_number`; identity comes from
   the composite key. **Anime needs no new scheme** — pass the per-season
   AniList id to `canonicalMediaId('anime', anilistId)` as before.
   TMDB's own season-object ids (`tmdb:season:<id>`) were rejected: less
   predictable and not derivable from show+season without an extra API lookup.

4. **The title stays the show/base title** (`"Breaking Bad"`), so a trgm search
   for "breaking bad" returns every season; the UI disambiguates by
   `season_number` ("Season 2").

5. **`media_part` is unchanged.** It already stored flat episodes/chapters per
   media; the season→episode hierarchy it nominally supported was unused and
   stays unused (`part_kind` enum keeps its `season`/`volume` values, now
   vestigial — trimming a pg enum isn't worth a migration).

## Consequences

- The slim contract (`SlimMediaSchema`), both database schemas
  (`catalog_media`, `media`), the media-detail/search/moderation/user-entry
  contracts, and every mapper that read the four counts now use
  `part_count` + `season_number`. Migrations `apps/catalog/migrations/0003_*`
  and `packages/db/migrations/0010_*` are straight drop-and-adds (no backfill,
  pre-launch).
- Tracking is unaffected structurally: a season's episodes are still flat
  `media_part` rows numbered `1..part_count`, generated lazily on check-in.
- Catalog population (the importer sprint) must emit **one row per season** for
  series/anime, with per-season episode counts — TMDB's `/tv/{id}` seasons
  array supplies these. Whole-show scrapes (e.g. the earlier top-100 TV JSON)
  are the wrong shape and must be regenerated per season.
- No parent "show" entity exists, so there is no show-level rating or "watching
  the whole show" state; that is an accepted v1 tradeoff. Adding a grouping
  layer later remains possible without breaking canonical season IDs.
