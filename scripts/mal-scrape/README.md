# MyAnimeList → catalog seed scraper

An operator tool that turns MyAnimeList detail pages into a seed file for the
central catalog's `catalog_media` and `catalog_media_relation` tables.

It exists because the catalog's publish path (`POST /v1/admin/media`) needs a
canonical id, and canonical identity for anime and manga is AniList's id
(ADR-0001) — something a MAL page does not state. The tool reads the MAL page,
resolves the AniList record that shares its `idMal`, and derives the frozen
`uuidv5` id itself, so the output can be seeded locally **and** published to a
deployed catalog.

It is deliberately standalone: node builtins only, no workspace imports, no
build step — a single file you can copy anywhere and point at any anime or manga
page.

```sh
# a seed file, no writes
pnpm scrape:mal https://myanimelist.net/anime/5114/Fullmetal_Alchemist__Brotherhood \
  --anilist --out apps/catalog/seed/fmab.json

# accumulate several pages into one file
pnpm scrape:mal 52991 --type anime --anilist --merge apps/catalog/seed/fmab.json

# publish to a deployed catalog (idempotent upserts)
CATALOG_URL=… CATALOG_ADMIN_TOKEN=… pnpm scrape:mal <url> --anilist --publish
```

`apps/catalog/seed/` is gitignored on purpose: the output is redistribution
data, and ADR-0001 keeps that out of the repository.

## From AniList: the same data in minutes

`from-anilist.ts` is the import you want for a full catalog. AniList is the
identity provider (ADR-0001), so it answers with the `id` a canonical uuid is
derived from, the whole row, and every relation — **50 works per request**.

```sh
# MAL's exact top-10000 set and order, every fact from AniList (~10 min)
pnpm scrape:anilist --out apps/catalog/seed/top-anime-anilist.json

# AniList's own ordering, no MAL involved (the API caps a score-sorted walk at 5000)
pnpm scrape:anilist --source anilist --sort POPULARITY_DESC --max-rank 5000

# the same for manga: MAL's topmanga list, resolved through AniList's MANGA namespace
pnpm scrape:anilist --kind manga
```

`--kind manga` switches the walk's namespace: it reads `topmanga.php` instead of
`topanime.php`, resolves ids with `type: MANGA` (MAL's anime and manga ids are
separate namespaces, so `idMal_in` alone would match the wrong work), keeps the
`manga`/`one_shot` formats, and writes `apps/catalog/seed/top-manga-anilist.json`.
The seed still contains anime rows — the manga's adaptations — exactly as the
anime seed carries its manga. `--source anilist` cannot reach 10k for either
kind: the API refuses a sorted walk past 5000 entries.

`--source mal-ranking` (default) walks MAL's ranking pages **for their links
only** — 200 cheap list pages, no detail pages — then resolves those MAL ids
through `idMal_in`, 50 at a time. That is 400 requests for the whole top 10000,
versus 10200 for the HTML scraper, and the API's 30 requests/minute is what sets
the pace (`--delay`, default 2000 ms).

### Everything AniList has: `--source anilist-all`

Both walks above stop well short of the provider's catalogue, and neither can be
pushed further:

- MAL's ranking **ranks ~23,050 anime** and paginates to ~30,650 entries; past
  the ranked set the rank column renders `–` and the parser drops the row. The
  unranked tail is not worth having either — sampled pages at limit 24000 resolve
  to 29 of 31 music videos, and at 30500 to 49 of 50 one-episode OVAs.
- A sorted AniList walk stops at page 100 (`Page depth exceeds maximum allowed`),
  i.e. 5,000 works. `pageInfo.total` is no help in sizing anything: it is capped
  at 5,000 and reports the cap for any non-empty filter.

```sh
# every anime AniList dates, no popularity floor
pnpm scrape:anilist --source anilist-all

# the same for manga; the seed grows by two orders of magnitude over the ranking
pnpm scrape:anilist --source anilist-all --kind manga
```

