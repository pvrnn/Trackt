# TMDB movie seed scraper

Fetches TMDB movies through `discover/movie` and writes the same seed-file layout
the other catalog scrapers use. Two orders are offered: `rating` (the default,
`vote_average` behind a vote floor) and `popularity` (`vote_count`), the second
being what a "most-watched films" catalog wants. `series.ts` does the same for
TV, one row per season (see [Series seeds](#series-seeds)).

```sh
# Default: the ten highest-rated movies with at least 10 000 votes
pnpm scrape:tmdb

# A longer run, an explicit floor, localized titles, or a throwaway file
pnpm scrape:tmdb --limit 250 --min-vote-count 1000 --language fr-FR --out /tmp/opencode/movies.json

# The 30 000 most-voted movies — a run past 10 000 rows, so it is partitioned by
# release year and takes ~30 000 detail requests (about half an hour)
pnpm scrape:tmdb --limit 30000 --sort popularity --min-vote-count 10 --concurrency 3
```

Credentials are read from `~/.config/opencode/tmdb.env`
(`TMDB_READ_ACCESS_TOKEN`, optionally `TMDB_API_KEY`), or from
`TMDB_READ_ACCESS_TOKEN`/`TMDB_API_KEY` environment variables. The read-access
token is sent as a bearer header; the API key, when that is all there is, goes in
the `api_key` query parameter. The output path defaults to
`apps/catalog/seed/top-movies-tmdb.json`; that directory is gitignored because it
contains provider data intended for local seed/import workflows.

The file preserves the catalog seed row shape — one `kind: "movie"` row per
film, canonical uuid derived from the TMDB id (`tmdb:movie:<id>`, ADR-0001),
`externalIds` of `{tmdb, imdb}` — so `apps/catalog` `db:seed` loads it as it
stands. `coverUrl` is the `w500` poster and `bannerUrl` the `w1280` backdrop.
There are no relation edges: this pass reads a ranking, not a graph.

`metadata` carries the provider facts with no catalog column — all of it
carried for analysis, nothing renders it yet:

| key                            | source                       | why it is there                                                                                                                                                                                |
| ------------------------------ | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `providerScore`, `ratingCount` | `vote_average`, `vote_count` | the average on the other importers' 0–100 scale, and the votes behind it                                                                                                                       |
| `releaseDate`                  | `release_date`               | the exact date. `media.release_date` exists as a column but is only ever filled by the dev seed (`packages/db/src/seed-data.ts`), so a federated movie currently shows a year and nothing more |
| `runtime`                      | `runtime`                    | minutes                                                                                                                                                                                        |
| `originalLanguage`             | `original_language`          | ISO 639-1                                                                                                                                                                                      |
| `directors`, `writers`         | `credits.crew`               | job `Director`, and `Screenplay`/`Writer`/`Story`. A `Novel` credit is a source, not a screenwriter, so it is left out                                                                         |
| `originCountry`                | `origin_country`             | production country, which is not the same as the language                                                                                                                                      |
| `spokenLanguages`              | `spoken_languages`           | English names                                                                                                                                                                                  |
| `tagline`, `format`            | `tagline`, literal           |                                                                                                                                                                                                |

`synonyms` holds the native title plus one French and one Spanish title: TMDB
states the original title on the movie itself (and leaves the original
language's `translation.data.title` empty), while the others come from
`translations` — picking the region that matches the language, since TMDB also
lists `fr-CA` and `es-MX` variants. Nothing else is kept: the 50-language
translation list is a marketing dump, not a set of titles a reader searches for.

## Ranking

`vote_average` is an average, so on its own it says nothing about how many
people stand behind it: TMDB's own top-rated list admits films with ten votes.
The `vote_count.gte` floor is what makes a small run mean "the top movies"
rather than "ten films four people liked". It defaults to 10 000: at 5000 a film
still in the first weeks of its voting — 8.6 from 8.5k votes — sat third above
`12 Angry Men`, so the floor has to clear the newest releases to hold the canon.
Lower it deliberately, not to make a run longer.

`--sort popularity` swaps the order for `vote_count desc`. That is a different
question — "what do people actually watch" rather than "what is well reviewed" —
and it needs a much lower floor: only 396 films clear 10 000 votes, so a 30 000-row
popularity run uses `--min-vote-count 10` and lets the order do the selecting
(the 30 000th most-voted film still carries hundreds of votes).

One `discover/movie` page (20 rows) plus one `/movie/{id}` request per selected
film, since the ranking payload carries no genre names, runtime, credits or
translations. That is 11 requests for the default run; a 250-row run is 263.
The detail request is `?append_to_response=credits,translations`,
which is ~100 KB per film — nearly all of it the cast and crew list, of which the
seed keeps two jobs.

### Runs past 10 000 rows

One discover query answers 500 pages of 20 rows and refuses to report more than
20 001 results, so it cannot rank a larger list on its own. Above 10 000 rows the
scrape splits the ranking into `primary_release_year` partitions — no year comes
near the cap — and merges them back into the single global order a bigger query
would have given. Pages are pulled only when a partition's buffer empties, so a
30 000-row run costs about 1 500 page requests rather than walking every year to
the end. `ranking.partitionedBy` records whether that happened.

The year partition also means a film with no primary release date is not
eligible for such a run; every other film is in exactly one partition.

### `--concurrency` and `--resume`

Detail fetches run `--concurrency` (default 3, max 8) at a time — about 40
requests a second at 3, the pace TMDB documents. Each converted row is appended
to `<out>.checkpoint.jsonl` as it arrives, so an interrupted run picks up where it
stopped:

```sh
pnpm scrape:tmdb --limit 30000 --sort popularity --min-vote-count 10 --resume
```

`--resume` skips the films already in the checkpoint and the seed keeps the
ranking order regardless of the order the rows arrived in. A film TMDB refuses to
return is reported and left out; the run writes the rest and exits non-zero so
`&& pnpm db:seed` does not publish a short seed unnoticed.

## Series seeds (`series.ts`)

```sh
# The 30 000 most-voted non-anime series seasons (9 300 shows, ~15 minutes)
pnpm scrape:tmdb:series --limit 30000 --sort popularity --min-vote-count 10 --exclude-anime
```

`--limit` counts **season rows**, not shows: a row is one season (ADR-0003,
`tmdb:series:<showId>:<seasonNumber>`), because that is the unit a user tracks.
Specials (season 0) and seasons with no episodes are left out, so one show
contributes as many rows as it has real seasons. `partCount` is that season's
episode count and `seasonNumber` its number; the title stays the show's, so a
search for "breaking bad" returns every season.

TMDB has only **19 837** shows above ten votes and discover refuses more than
20 001 results, so "30 000 series" can only mean 30 000 season rows. The walk is
partitioned on `first_air_date_year` (the movie run's `primary_release_year`), one
`/tv/{id}` request per show covers all of its seasons at once — `seasons[]`
carries each season's episode count, air date, poster and overview — and it
stops as soon as the row limit is reached. Shows average 3.2 seasons, so 30 000
rows come from about 9 300 shows.

`metadata` carries what the slim contract has no column for: `seasonName`,
`airDate`, `lastAirDate`, `seriesType` (TMDB's own word — `Scripted`,
`Documentary`…), `episodeRuntime`, `creators`, `networks`, `totalSeasons`,
`totalEpisodes`, plus the same provider facts the movie rows carry.
`externalIds` adds `tvdb` beside `tmdb` and `imdb`.

The checkpoint holds one line per show (`{showId, rows}`), so an interrupted run
resumes whole shows and never re-asks for a season it already has.

## Excluding anime

Anime is AniList's job: it issues a per-season id, so its rows are the ones an
instance can derive (ADR-0003). A TMDB row for the same work would duplicate it
under a different provider id. `--exclude-anime` drops **Japanese animation**
(`genres ∋ Animation` and `original_language = ja`) from either scraper, which
leaves Western animation — Pixar, Disney — in place.

TMDB's discover **ignores `without_original_language`** (verified: identical
totals to the unfiltered query), so this cannot be a query filter; it runs on the
rows. `without_genres=16` would drop _all_ animation and `without_keywords=210024`
uses TMDB's own `anime` keyword if a different cut is ever wanted.

## Deduplicating against the AniList seed (`dedup.ts`)

```sh
pnpm dedup:tmdb           # dry run: prints the pairs, writes nothing
pnpm dedup:tmdb -- --apply
```

The TMDB scrapers leave Japanese animation out, so most anime never reaches
these seeds. What crosses over is the rest: donghua, Korean and Western
animation, and CG series TMDB did not tag `Animation` — the same works the
AniList seed already holds. `dedup.ts` folds each of those TMDB rows into its
AniList row and drops the TMDB row:

- AniList keeps its identity, `format` and `providerScore`; the TMDB facts move
  into `metadata.tmdb` (id, season number, imdb/tvdb, runtime, directors or
  creators, air dates…), and the ids join `externalIds`, so the instance can
  reach both providers from one row.
- A null cover, banner or synopsis is filled from TMDB; nothing is replaced.
- Every removal is written to `dedup-log.json` (the row, where it went, and the
  evidence), and the three seeds are backed up to `*.pre-dedup.bak` first.

Pairing is deliberately strict, because TMDB and AniList share no id: a title or
synonym match **and** a release year within one **and** a compatible format
(film ↔ `movie`/`ova`/`ona`/`special`, season ↔ `tv`/`ona`/`tv short`/`special`/`ova`)
**and** episode counts within 10%. Animation is required unless the synopses
overlap. That is what keeps a live-action adaptation (`Death Note` 2006,
`Tokyo Revengers` 2021) beside its anime instead of deleting it, and what keeps a
264-episode TMDB season from being folded into a 26-episode AniList cour. Those
leftovers are listed under `skipped` in the log with the reason. The pairing is
idempotent: a row that already carries `metadata.tmdb` has taken its pair.

## Caveats

- The seed's descriptions are TMDB overviews and its artwork is TMDB's CDN, so
  the file states the required attribution (`This product uses the TMDB API but
is not endorsed or certified by TMDB.`). Keep that line if a seed is ever
  republished as a file.
- A long run costs disk as well as time: the checkpoint holds one compact row per
  film (~40 MB at 30 000 films) and the seed itself is comparable.
- **Publishing is permanent.** The catalog has no DELETE routes, so a wrong row
  can only be corrected by republishing it. Seed locally first.

## Tests

```sh
pnpm test:scripts
```

`test/scrape.test.ts` covers the argument parsing, the ranking walk (page cap,
dedupe, stopping at the last page), the partitioned merge (one global order,
lazy page pulls, the per-partition page cap), the detail pool's order and
concurrency, checkpoint recovery, credential placement, artwork urls, the
status, genre, synonym, credit and link mappings, and pins the canonical id
against `packages/shared/src/canonical-id.ts` — a drift in the namespace or the
`provider:kind:id` key would otherwise publish rows no instance can derive.
