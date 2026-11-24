# catalog-research

One-off data-quality and cross-kind linking pass over `apps/catalog/seed/`.

The seeds are five closed provider graphs. AniList links anime↔manga; films,
series and games carry almost no edges, so the same franchise appears as
unrelated rows (`Death Note` manga, anime and 2016 film; `Steins;Gate` visual
novel and anime).

```
node scripts/catalog-research/prepare-batches.mjs   # rebuild candidates + 100-row batches
node scripts/catalog-research/check.mjs <result>    # validate one agent result
node scripts/catalog-research/merge.mjs             # dry run
node scripts/catalog-research/merge.mjs --apply     # rewrite the seeds
```

- Candidates: pairs of different kinds sharing a normalised title/synonym with
  no existing edge, scored by title exactness and year agreement.
- `apps/catalog/seed/research/` holds the batches, the agent brief, the genre
  vocabulary, the per-batch results and the merge report. It is gitignored with
  the seeds.
- `merge.mjs` refuses a result file that `check.mjs` rejects. An edge goes into
  every seed holding both endpoints; when no seed holds both (game ↔ movie) it
  goes into `top-series-tmdb.json`, the last-loaded seed, which `db:seed:all`
  resolves against the whole database.
- A row can live in two seeds (each AniList seed ships the other's kinds) and
  the seeder upserts every column, so a metadata edit is written to every copy.
- Every `--apply` drops a timestamped `.pre-research-*.bak` beside the seed it
  rewrites.

## Replaying the pass after a re-scrape

A re-scrape replaces the seed files but not the canonical ids (UUIDv5 from the
provider id), so the pass can be replayed by id:

```sh
node scripts/catalog-research/apply-patch.mjs            # dry run against apps/catalog/seed
node scripts/catalog-research/apply-patch.mjs --apply    # write, with .pre-patch-*.bak backups
node scripts/catalog-research/apply-patch.mjs --seeds <rebuilt-dir> [--apply]
```

`research-patch.json` is the durable artifact — it lives here, not in the seed
directory, so `rm -rf apps/catalog/seed` does not take it with it. It holds the
2 539 edges and the 109 metadata edits with the value each field held _before_
the pass, which is what makes the replay a three-way merge:

| seed today                                         | what happens                           |
| -------------------------------------------------- | -------------------------------------- |
| already `to`                                       | nothing                                |
| still `from`                                       | write `to`                             |
| empty, and the pass filled it                      | write `to`                             |
| something else (the new scrape said something new) | **keep the scrape**, report a conflict |

Edges are added unless the pair already carries the same or a stronger claim.
Duplicates and the 18 low-confidence links are in `heldBack` and are never
applied. Replaying twice is a no-op, and replaying onto the pre-pass backups
reproduces the current seeds exactly (2 539 edges, 109 fields, 0 differences).

The agent brief is `BRIEF.md`; it is the contract the validator enforces.