The walk tiles the namespace with **start-date year windows** (`startDate_greater`
/ `startDate_lesser`, sorted by id) and pages each one until it answers empty.
Every work with a start date falls in exactly one window, and no year holds more
than 5,000 works — except in manga, where recent years overflow the depth cap, so
a year that comes back full at page 100 is walked again a month at a time (the
lower bound reaches back to `YYYY0099`, which puts a year-only date in January
rather than between two windows). Works in `NOT_YET_RELEASED` carry no date at
all, so a last pass by status collects them.

Sizing, measured on a full walk (2026-10): **19,806 anime** in trackable formats
(music videos aside) against the 16,553 the MAL ranking reaches at its ceiling,
and **129,994 manga** in `MANGA`/`ONE_SHOT` alone — 536 requests / 18 min for
anime, 3,960 requests / 2h12m for manga, whose recent years hold ~8,000 works
each. Manhwa are still refused — no identity provider, so no canonical id
(ADR-0001).

### Pruning the long tail: `pnpm prune:seeds`

An enumeration is not a ranking, and manga shows the difference: of those 129,994
rows, 66,929 carry **no MAL id at all** (web manga, doujin, self-published — the
provider indexes about 500 a week), 21,385 are one-shots, and 77% have no score.
A catalogue that offers all of it makes search compete with works nobody has
ever rated.

```sh
pnpm prune:seeds              # dry run: what the floor would remove
pnpm prune:seeds --apply      # rewrite both AniList seeds, backups *.pre-prune.bak
```

The floor, applied to manga rows only (anime is untouched):

- a manga row with **no MAL id** is dropped — MAL's absence is the proxy for
  "nobody outside the provider has indexed it", and before this source existed the
  catalogue had no way to reach it either;
- a **one-shot** is kept only at a provider score of 60 or above, because a
  one-chapter work with no score is indistinguishable from spam. Every other
  manga format keeps its row whatever it scores: a chapter count is not evidence
  of quality. `--one-shot-min-score <n>` moves the bar, `--keep-unmatched-mal`
  switches the id rule off.

Edges whose endpoint the floor removes go with it, computed across both seeds at
once (an edge may point into the other file), so the graph stays closed and
publishable. Measured effect: 72,732 rows and 9,498 edges removed, leaving
**19,806 anime** and **58,402 manga** — the one-shot cut alone keeps 1,170 of
21,385. Run it after any `--source anilist-all` walk, before `db:seed:all`.

`--max-rank` caps the number of works this source imports (default: no cap), and
`--write-every <n>` writes the seed every n pages instead of after each one: at six
figures the whole file is 150 MB, and re-serialising it per page costs more than
the requests it protects. The trade-off is that a crash loses up to n pages of
progress instead of one.

Two things this does that the MAL path cannot:

- **Relation targets are rows.** The catalog's edge table has foreign keys on
  both ends and `POST /v1/admin/relations` 404s on an unknown endpoint, so an
  edge whose target is not a `catalog_media` row could never be published. Every
  relation target arrives complete in the same payload, so the seed is a closed,
  publishable graph (≈15k rows for the top 10k anime, the extras being their manga).
- **`season_number` is computed, not guessed.** AniList only says `seasonYear`;
  the ordinal inside a franchise is the depth of the `sequel` chain, so it is
  assigned from the edges once they are all in — 1, 2, 3 … along `A →sequel→ B`,
  deepest predecessor wins for a split cour.

The output also carries, per row:

