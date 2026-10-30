# Account imports: more sources, a worker, and a browser for the ones without an API

Status: plan + build notes (`feat/import-sources`). Supersedes nothing; extends
the MyAnimeList importer shipped in `@trackt/imports` (ROADMAP "Done").

## What ships

| Source | Access | Kinds | Identity we join on | Credential |
| --- | --- | --- | --- | --- |
| MyAnimeList | API v2, `X-MAL-CLIENT-ID` | anime, manga | `external_ids.mal` | `MAL_CLIENT_ID` |
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
0–100 ÷ 10, Letterboxd 0.5–5 stars × 2, Trakt 1–10 as-is.

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
the title: normalised (lowercase, accent-stripped, punctuation to single spaces)
equality plus exact year, and only when exactly one local row matches — two rows
with the same title and year is a guess, and the importer does not guess. The
plan row records `matchedBy: 'external-id' | 'title'` so a report can say how
much of an import rested on the fallback.

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

## The worker

`QUEUES.importer` was parked. It now carries one job type:

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
  enqueues; `GET /v1/me/import/:id` reports BullMQ state, progress and the final
  report. `GET /v1/me/import/sources` lists what this instance can actually run
  (a source whose credential env var is unset says so, without naming secrets).
- Consumer: `apps/worker` runs a BullMQ `Worker` on the `importer` queue, calls
  `runImport`, and reports progress as rows are applied (`completed/total`).
  Failures carry the importer's own error kind so the client can say *why*
  (wrong profile name, private list, missing credential, rate-limited).
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
