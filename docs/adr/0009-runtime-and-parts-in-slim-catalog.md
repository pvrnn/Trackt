# ADR-0009: Runtime and per-part facts in the slim catalog

**Status:** Accepted — 2026-09-30
**Amends:** ADR-0001 (the slim contract grows a field and a sub-resource), ADR-0003 (flat numbered parts gain optional facts)

## Context

Discord watch parties show `X / total` while a group watches a movie or an
episode, and offer "next episode" with its title. Nothing in Trackt knew how long
anything was: `SlimMediaSchema` had no runtime, `media.metadata` stayed `{}` for
every catalog row, and `media_part` rows were bare numbers created by check-ins.
TMDB and AniList publish runtimes and episode titles; both are redistributable
facts, so they belong in the central catalog next to title and part count, not in
a per-instance TMDB call.

## Decision

1. **`runtimeMinutes` on `SlimMedia`**, nullable. A movie's runtime; for a series
   or anime season, the typical episode runtime; null for print. It is
   `.default(null)`: a catalog that predates the field still parses on a newer
   instance, and a publisher that predates it still validates — as "unknown".
   Publishing stays full-document, so a republish without it clears it.
2. **Parts are a sub-resource, not part of `SlimMedia`.** `PUT
   /v1/admin/media/:id/parts` replaces a work's whole list; `GET
   /v1/catalog/media/:id/parts` serves it. Search hits, relation targets and news
   refs all embed `SlimMedia`, and none of them should carry a 1,000-chapter list.
   Parts stay flat and numbered (ADR-0003); each number gains an optional title,
   runtime and air date.
3. **`GET /v1/catalog/media/:id`** serves one work by canonical id.
4. **Instances backfill lazily.** Rows are one-time snapshots (ADR-0002), so a
   row materialized before the catalog knew its runtime would never learn it.
   `ensureWatchMetadata` fetches the runtime while the local column is null, and
   the parts while no local part has a title or runtime, upserting onto the parts
   check-ins already created. It runs where the data is needed (watch parties),
   not on every detail view.

## Consequences

- The catalog operator's importer (outside this repository) has to start
  sending `runtimeMinutes` and publishing parts before any of this has data.
  Until it does, watch parties fall back to a host-supplied duration.
- A runtime or episode title corrected upstream after an instance backfilled it
  stays stale on that instance, as every other snapshot field does today.
- `media_part.metadata` and `media.metadata` stay unused; runtime is a typed
  column because it is queried and displayed, not a bag of extras.
