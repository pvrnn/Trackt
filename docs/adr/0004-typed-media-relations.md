# ADR-0004: Typed media relations

**Status:** Accepted — 2026-07-25
**Amends:** ADR-0003 (adds the navigation layer its flat seasons need), ADR-0002 (point 2's materialization gains a second trigger)

## Context

ADR-0003 made each `series`/`anime` media a single **season** with its own
canonical ID and **no parent "show" row**. That fixed identity — AniList already
issues one ID per season, and TMDB show+season is derivable — but it removed the
only structure that connected a work to its neighbours. Breaking Bad S1 and S2
are two rows with nothing linking them; a manga and the anime that adapts it are
two rows with nothing linking them. ADR-0003's closing consequence named the gap
outright: "Adding a grouping layer later remains possible without breaking
canonical season IDs."

The existing media-detail sidebar offers a *genre-overlap* "Related" list
(`loadRelated` in `apps/api/src/routes/v1/media.ts`) — three same-kind titles
sharing a genre. It is a suggestion heuristic, not a statement of fact, and it
cannot express "this is the sequel" or "this manga is the source".

Two constraints shaped the design. First, relation data is a redistributable
fact, so it belongs in the central catalog (ADR-0001) — but catalog population
has not shipped (`POST /v1/admin/media` is still a 501 stub), so anything
depending solely on published edges would ship dead. Second, ADR-0002 removed
the bulk pull feed, so instances learn about central data live, per request.

## Decision

1. **Four stored relation types, one stored direction, derived inverse labels.**
   The stored vocabulary is `sequel · adaptation · spinoff · related`, always
   recorded in the forward direction: `A →sequel→ B` means B is A's sequel,
   `A →adaptation→ B` means B adapts A, `A →spinoff→ B` means B spins off A.
   `related` is symmetric. An edge is **never** stored twice. Reading an edge
   backwards yields a *display label* from a second, wider vocabulary —
   `prequel · source · parent · related` — via `REVERSE_RELATION_LABEL`
   (`packages/shared/src/media.ts`). The two vocabularies stay separate types on
   purpose: the four-value set constrains database columns, the seven-value set
   constrains a response field, and merging them would let `prequel` reach a
   column. Publishers must emit a symmetric `related` pair once, not twice.

2. **An edge table in each database, bridged by the zod contract as always.**
   `catalog_media_relation` (catalog) and `media_relation` (instance) are
   `(from_id, to_id, type)` with that triple as the primary key, both endpoints
   cascading on delete, a reverse-lookup index on `to_id`, and a no-self CHECK.
   The type-inclusive key lets one pair carry two true edges (a manga that is
   both an anime's source *and* related to it) and makes a future publish path
   idempotent per typed edge. The no-self CHECK is load-bearing rather than
   hygiene: because no row can match both `from_id = $1` and `to_id = $1`, the
   bidirectional read is a provably disjoint `UNION ALL` needing no dedup sort.
   Neither table carries `seq` or a tombstone — the feed both would have served
   was removed by ADR-0002, catalog version stays `max(catalog_media.seq)`, and
   a bad edge is a hard `DELETE`.

3. **Instances read edges live from the catalog and materialize their targets
   once**, extending ADR-0002 point 2 from search hits to relation targets:
   `GET /v1/catalog/relations?id=` serves the target work in slim form plus the
   stored type and the direction traversed, and any target absent locally is
   inserted into `media` (`source: 'provider'`, `moderation: 'verified'`) before
   its id reaches a client. The call is timeout-bounded and **never fails the
   request** — an unreachable catalog degrades to locally-known relations only,
   the same posture as federated search. It is skipped entirely for a work that
   already has stored edges, so the per-detail-view fan-out disappears once a
   work has been seen.

4. **Adjacent series seasons are derived locally, not stored.** A `series` row
   knows its show (`external_ids->>'tmdb'`) and its `season_number`, so seasons
   `n-1` and `n+1` are one indexed query away and need no published data at all
   — which is what makes flat seasons navigable before population exists. Only
   *immediate* neighbours are derived, because `sequel`/`prequel` mean adjacency;
   season 0 (TMDB "Specials") is excluded, and `kind = 'series'` is required
   since TMDB namespaces movie and TV IDs separately. Derived edges are computed
   per request and **never written**, so a stored edge naming the same target
   always wins and there is no second source of truth to keep fresh. Anime
   cannot be derived this way — AniList issues unrelated IDs per season
   (ADR-0003 point 3) — so anime depends on published edges.

5. **The genre-overlap list survives as a labelled fallback.** `MediaDetail`
   grows a `relations` field and keeps `related`, now documented as suggestions
   rather than relations. The API always sends both; the client renders typed
   relations when present and otherwise falls back under a distinct heading
   ("You might also like"). Suppressing one server-side would make the payload's
   meaning depend on hidden state, and an empty sidebar would violate the
   project's no-dead-UI rule for as long as the catalog carries no edges.

## Consequences

- Both database schemas, the slim/detail contracts, the catalog client, the
  media-detail route, the dev seed, and the detail-page sidebar change.
  Migrations `apps/catalog/migrations/0004_*` and
  `packages/db/migrations/0011_*` are purely additive.
- **ADR-0002's "search is the only discovery path" reasoning no longer holds**,
  though its invariant does: every media id the API hands a client is still a
  persisted local `media.id`, so tracking still needs no changes. Two things
  follow — code inferring "this row exists, therefore someone searched for it"
  is now wrong, and `media` accumulates works nobody searched for.
- A work reachable by two true relations renders under only one heading (the
  merge is keyed on the target id, resolved by display order). Deterministic,
  and preferable to the same cover appearing twice, but it is information loss.
- `media_relation` carries no visibility of its own, so every read path must
  filter targets through `canViewMedia`/`visibleMediaSql`. Without that, an
  `unverified` user entry linked as a sequel would leak to every visitor and a
  soft-deleted row would resurface through its sibling.
- A materialized edge target is permanent, inheriting ADR-0002's accepted
  staleness tradeoff: nothing re-reads it, and no tombstone propagates.
- Catalog population owes a relations publish endpoint (there is no
  `POST /v1/admin/relations`) and must normalize provider vocabularies into the
  four stored types **always in the forward direction** — AniList's
  `SEQUEL`/`PREQUEL` both become one stored `sequel` on whichever work comes
  first, `SOURCE`/`ADAPTATION` one stored `adaptation`, `SIDE_STORY`/`PARENT`
  one stored `spinoff`, and `ALTERNATIVE`/`OTHER` fall to `related`. It can also
  emit `sequel` edges between consecutive series seasons, which would supersede
  the derivation in point 4 for populated shows.
- Whole-season lists and show-level state (a rating for "the whole show", a
  "watching Breaking Bad" status) remain out of scope: point 4 delivers
  one-hop navigation, not the grouping entity ADR-0003 declined.
