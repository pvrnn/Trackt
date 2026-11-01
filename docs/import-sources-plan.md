# Account imports: more sources, a worker, and a browser for the ones without an API

Status: plan + build notes (`feat/import-sources`). Supersedes nothing; extends
the MyAnimeList importer shipped in `@trackt/imports` (ROADMAP "Done").

## What ships

| Source | Access | Kinds | Identity we join on | Credential |
| --- | --- | --- | --- | --- |
| MyAnimeList | HTML pages + their `load.json` (scrape, browser optional) | anime, manga | `external_ids.mal`, else title+year | none |
| AniList | GraphQL, no auth | anime, manga | `external_ids.anilist` | none |
| Letterboxd | HTML scrape | movie | `external_ids.tmdb` / `.imdb`, else title+year | none |
| Trakt | API v2, `trakt-api-key` | movie, series (per season) | `external_ids.tmdb` (+ `season_number`) | `TRAKT_CLIENT_ID` |

Everything runs through one pipeline — fetch → map → resolve → plan → apply — and one
CLI (`pnpm import -- --source <id> --user <email|uuid> --profile <name>`), plus an
`importer` queue job so the web/mobile wizard is a producer away.

## Sources that were investigated and are NOT implemented

Recorded so nobody re-opens the question blind. Each one was probed from this
machine on 2026-10-30 (plain `fetch`, browser user-agent).

- **Simkl** — its API only exposes another user's library behind an OAuth app
  token; the public profile pages answer `403` to any non-browser client. Adding
  it means registered OAuth credentials per instance for a list we can already
  read from Letterboxd (films) and Trakt (series). Not worth it.
- **Serializd** — no API, and `serializd.com/user/<name>/shows` answers `403`
  (Cloudflare). Scraping it needs a real browser plus a per-site parser that
  breaks on their deploys. Trakt covers the same ground (TV) with a documented
  API.
- **TV Time** — no public API; the app's own endpoints are authenticated and
  unofficial, and their GDPR export is an email. Out of reach by design.
- **Kitsu** — real public API, but a library entry names an *anime id we do not
  store*; the MAL/AniList mapping is one request per title
  (`/anime/{id}/mappings`), so a 500-entry list is 500 requests against a
  60/min limit. The only cheap fix would be a second id space in the catalog for
  a source nobody asked for.
- **IMDb / Goodreads / Backloggd** — IMDb's watchlist and Goodreads' shelves are
  exports or Cloudflare-gated HTML; Backloggd renders client-side with no
  server-side grid. Backloggd (games) is the one worth revisiting, with a
  browser, if game imports matter.

## The pipeline, generalised

`ImportEntry` is provider row → Trackt vocabulary. It was MAL-shaped
(`externalId: number`, `kind: 'anime' | 'manga'`); it is now source-generic:

```ts
interface ImportEntry {
  source: ImportSource;              // 'mal' | 'anilist' | 'letterboxd' | 'trakt'
  kind: MediaKind;                   // anime | manga | movie | series | webtoon | game
  externalId: string;                // provider id, stringified (MAL 21, an AniList id, a Letterboxd slug)
  title: string;                     // for the report; never written to the catalog
  year: number | null;
  seasonNumber: number | null;       // ADR-0003: a series row is one season
  status: LogStatus;
  score: number | null;              // 0–10, Trackt's scale — the mapper converts
  progress: number;
  repeats: number;
  startedAt: string | null;          // YYYY-MM-DD, or null (ADR-0007 needs a day)
  finishedAt: string | null;
  notes: string | null;
  /** Provider ids harvested while fetching; the resolver tries these first. */
  externalIds: ExternalIds;
}
```

