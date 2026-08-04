# ADR-0005: Attribute-derived canonical identity

**Status:** Accepted — 2026-08-04
**Amends:** ADR-0001 point 2 (canonical key format and the identity-provider table), ADR-0003 point 3 (series-season key format)

## Context

ADR-0001 derived every canonical id from one nominated provider's numbering:
`uuidv5(NS, "<provider>:<kind>:<externalId>")`, with TMDB owning movie/series and
AniList owning anime/manga. That bought a guaranteed-unique, guaranteed-stable
handle for free, and it is genuinely the strongest property a work's identity can
have.

It also made Trackt's identity a derivative of two companies' databases. Three
consequences the project owner weighted more heavily than the uniqueness:

- **A work that no provider lists cannot exist.** The identity table had a hole
  in it already — webtoons had no provider, so they fell back to random UUIDs and
  were structurally second-class: not derivable, not interchangeable across
  instances, not publishable to the catalog.
- **Identity inherits the provider's problems.** TMDB merges and deletes entries;
  a work's identity should not move because a third party tidied their database.
  And ADR-0001 already had to reject mirroring provider *data* on database-rights
  grounds — keying identity on provider numbering kept a dependency of exactly
  the kind that decision was trying to shed.
- **Cross-provider reconciliation was undefined.** ADR-0001 named the case (a
  tmdb-keyed and an anilist-keyed row turning out to be the same work) and
  deferred it, with no mechanism anywhere in the tree.

## Decision

1. **Identity is derived from the work's own attributes**, never from a provider:

   ```
   uuidv5(TRACKT_CATALOG_NAMESPACE, "<kind>:<normalizedTitle>:<year>[:s<season>][:#<discriminator>]")
   ```

   e.g. `movie:the matrix:1999`, `series:breaking bad:2009:s2`. The namespace is
   unchanged and still frozen forever. `IDENTITY_PROVIDER_BY_KIND` is gone.

2. **`external_ids` survives as cross-reference data only.** It is still stored,
   still used for enrichment and for ADR-0004's season adjacency. It takes no part
   in identity, and the publish guard no longer requires it to contain anything —
   a work with `externalIds: {}` publishes under a real id.

3. **Title normalization is frozen forever** (`normalizeCanonicalTitle`): NFKC,
   locale-independent `toLowerCase`, apostrophes stripped, every other
   punctuation/symbol run collapsed to a single space. It deliberately is **not**
   `mediaSlug`, which strips non-latin characters entirely and would collapse
   葬送のフリーレン and 鬼滅の刃 to the same stem — acceptable in a URL, fatal in a key.

4. **A nullable `discriminator` column breaks collisions.** kind+title+year is not
   unique in the world (remakes, generic titles, anthologies). The first work
   published under a given key leaves it null; a genuine second claimant sets it,
   and it travels in `SlimMedia` because the publish guard has to reproduce the key
   from the row alone.

5. **Identity is settled at first publish and frozen.** The derivation is a *seed*,
   not a live function of the row. `POST /v1/admin/media` runs the identity guard on
   create only; an update trusts the id it is given, so correcting a title or year
   does not re-mint the id and orphan every instance's tracking history.

6. **`catalog_media_alias` makes a moved id recoverable.** A retired id is never
   reused and never deleted — it is aliased to the work that superseded it. This is
   the mechanism ADR-0001 deferred, and under attribute-derived identity it is
   mandatory rather than optional (see Consequences).

7. **Webtoons stop being second-class.** They derive like every other kind. Only
   *user-created instance rows* — which never go through catalog publish — keep
   random UUIDs.

## Consequences

- **Every canonical id changes.** The catalog is still unpopulated (as it was for
  ADR-0003), so this is again the cheapest possible moment and there is no data to
  migrate. After population this change would be impossible without a full alias
  sweep.
- **The guarantee genuinely weakens.** A provider id is a stable external handle;
  kind+title+year is not unique in the world and not immutable. We are trading a
  hard uniqueness property for independence, and paying for it with the
  discriminator (for collisions) and the alias table (for everything else). The
  alias table is load-bearing here in a way it never would have been under
  ADR-0001 — a corrected title, a corrected year, or a discovered duplicate all
  strand an id that instances have already handed out.
- **The publish guard is weaker on updates.** Trusting the id on an update is what
  makes renames possible; the cost is that a publisher can post unrelated content
  under an existing id. Acceptable because publishing is a single, project-operated
  admin path (same assumption ADR-0001 point 4 already makes about single-writer
  ordering).
- **`year` is now load-bearing.** A wrong year is an identity error, not a metadata
  error. Sources disagree about release-vs-air-vs-region year, so catalog
  population has to pick one rule and hold it. A null year is spelled as an empty
  segment and stays distinct from any real year.
- Series-season rows key on the **row's own** year (Breaking Bad S1 = 2008, S2 =
  2009), not the show's. The show year would be marginally more stable but the row
  does not store it, and a guard that derives from a field the row lacks is not a
  guard.