- `coverUrl` — the AniList CDN cover, **on by default** (`--without-cover` drops it)
- `bannerUrl` — the wide `bannerImage`, on by default (`--without-banner` drops it)
- `metadata` — provider facts with no catalog column: `providerScore` (AniList's
  0–100 `averageScore`), `format` (`tv`, `ova`, `special`, `tv short`…, which is
  what separates a one-episode special from a one-episode series), `startDate`
  and `endDate` (AniList publishes partial dates, so `YYYY`, `YYYY-MM` or
  `YYYY-MM-DD`), `duration` (minutes per episode; a film's running time),
  `volumes` (manga), `studios` (main studios only) and `credits` — the main
  staff, see below
- `synonyms` — at most four: romaji, English, one French, one Spanish
- `urls` — `catalog_media.id → https://anilist.co/anime/<id>`, for redirection.
  It sits beside the table arrays rather than inside them: it is derivable from
  `external_ids` and has no catalog column, so the arrays stay insertable verbatim.

Re-running a scrape without `--with-description` no longer blanks the synopses an
earlier run imported: both the seed merge and the catalog seeder coalesce
`description`, the way they already coalesce cover and banner. The flag controls
what a run downloads, not what survives in the row.

### Credits: who made it, never who voiced it

AniList files every credit — director, key animator, dub scriptwriter, in-between
— as an edge of one `staff` connection, so the importer keeps a whitelist per kind
and stores the role as AniList spells it, minus a trailing parenthetical
(`Story & Art (vols 1-41)` → `Story & Art`, which is how AniList qualifies
roles instead of splitting them):

| kind              | roles kept                                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------------------- |
| `anime`           | `Director`, `Original Creator`, `Original Story`, `Series Composition`, `Script`, `Character Design`, `Music` |
| `manga`/`webtoon` | `Story & Art`, `Story`, `Art`, `Original Creator`, `Original Story`                                           |

`{role, name}` pairs land in `metadata.credits`; `metadata.studios` is the
`isMain` studio list. Voice actors are a separate `characters` connection and are
never requested.

Two API limits shape this:

- A nested connection is capped at **25 rows per page** whatever `perPage` says,
  and the unsorted default mixes key animators into them. `staff(perPage: 25,
sort: [RELEVANCE])` is what makes those 25 the work's main staff; a work with
  fewer than 25 recorded credits simply returns fewer.
- Credits and studios are asked for **on the top-level work only**. Repeating 25
  staff edges on each of a page's ~5 relation targets would multiply a 290 KB
  page; a target that never enters the walk as a top-level work is a thin row,
  which is the same trade-off the seed already makes for other fields.

Per-volume chapter counts are not available: AniList states totals (`chapters`,
`volumes`) and has no chapter entity, so the seed carries the two totals and
nothing per volume.

`externalIds` are `{anilist, mal}` here; AniDB and ANN ids only exist on a MAL
page (AniList's `externalLinks` are streaming links carrying AniList's own site
ids), so a MAL scrape is the only way to get those two.

## Bulk: the whole top-anime ranking

`top-anime.ts` walks `topanime.php?limit=0`, `limit=50`, … — 50 rows per page —
and scrapes every entry, writing one accumulated seed file plus a state file it
resumes from.

```sh
# what would be scraped, no writes
pnpm scrape:mal:top --max-rank 100 --dry-run

# ranks 1-100, into a throwaway file
pnpm scrape:mal:top --max-rank 100 --out /tmp/opencode/top100.json

# the real thing: ranks 1-10000, resumable, safe to kill
pnpm scrape:mal:top --out apps/catalog/seed/top-anime.json
```

Defaults: ranks 1-10000, MAL formats `tv,movie,ona,ova,special,tv special`
(`--types` to narrow, `Music` never reaches a row), 1.5 s between MAL requests.

**It takes hours.** 10000 detail pages at ~1.5 s ≈ 4-5 h, plus AniList lookups
(batched 20 per query, and cached in the state file across runs). Run it with
`nohup` or in a background shell:

```sh
nohup pnpm scrape:mal:top > /tmp/opencode/top-anime.log 2>&1 &
tail -f /tmp/opencode/top-anime.log      # page N: x scraped, y failed | seed … | 1h02m
```

- **Resume is the default.** `apps/catalog/seed/top-anime.json.state.json` holds
  the next page, the ids already scraped, the failures and the AniList ids it
  resolved. Kill it at rank 4000 and the next run continues at rank 4001.
- `--restart` ignores the state and starts over; `--retry-failed` replays only
  the entries that errored (it rescans the page list, but never refetches a
  finished entry).
- The seed file is rewritten after **every page**, so a crash costs one page.
- `--publish` re-sends the whole accumulated file when the walk finishes;
  publishing is idempotent, so a partial earlier publish is just completed.
- A failure is recorded and skipped, not retried in a loop. `state.failed` is
  the worklist, and `state.skipped` holds the deliberate refusals (a `Music`
  entry, a novel) so they are not confused with errors.
- **Five consecutive failures abort the walk** with the cursor unmoved: MAL sits
  behind a WAF, and a sustained block would otherwise mark thousands of entries
  failed and hand `--retry-failed` a worklist of noise. Rerun later; nothing is
  lost.
- **AniList answers 404 for the whole query** when any one `idMal` in it is
  unknown, so the resolver bisects a failing batch down to the culprit and
  retries it under the other medium before giving up on that one id. A single
  unknown manga id (barely-licensed entries, doujin) no longer sinks the page.

## What the page yields

| `catalog_media` column | Source on the page                                                             |
| ---------------------- | ------------------------------------------------------------------------------ |
| `id`                   | derived: `uuidv5(namespace, "anilist:anime:<anilist id>")` — needs `--anilist` |
| `kind`                 | `Type:`, mapped (see below)                                                    |
| `title`                | English alt title, falling back to the romaji `og:title`                       |
| `synonyms`             | romaji, `Japanese:`, `Synonyms:`, plus AniList's synonyms                      |
| `year`                 | start of `Aired:` / `Published:`                                               |
| `status`               | `Status:`, mapped                                                              |
| `genres`               | `Genres:` chips, lowercased and normalised                                     |
| `partCount`            | `Episodes:` (anime) or `Chapters:` (manga)                                     |
| `seasonNumber`         | title hint (`2nd Season`), else `--season`, else 1                             |
| `externalIds`          | `mal` + `anidb` / `ann` from the Resources block + `anilist`                   |
| `description`          | synopsis — **off by default** (`--with-description`)                           |
| `coverUrl`             | `og:image` — **off by default** (`--with-cover`)                               |

Studio, producers, licensors, broadcast slot, duration, rating, demographics,
score/rank/popularity/members/favourites, streaming platforms and the
`Background` note are parsed into the intermediate record and then dropped: the
slim catalog has no columns for them (ADR-0001).

## Relation mapping

MAL's vocabulary is wider than the four stored types, and MAL prints relations
from both sides, so each label maps to a direction as well as a type:

| MAL label                                                             | Stored edge                      | Why                                                                                 |
| --------------------------------------------------------------------- | -------------------------------- | ----------------------------------------------------------------------------------- |
| `Sequel`                                                              | forward `sequel`                 | the target is this work's sequel                                                    |
| `Prequel`                                                             | reverse `sequel`                 | reads back as "prequel"                                                             |
| `Side Story`, `Spin-Off`                                              | forward `spinoff`                |                                                                                     |
| `Parent Story`                                                        | reverse `spinoff`                | reads back as "parent", which a reversed sequel would get wrong                     |
| `Adaptation`                                                          | `adaptation`, oriented by medium | print → screen, decided by kind so the edge is identical whichever page was scraped |
| `Alternative Setting`, `Alternative Version`, `Summary`, `Full Story` | `related`                        | the four types cannot say "recap"                                                   |
| `Character`, `Other`                                                  | skipped (reported)               | character compilations, music videos, ads                                           |

`--map <label>=<type>` overrides any of these, but an override cannot rescue a
target whose MAL `Type` is not a trackable work (`Music`, `Novel`, …) — those are
skipped and listed under `report.skipped` rather than guessed into a row.

### Pairs the providers leave unlinked

```sh
pnpm link:adaptations            # dry run: lists the pairs and the edge each earns
pnpm link:adaptations -- --apply
```

The two AniList seeds are closed graphs — each ships the other kind's rows it
relates to — so a work can appear in both while no edge joins the two rows: an
anime and the manga of the same name and year that the ranking walk reached from
different spines. Same-title-and-year pairs with no edge are the ones at risk of
showing up in search as two unrelated works.

The script only claims what AniList states, asking it directly:

- `ADAPTATION` naming **that** manga → `adaptation`, print → screen (the same
  direction rule as the table above), so the manga page reads "adaptation" and
  the anime page "source";
- `ALTERNATIVE`, `SUMMARY`, `OTHER`, `CHARACTER`, or no relation at all →
  `related`. That covers the honest cases: `Citrus` anime ↔ `Citrus+` (the sequel
  manga AniList points at instead), `Steins;Gate` ↔ `Steins Gate!`.

Edges go to every seed that closes the pair on its own, and to the manga seed
(loaded last) for the rest, since the seeder resolves endpoints against the whole
database. Removals and derivations are logged to
`apps/catalog/seed/adaptation-links.json`, and the seeds are backed up to
`*.pre-link.bak` first.

## Kinds

| MAL `Type`                                   | `kind`                                                                    |
| -------------------------------------------- | ------------------------------------------------------------------------- |
| `TV`, `ONA`, `OVA`, `Special`, `TV Special`  | `anime`                                                                   |
| `Movie`                                      | `anime` (an AniList-keyed film; `movie` rows are keyed on TMDB)           |
| `Manga`, `Manhua`                            | `manga`                                                                   |
| `Manhwa`                                     | `webtoon` — warn: no identity provider, so no canonical id and no publish |
| `Novel`, `Light Novel`, `One-shot`, `Doujin` | skipped                                                                   |
| `Music`, `CM`, `PV`                          | skipped                                                                   |

`--kind` forces a kind for both the row and its relation targets.

## Output

```jsonc
{
  "generatedAt": "…",
  "catalog_media": [/* one object per row, drizzle column names */],
  "catalog_media_relation": [{ "fromId": "…", "toId": "…", "type": "adaptation" }],
  "report": { "sources": [], "skipped": [], "warnings": [] },
}
```

Rows are keyed the way the tables key them (`id`, and `(from_id, to_id, type)`),
so `--merge` re-reads a file and folds a new run in without duplicating
anything — and the arrays drop straight into
`db.insert(catalogMedia).values(seed.catalog_media)`.

`report.skipped` is the audit trail: a relation target AniList does not know, an
unsupported MAL type, a recap film. Nothing is dropped silently.

## Caveats

- **MAL has no usable public API** (v1 retired, v2 needs OAuth client
  registration). This reads HTML, so MAL can change the markup at any time; the
  three fixtures under `test/fixtures/` are trimmed copies of real pages and pin
  the parser. Re-capture them if the parser starts returning nulls.
- **The output is redistribution data.** ADR-0001 accepts it only through the
  central catalog and only as redistributable facts, which is why descriptions
  and covers are opt-in and MAL-authored text stays out by default.
- One request per page with a 1.5 s delay (`--delay`), a retrying fetch, and a
  descriptive User-Agent. `robots.txt` does not disallow `/anime/` or `/manga/`
  for a generic agent, but it does block AI-training crawlers by name — do not
  dress this up as a browser.
- **Publishing is permanent.** The catalog has no DELETE routes, so a wrong row
  or edge can only be corrected by republishing it. Seed locally first.

## Tests

```sh
pnpm test:scripts
```

Node's own runner over `test/*.test.ts` (`scrape.test.ts` for the page parser,
`top-anime.test.ts` for the ranking walk, including resume and `--retry-failed`
against a fake list). Besides the parser, it asserts that
this file's restated constants (catalog namespace, identity providers, media
enums) still match `packages/shared/src/`, so a change there fails here instead
of silently producing ids that no instance computes.