Score is normalised **in the mapper**, never downstream: MAL 0–10 as-is, AniList
0–100 ÷ 10 (asked for as `score(format: POINT_100)` — the bare field is in the
account's own format, so a POINT_10 account answers 1–10), Letterboxd 0.5–5
stars × 2, Trakt 1–10 as-is.

### The source registry

`src/sources.ts` holds one `ImportSourceDefinition` per source and is the only
place a source's *shape* is declared:

```ts
interface ImportSourceDefinition {
  id: ImportSource;
  label: string;                     // 'Letterboxd' — shown by the API's source list
  kinds: readonly MediaKind[];       // what the source can yield
  joinKeys: readonly string[];       // external_ids keys, in priority order
  credential: { env: string; hint: string } | null;
  access: 'api' | 'scrape';
  /** Scrape sources may need a real browser (Cloudflare); see http/fetch.ts. */
  browser?: boolean;
  /** Last resort: strict normalised title + exact year, unique match only. */
  titleFallback: boolean;
}
```

### Resolution

`resolveImportEntries` no longer assumes MAL's single id space. For each entry it
walks the source's `joinKeys`, taking values from `entry.externalIds`, and takes
the first hit among rows of the entry's kind (plus `deleted_at IS NULL AND
moderation = 'verified'`, the same visibility rule as `canViewMedia`). When the
entry names a `seasonNumber`, only a row with that `season_number` matches — a
Trakt show yields one entry per season, and the catalog files one media row per
season.

Only if every key misses **and** the source declares `titleFallback` does it try
the title, and it tries it as a **score** (`packages/imports/src/match.ts`)
rather than an equality. Candidates are every row of the entry's kind within
**±2 years** — providers date a film by their own release, so *Good Manners* is
2017 on Letterboxd and 2018 in TMDB, and *The Raid* is a year out — and each is
scored on three signals, averaged over the ones both sides state:

- **title** (weight 0.6) — the lower of an edit-distance ratio over the
  normalised titles and the share of words that found a partner (a word counts
  if it is itself ≥0.8 similar). Character distance alone scores "Blade Runner"
  against "Blade Runner 2049" at 82% and "The Grey" against "The Prey" at 88%;
  the word term is what refuses both. Synonyms are scored the same way, so an
  original-language title can carry a row an English title cannot.
- **year** (weight 0.3) — 1 on the same year, 0.5 one year out, 0.25 two. A
  perfect title therefore scores 1.00 same-year, ~0.83 one year out (a match)
  and ~0.75 two years out (a refused near miss the report keeps).
- **originCountry** (weight 0.1) — a tie-breaker, never a filter: only
  Letterboxd's film pages and TMDB's metadata carry it, and a mismatch costs
  weight rather than vetoing the row. This is what separates the two 2023
  *Cobweb* films (KR and US) when the provider states a country.

A candidate above **80%** is a match, and the highest score wins. Two candidates
within 1% of each other are not a match: the score has to *separate* them, so
that stays `ambiguous-title-match`, as it was under the old exact rule. A guessed
title that is not identical (the title term below 1) also gets a
`fuzzy-title-match` warning naming both titles and the score, and the plan row
records `matchScore` beside `matchedBy: 'external-id' | 'title'` — a report can
say how close each guess was. Unmatched rows record `closestScore`/`closestTitle`
for the best row the rule *refused*, so "never had the work" (0.00–0.3) is
distinguishable from "the catalog has it twice" (1.00) and from a near miss
(0.75, `The School of Rock`) without re-running anything.

Measured against the instance's 2 835 films and the 140 k-row catalog, replaying
the saved `regelegorila` plan: exact-year-only left 280 rows unmatched; scoring
titles brought that to 278; **the ±2-year window brings it to 152**, of which 152
− 9 are genuinely absent and 9 are the same-title ties. Of the 126 rows the year
window recovers, 125 carry the identical title and one is *School of Rock* → *The
School of Rock* — which is what a release-convention gap should look like.

## The central catalog is part of resolution, not just of search

An instance carries only the works it has served: a search materializes a hit
once and never syncs again (ADR-0002), so a film library is routinely 90%
"not in catalog" while the *catalog* holds nearly all of it — 2 530 of 2 682 for
the first Letterboxd import run here. Local resolution sees none of those.

So resolution has a second question for anything it could not place: **does the
central catalog carry this work?** The importer asks `/v1/catalog/search` by
title (kind-scoped), keeps a hit only on the same rules as the local fallback —
normalised title or synonym equality, exact year, one hit — and on a real run
materializes it with the *same* `buildProviderMediaRow`/`insertNewProviderMedia`
federated search uses, then logs against it. A dry run asks and writes nothing;
the plan reports `fromCatalog` so a preview says "2 245 of these come from the
catalog" rather than pretending they are local.

Two constraints shape it:

- **The catalog is rate-limited** (300 requests a minute per IP) and thousands of
  lookups is what an import is. The walk is serialised (250 ms between lookups by
  default, `catalogConcurrency`/`catalogSpacingMs` to tune) and a `429` is waited
  out with backoff, up to four attempts. A lookup that still fails is *reported*
  (`partial-source`: "N of M lookups failed — re-run rather than trusting not in
  catalog"), because silence there reads as "the catalog doesn't have it".
- **Ambiguity is still refused.** `Fireworks` (1997), `The Return` (2003),
  `The Odyssey` (2026), `Brothers` (2024), `Cobweb` (2023), `Beast` (2022),
  `mother!` (2017), `Aladdin` (1992) exist twice in the catalog with the same
  title and year; each scores within the tie margin and gets
  `ambiguous-title-match`. Title+year is all a Letterboxd entry provides, and a
  coin flip is not a match — a source that states a country can break such a
  tie, and one that does not stays unmatched.

Because a run is a snapshot of the instance's `media` table, `--from-report
<file>` re-resolves a saved report — same rows, same rules, no provider request
at all — which is the cheap half of a re-run once an instance has materialized
more of the catalog.

## What the score cannot settle is stored, not logged

An unresolved row used to end at a log line, which is a dead end: the only
person who knows which *Cobweb* (2023) someone watched is the person who
watched it. So every applied run writes its open questions to **`import_match`**
(migration 0022), and a client can ask the viewer to answer them.

- **What is stored**: one row per (user, source, entry key) with the provider row
  (`title`, `year`, `status`, and the whole `entry` as JSON), the outcome
  (`tie` when rows scored alike, `below-threshold` when one was close), the best
  score, and `candidates` — up to five `{ id, title, year, score, origin }`,
  where `origin` says whether the row is this instance's `media` or a central
  catalog id (materialize-on-pick is the frontend's later step).
- **What counts as uncertain**: a candidate above **0.5** (below that it is noise,
  not a question) and within **0.15** of the best (0.98 next to 0.62 is one real
  candidate and one word in common — a picker that shows both teaches people to
  ignore it), or any tie inside the 1% margin.
- **Lifecycle**: a run *replaces* the unresolved set for its (user, source) — a
  re-run recomputes the plan, so yesterday's shortlist is stale by definition —
  while rows the viewer already answered (`resolved_at`) survive, because the
  answer outranks a later run's doubt.
- **Read path**: `GET /v1/me/import/uncertain` (session) returns the viewer's
  unanswered rows, closest call first. Answering them, and writing the log from
  the stored `entry`, is the frontend's next step.

On the `regelegorila` library this keeps **63** of its 152 unmatched rows: 9
ties and 54 below-threshold shortlists. The other 89 scored under 0.5 against
everything the instance and catalog carry — those are genuinely absent, and a
picker with nothing to pick would be a dead end.

## Scraping, and where a browser is actually needed

Letterboxd serves its grids to plain HTTP: `/films/`, `/watchlist/` and
`/films/diary/` are server-rendered, 72 posters a page, each carrying
`data-item-slug`, `data-item-full-display-name="Whalefall (2026)"` and a
`rated-N` span for the owner's rating. Those parse with a regex and no browser.

What does *not* survive plain HTTP is anything behind Cloudflare: the JSON
endpoint (`/film/<slug>/json/`) answers `403 Just a moment…`, and repeated
requests start 403ing the diary too. So the fetcher is a seam, not a hard
dependency:

```ts
interface PageFetcher {
  get(url: string): Promise<{ status: number; body: string }>;
}
```

- `createHttpFetcher()` — the default: `fetch` with a browser user-agent, a polite
  delay between requests, and a request budget.
- `createBrowserFetcher()` — lazily `import('playwright')` (an **optional**
  dependency, never installed by CI or the Docker image), launches Chromium
  headless — or attaches to an existing browser via `PLAYWRIGHT_WS_ENDPOINT` —
  loads the page, waits for the selector the caller names, and returns the final
  HTML. `IMPORT_FETCH_MODE=browser` selects it; a scrape source whose HTTP fetch
  gets a Cloudflare challenge retries once through the browser when one is
  available, and otherwise fails with a message that names the flag.

A browser is therefore an *operator opt-in*: `pnpm add -w playwright && pnpm exec
playwright install chromium`. The Docker image does not ship it (300 MB of
Chromium to read one public page), and no test needs it — scraper tests run
against fixtures captured from the live site.

### Letterboxd, measured (2026-10-30)

The grid *markup* parses with no browser; fetching it may not. From this machine
plain HTTP was challenged (`403`, `Just a moment…`) on the first
`/films/page/1/` request, while `/watchlist/` answered `200` for a dozen pages
and the diary only answered through Chromium. `IMPORT_FETCH_MODE=fallback` is
therefore the realistic default for this source, not an emergency lever.

- A films page is 72 posters, a diary page 50 rows; both end with a page that has
  no `<a class="next">`.
- The diary prints its month and year once per month and leaves those cells empty
  on the rows below, so the parser carries them forward. Its later pages live at
  `/<user>/diary/films/page/<n>/`, not under `/films/`.
- `/film/<slug>/` (200 through the browser) carries both
  `themoviedb.org/movie/<id>` and `imdb.com/title/<tt…>` links, which is the whole
  enrichment path — one request per film, hence opt-in and capped.

### MyAnimeList, measured (2026-11-01)

MAL was the one source that shipped on its documented API (`X-MAL-CLIENT-ID`),
which needs a registered client id and does not expose favourites. Its own pages
carry both, so the source now reads them and needs no credential.

- `/animelist/<user>?status=7` prints the first 300 rows in a `data-items`
  attribute (HTML-escaped JSON) and pages the rest in from
  `/animelist/<user>/load.json?status=7&offset=<n>` — 300 rows a page, an empty
  array past the end. The page's 300 are **not** the endpoint's first 300: they
  are a re-sorted subset (19 of Kyoma__'s 300 were not in `load.json`'s first
  page), so the client pages the endpoint from 0 and dedupes by id rather than
  trusting the page for page one.
- A row carries the numeric status (1 watching/reading, 2 completed, 3 on hold,
  4 dropped, 6 plan), the score (0 = unscored), episode/chapter progress, the
  comment, the two log dates as MAL prints them (`DD-MM-YY`) and the work's own
  start date — the year the title fallback needs.
- `/profile/<user>/favorites` is server-rendered too: `<h5>Anime</h5>` /
  `<h5>Manga</h5>` sections of `.boxlist` items linking to `/anime/<id>/…`, with
  `TV ･ 2006` beside the title. Characters and people are separate sections and
  are not works. A favourite the lists do not carry has no status to import, so
  it is warned about (`favourite-not-listed`) rather than guessed at.
- Plain HTTP answers all of it; `IMPORT_FETCH_MODE=browser` also works because
  the browser fetcher now returns a JSON endpoint's body instead of the markup
  of Chromium's JSON viewer.

## What a provider says about a film, and what it does not

Two rules came out of importing a real Letterboxd library:

- **A film is seen in one sitting, so its two log dates are one day.** It is a
  plan rule (`datesForTarget`), not a mapper habit: any part-less work whose
  provider states one date gets both, so no source can import a film that starts
  today and never finishes. A part-carrying work keeps whatever it published —
  a season really can span weeks.
- **Letterboxd's diary "Like" column is a favourite.** `favourite` is on
  `ImportEntry` (every source states it; only Letterboxd has one), and the apply
  writes the pin *outside* the existing-log check: a log the viewer already had
  still gains the like their profile carried, the insert is idempotent, and an
  import never clears a favourite. Rank is appended within the kind, exactly as
  `PUT /v1/media/:id/favorite` does. On the sample library: 813 favourites.

## The worker

`QUEUES.importer` carries one job type, declared once in
`packages/imports/src/job.ts` — the API produces it and `apps/worker` consumes
it, so neither can drift:

```ts
interface ImportJobData {
  userId: string;
  source: ImportSource;
  profile: string;
  overwrite?: boolean;
  dryRun?: boolean;
}
```

- Producer: `POST /v1/me/import` (authenticated) validates the source and
  enqueues. One job per (viewer, source) and kind of run, id `${userId}-${source}`
  — or `${userId}-${source}-preview` for a `dryRun: true` body, which is what the
  web wizard previews with; a preview must not join, and so swallow, the real run
  it previews. BullMQ reserves `:` inside a custom id, which is why it is not the
  colon the first draft assumed. A double-click therefore joins the job already
  waiting or running; a finished job is removed and re-queued, so the same source
  can be imported again later. A source whose credential env var is unset is
  refused with a 409 that names the variable, before any job is created.
- `GET /v1/me/import/:jobId` reports BullMQ state, progress and the completed
  result; another viewer's job answers 404 rather than 403, so the route never
  confirms a job it will not show. `GET /v1/me/import/sources` lists what this
  instance can actually run — an unset credential, or a scrape source with
  `IMPORT_FETCH_MODE` still at `http`, comes back `available: false` with the
  reason. No secret leaves the process.
- Consumer: `apps/worker` runs a BullMQ `Worker` on the `importer` queue with
  concurrency 1 — an import is a scrape of somebody's profile, and two at once
  is rude to the provider. The processor is exported separately
  (`createImportProcessor`), so the wiring is tested with a fake job and a
  stubbed pipeline: no Redis, no network.
- Progress comes from the apply loop rather than the pipeline as a whole
  (`applyImportPlan`'s optional `onProgress(done, total)`, forwarded by
  `runImport`), because apply is the only per-row step. The job result is a
  JSON-sized summary — plan counts plus `matchedByTitle`, the report, and the
  first 100 unmatched rows with a `truncated` flag — never the plan itself.
- Failures carry the importer's own error kind. BullMQ keeps an error's message
  but not its class, so the processor writes `errorKind` into the job's progress,
  which is the only field the API can read back on a failed job; the client can
  then say *why* (wrong profile name, private list, missing credential,
  rate-limited) instead of "import failed".
- Retries: 2, exponential. A job is idempotent per row (existing logs are left
  alone unless `overwrite`), which is what makes a retry safe.

## Testing

- Every mapper and parser is unit-tested against **fixtures** captured from the
  live service (JSON bodies, HTML pages) — no network in `pnpm test`.
- The resolver's new joins (key priority, season matching, title fallback,
  ambiguity refusal) are integration-tested against the database, with the
  existing self-skip rule when Docker is absent.
- The worker's processor is tested with a fake `Job` and a stubbed importer, so
  the queue wiring is covered without Redis.
- A CLI run keeps nothing: an unmatched row writes no row anywhere, so the
  console's thirty-line sample was the only trace of the other 2 500. `--report
  <file>` (JSON, or CSV when the path ends in `.csv`) now writes the whole plan —
  every row with its provider id, year, score, status, `matchedBy`, the catalog
  title it landed on and its warnings — before the console truncates anything.
  Gitignored, under `data/`.
