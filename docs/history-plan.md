# Plan — Log dates (`started_at` / `finished_at`) and the History year view

> **Status:** Proposed — nothing implemented. Deeper context: [PRD](PRD.md) §3.1, [ROADMAP](ROADMAP.md),
> [data model](data-model.md).

## Context

Trackt records **that** you watched something and, per part, **when you ticked it off** — but it has
no notion of when you *started* or *finished* a work, and no surface that answers "what did I watch
in 2025?".

The columns for the first half already exist and are **completely dead**:
`packages/db/src/schema/tracking.ts:34-37` declares `repeats`, `started_at`, `finished_at` and
`notes` on `user_media`, created in migration `0000`; a grep for any of them across `apps/` and
`packages/` returns three hits, all of them that schema file. PRD §3.1 lists "Start/finish dates,
personal notes per entry" and "rewatch / reread counters with dated history" as core tracking
features; none of it is written, read, or exposed.

Downstream, everything that wants a date reaches for a proxy:

- `apps/api/src/routes/v1/home.ts:120-124` counts "completed this year" as
  `user_media.updated_at >= date_trunc('year', now())` — a row touched for any reason (a rating, a
  status correction) counts as a completion this year, and a title genuinely completed in January
  drops out the moment you edit it in a later year.
- `apps/api/src/lib/me.ts:116-133` (`loadYearCheckinCounts`) counts *check-ins* since Jan 1, which
  is a good activity number but says nothing about titles, and is hard-coded to the current year.
- A movie has no parts, so it produces no `progress` rows at all: a year of films is invisible to
  every "this year" number the app currently shows.

And there is no page. The ROADMAP backlog carries a **Library page** item ("the viewer's whole
tracked collection, filterable by status/kind — the home IN PROGRESS shelf is capped at 12 and no
route or endpoint lists the rest"). The year view described here is that page with a date axis
added, so this plan **supersedes** that backlog item rather than landing beside it.

Outcome: starting and finishing a work stamps dates automatically; the dates are visible and
editable on the media page; and `/history` shows what you watched in a given year — filterable by
year, season, kind and status, with a stats strip on top.

**Out of scope** (see §10): cumulative time watched, per-run rewatch history, per-part diary
entries, importers, and anything a friend can see (the history is the viewer's own, on `/me/*`).

### Decisions taken

| Question                              | Decision                                                                                   |
| ------------------------------------- | ------------------------------------------------------------------------------------------ |
| Where dates live                      | The existing `user_media.started_at` / `finished_at` — **no new table** (§1)                  |
| What stamps `started_at`              | First check-in, or a status change into `in_progress` / `completed` / `paused` / `dropped`     |
| What stamps `finished_at`             | A status change into `completed` **only** — `dropped` is not "finished" (§2)                  |
| Re-opening a completed log            | Clears `finished_at`; `planned` clears both (it already sweeps progress)                      |
| Manual edits                          | A separate `PATCH /v1/media/:id/log` — `PUT` keeps owning status (§3)                        |
| Which date a work is filed under      | `COALESCE(finished_at, started_at)` — finished works file by finish, everything else by start |
| Rows with neither date                | Excluded from history. After the backfill that means `planned` only — a watchlist, not history |
| Season boundaries                     | Anime quarters: winter Jan–Mar, spring Apr–Jun, summer Jul–Sep, autumn Oct–Dec (§4)           |
| Timezone                              | UTC, matching `loadStreak` / `loadYearCheckinCounts`; no per-user timezone column yet          |
| Time watched                          | Deferred — the data does not exist (§10)                                                      |

---

## 1. Data model

**No new columns and no new table.** `started_at` and `finished_at` are already `date` (not
timestamp), which is the right type: a viewing start is a day, not an instant, and a `date` has no
timezone to get wrong when the user types one in by hand.

Two changes to `packages/db/src/schema/tracking.ts`:

```ts
// on user_media's index list
// The history query filters one user's rows by the date they're filed under and
// pages in that order. COALESCE is IMMUTABLE, so it indexes.
index('user_media_user_logged_idx').on(t.userId, sql`COALESCE(${t.finishedAt}, ${t.startedAt}) DESC`),
```

Expression indexes are expressible in Drizzle here — `packages/db/src/schema/media.ts:100` does the
same with `(external_ids ->> 'tmdb')`.

**Backfill migration** (hand-written, alongside the generated one — the precedent is
`packages/db/migrations/0003_year_backfill_and_synonyms_index.sql`, which drizzle-kit could not
express either). Every existing log row has both dates NULL, so without a backfill the feature ships
to an empty page for anyone already using the instance:

```sql
-- Dates from the check-ins that prove them (UTC, per loadStreak's convention).
WITH bounds AS (
  SELECT p.user_id, mp.media_id,
         min((p.watched_at AT TIME ZONE 'UTC')::date) AS first_day,
         max((p.watched_at AT TIME ZONE 'UTC')::date) AS last_day
  FROM progress p JOIN media_part mp ON mp.id = p.part_id
  GROUP BY p.user_id, mp.media_id
)
UPDATE user_media um SET
  started_at  = b.first_day,
  finished_at = CASE WHEN um.status = 'completed' THEN b.last_day ELSE NULL END
FROM bounds b
WHERE b.user_id = um.user_id AND b.media_id = um.media_id;
--> statement-breakpoint
-- Movies and anything logged without a check-in: the row's own age is the only
-- evidence there is. Deliberately not applied to `planned` — a watchlist entry
-- has no viewing date, and inventing one would file it into the history.
UPDATE user_media SET
  started_at  = COALESCE(started_at, (created_at AT TIME ZONE 'UTC')::date),
  finished_at = CASE WHEN status = 'completed'
                     THEN COALESCE(finished_at, (updated_at AT TIME ZONE 'UTC')::date) END
WHERE status <> 'planned';
```

Run `pnpm db:generate` for the index, then add the backfill as its own numbered migration so the two
never have to be reviewed as one file. Review the emitted SQL per `CONTRIBUTING.md`.

⚠️ The backfill's second statement is a guess dressed as data — a title imported and marked completed
long after the fact gets the import date. That is acceptable *because* §3 makes every date editable,
and it is strictly better than the alternative (an empty history for every existing user). Say so in
the ADR, not just here.

## 2. Write rules — what stamps what

All of this lands in `apps/api/src/routes/v1/tracking.ts`. "Today" is `CURRENT_DATE` **in the
statement**, not a JS `new Date()` — the API and the database must not disagree about the day, and
the existing routes already compute nothing date-shaped in TS.

**`PUT /media/:id/log`** (`tracking.ts:137-147`) — the upsert grows a date clause per status:

| New status    | `started_at`               | `finished_at`      |
| ------------- | -------------------------- | ------------------ |
| `planned`     | `NULL`                     | `NULL`             |
| `in_progress` | `COALESCE(existing, today)` | `NULL`             |
| `paused`      | `COALESCE(existing, today)` | unchanged          |
| `dropped`     | `COALESCE(existing, today)` | unchanged          |
| `completed`   | `COALESCE(existing, today)` | `COALESCE(existing, today)` |

Three things the table is saying deliberately:

- **`COALESCE`, never overwrite.** A user who marks a series completed, then paused, then completed
  again must not have their real start date replaced by today's. The only writes that clear a date
  are the two explicit ones below.
- **`planned` clears both**, because it already means "none of this has happened" — the route sweeps
  every check-in for `planned` today (`setAllProgress(..., false)`, destructive and documented as
  such). Dates leaving with the check-ins is the consistent behaviour.
- **`in_progress` clears `finished_at`.** Moving a completed log back to in-progress is either a
  correction or a rewatch; in both readings "finished on" is no longer true. The lost date is
  recoverable by hand (§3). This is the one rule to revisit when dated rewatch runs land (§10) —
  at that point the clear becomes "close the current run and open a new one".
- **`dropped` does not stamp `finished_at`.** Dropped works still appear in the history, filed under
  their start date by the `COALESCE` rule in §4 — but `finished_at` keeps meaning *completed on*,
  which is what the column is called, what PRD §3.1 means by it, and what the UI will label it.

**`PUT /media/:id/progress/:number`** (`tracking.ts:341-349`) — the first check-in on an untracked
work already inserts a log row with `status = 'in_progress'` and `onConflictDoNothing`. It must now
also stamp a start date on the row it creates *and* on a pre-existing row that has none:

```ts
.onConflictDoUpdate({
  target: [userMedia.userId, userMedia.mediaId],
  // Status is untouched on purpose: checking in an episode of a `paused` show
  // must not silently re-open it (the existing `onConflictDoNothing` contract).
  set: { startedAt: sql`COALESCE(${userMedia.startedAt}, CURRENT_DATE)` },
  setWhere: sql`${userMedia.startedAt} IS NULL`,
})
```

The `setWhere` keeps the statement a no-op for the overwhelmingly common case (a row that already
has a start date), so a check-in stays one cheap upsert.

**Not in scope:** auto-completing a work when its last part is checked in. It is a tempting one-liner
and it is a behaviour change to a shipped flow (a 12-episode season would flip itself to `completed`,
stamping a finish date, the moment the grid fills). If we want it, it deserves its own decision.

**`DELETE /media/:id/log`** already deletes the row; the dates go with it. No change.

## 3. Manual editing

`PATCH /v1/media/:id/log`, body `LogDatesBodySchema`, both fields optional and **nullable** — an
explicit `null` clears, an absent key leaves the column alone:

```ts
export const LogDatesBodySchema = z
  .object({ startedAt: z.iso.date().nullable(), finishedAt: z.iso.date().nullable() })
  .partial()
  .refine((body) => body.startedAt !== undefined || body.finishedAt !== undefined, 'nothing to update');
```

Server-side checks, all 400s with the house `ApiErrorSchema` shape:

- neither date in the future (`> CURRENT_DATE`) — a finish date next March is a typo, not a plan;
- `finished_at >= started_at` **as the row will be after the patch**, not as the body describes it:
  a patch that moves only `started_at` has to be validated against the stored `finished_at`, so read
  the row first (the route's `requireUserAndMedia` preamble already has it) and merge, then compare;
- a floor of `1900-01-01`, so a slipped keystroke (`0202-08-14`) fails loudly instead of filing a
  title 1800 years back and stretching every year facet on the history page.

Returns the merged `{ startedAt, finishedAt }`. It deliberately does **not** touch status: a user
who fills in a finish date on an in-progress show is recording history, not completing it. Wiring
those together is a UI affordance ("mark completed too?"), not a server rule.

Why a second endpoint rather than optional dates on `PUT /media/:id/log`: `PUT` runs
`setAllProgress` on `completed` / `planned`, which for a 900-chapter manga is thousands of rows
across chunked inserts. Editing a date must not pay that cost, and "sending status again as a
side effect of correcting a typo" is exactly the kind of implicit write that makes a log row's
history unreadable later.

**`ViewerStateSchema`** (`packages/shared/src/tracking.ts:26-33`) gains the two dates, so the media
page can render them from the detail payload it already fetches:

```ts
startedAt: z.iso.date().nullable(),
finishedAt: z.iso.date().nullable(),
```

`loadViewer` in `apps/api/src/routes/v1/media.ts:86` already selects from `user_media` — extend that
select rather than adding a query.

## 4. The history query

**`GET /v1/me/history`**, session required, in a new `apps/api/src/routes/v1/history.ts` registered
in `routes/v1/index.ts`.

**Filing rule.** One expression decides which year a work belongs to, used by the filter, the sort,
the cursor and the facets alike:

```sql
COALESCE(um.finished_at, um.started_at) AS logged_on
```

A completed work files under the day you finished it ("what I watched in 2025" is a list of things
you *got through* in 2025); anything still open files under the day you started. Rows where both are
NULL are excluded — after the backfill that is `planned` and nothing else, which is correct: a
watchlist is not a history.

⚠️ A series started in December 2025 and finished in January 2026 appears **only** under 2026. That
is the intended reading of "what I watched in 2026", and it is the reason the entry rows show the
full range (`04 JAN → 11 FEB`) rather than a single date.

**Seasons** are anime quarters — winter `01-01…03-31`, spring `04-01…06-30`, summer `07-01…09-30`,
autumn `10-01…12-31`. The alternative (meteorological seasons, winter = Dec–Feb) straddles the year
boundary, which would make `?year=2025&season=winter` ambiguous about its December, and the audience
PRD §2 names — "tracks anime seasons" — already thinks in these quarters. A season without a year is
rejected: it is a subdivision of the year filter, not an independent one.

**Query** (`HistoryQuerySchema`, §5): `year` (int, or omitted for all time), `season`, `kind`,
`status`, `limit` (default 60, max 200), `cursor`.

**Response** (`HistoryPageSchema`):

```ts
{
  entries: HistoryEntry[],       // filed newest-first
  nextCursor: string | null,
  years: { year: number, count: number }[],   // every year the user has anything in
  totals: { titles, completed, episodes, chapters },
}
```

- `HistoryEntry` = `{ id, slug, kind, title, coverUrl, status, startedAt, finishedAt, score, watched, total }`
  — enough for a row with a cover, a date range, a rating and an `8/12` progress fragment, with no
  second request. `watched`/`total` come from the same `progress` count + `partTotal` shape
  `routes/v1/home.ts:70-94` already builds; reuse it rather than reinventing the join.
- **`years` is unfiltered by year** (it is the year picker's data source, so filtering it by the
  selected year would leave one chip on screen) but *is* filtered by kind/status, so the picker
  reflects the rest of the filter row. Cheap: one grouped scan of the user's own rows.
- **`totals.episodes` / `.chapters` come from `progress`, not from these rows** — a generalisation of
  `loadYearCheckinCounts(db, userId, year?)` in `apps/api/src/lib/me.ts:116` (add the optional year
  and season window; today's caller passes nothing and keeps the current-year behaviour). The two
  halves of the strip answer genuinely different questions: "titles you finished in 2025" and
  "episodes you watched during 2025", and a long-running show makes them disagree. The page labels
  them so the difference reads as information rather than a bug.
- **Cursor** is the news feed's shape, one field renamed: base64url of `logged_on|media_id`, opaque
  by contract, keyset `(logged_on, media_id) < (…)`. Copy the codec pair from
  `packages/shared/src/news.ts` (`encodeCursor` / `decodeCursor`) into `history.ts` as
  `encodeHistoryCursor` / `decodeHistoryCursor` rather than generalising the news one — they are
  eight lines each and the news cursor is part of a published contract.

Media visibility applies as everywhere else: join `media` and filter through
`visibleMediaSql(user, sql.raw('m.'))`, plus `deleted_at IS NULL` — a soft-deleted title vanishes
from the history while its log row survives, matching the shelves (`me.ts:45`).

**One follow-up inside the API:** once `finished_at` is written and backfilled,
`routes/v1/home.ts:120-124` should count `completedThisYear` from
`finished_at >= date_trunc('year', now())` instead of `updated_at`. Otherwise the home dashboard and
`/history?year=2025` report different numbers for the same year, and the dashboard's is the wrong one.

## 5. Shared schemas — `packages/shared/src/history.ts`

New module, exported from `packages/shared/src/index.ts` in alphabetical position (after `./friends.js`):

- `HISTORY_SEASONS = ['winter', 'spring', 'summer', 'autumn'] as const` + `HistorySeasonSchema`.
- `SEASON_MONTHS: Record<HistorySeason, [number, number]>` — the quarter bounds, and the single
  source both the SQL window and the UI labels read.
- `seasonOf(isoDate: string): HistorySeason` and `seasonWindow(year, season): { from: string; to: string }`
  — pure, no `Date` arithmetic beyond slicing the month out of an ISO string, and the two functions
  the web tests can cover without a DOM.
- `HistoryQuerySchema` (`year`, `season`, `kind`, `status`, `limit`, `cursor`) with a `.refine` that
  a `season` requires a `year`.
- `HistoryEntrySchema`, `HistoryTotalsSchema`, `HistoryPageSchema`.
- `LogDatesBodySchema` belongs in `packages/shared/src/tracking.ts` instead, next to
  `UpdateLogBodySchema` (`tracking.ts:76`) — it is a tracking mutation body, not a history contract.

## 6. Web

**`apps/web/src/lib/history.ts`** — the `lib/lists.ts` shape (exported query keys, module-private
`request<T>()`, a `useQuery` hook, an `xxxApi` object): `historyKey(params)`, `useHistory(params)`
with `keepPreviousData` so switching year doesn't blank the page, and `logDatesApi.patch(mediaId, body)`
+ a mutation hook that runs `invalidateTracking` (`lib/media.ts:84`) — a date edit moves the history
page, the profile stats and the home counts, all of which that helper already covers. Add `['history']`
to its `TRACKING_KEYS` list, otherwise a check-in leaves the history stale until reload.

**`apps/web/src/components/media/LogDatesDialog.tsx`** — `Modal` + `ModalTitle`, two native
`type="date"` inputs styled like the news feed's FROM/TO pills (`routes/news.tsx`, including
`[color-scheme:dark]` — without it the browser paints a white picker on the ink background), an
inline `role="alert"` for the server's 400, CLEAR / SAVE footer. Client-side it mirrors the server's
three checks so the common typo never round-trips.

**`apps/web/src/routes/media.$slug.tsx`** — a DATES pill in the action row beside the status `Select`
(`media.$slug.tsx:330-355`), reading `viewer.startedAt` / `viewer.finishedAt`:
`＋ DATES` when empty, `04 JAN → 11 FEB` when both, `FROM 04 JAN` when only a start. It opens the
dialog. Two behaviours worth being explicit about:

- The pill is the standing "we recorded a date, fix it if it's wrong" affordance — the auto-stamped
  value is visible the instant a status changes, through the same optimistic `applyViewer` patch the
  rest of the row uses.
- **The dialog opens by itself in exactly one case:** a transition from no-log-or-`planned` straight
  to `completed`. That is the only path with no evidence behind the date — the user is logging
  something they watched at some unknown time in the past, and today's date is almost certainly
  wrong. Every other transition has a check-in or a prior date backing it and must not interrupt.

**`apps/web/src/routes/history.tsx`** — new route, `useAuthedPage()` like every other personal page.

- `validateSearch` per `routes/search.tsx:21-24` and `routes/news.tsx:26-31`:
  `year?: number | 'all'`, `season?`, `kind?`, `status?`, all narrowed against the shared consts,
  defaulting to the current year.
- Header: `HISTORY` + a `Chip` row of years from `years` (plus `ALL TIME`), a `ToggleGroup` of kinds
  (the `search.tsx` pattern), a second `Chip` row of seasons shown only when a year is selected, and
  a status `Select` defaulting to all-but-`planned`.
- Stats strip: `StatCard`s for titles completed, titles started, episodes, chapters — the two halves
  labelled distinctly per §4.
- Body: entries **grouped by month** under `JANUARY` / `FEBRUARY` headings (grouped client-side from
  the already-sorted page — the server sends one ordered stream, and a month header is a rendering
  concern), each row a small cover, `KindDot`, title linking to `/media/$slug`, the date range, the
  score, and the `8/12` progress fragment. A `LOAD MORE` button on `nextCursor`, matching the news
  feed's paging.
- Empty states, three of them and worth distinguishing: nothing tracked at all, nothing in *this*
  year, and nothing matching the kind/status filter.

**`apps/web/src/components/layout/AppNav.tsx`** — add `{ label: 'HISTORY', to: '/history' }` between
LISTS and PROFILE. This is the sixth item, which `docs/friends-plan.md` §6 argued against for
friends — the argument there was that a feature with no page of its own doesn't earn a nav slot, and
this one is a page. It also absorbs the ROADMAP's Library-page item, so it's the entry point for
"my whole collection", not a niche view.

**`apps/web/src/routes/profile.tsx`** — the stat strip's EPISODES/CHAPTERS THIS YEAR figures become
links to `/history?year=<current>`. That is the whole discovery story for the page beyond the nav.

**Extract `KIND_LABELS`** into `apps/web/src/lib/kinds.ts`. It is already copied verbatim in three
places (`routes/search.tsx:32`, `routes/news.tsx:38`, `components/media/CreateEntryDialog.tsx:21`);
the history filter row would be the fourth. Same commit, one small refactor, no behaviour change.

⚠️ `apps/web/src/routeTree.gen.ts` is generated **and committed** — `/history` won't typecheck until
the TanStack Start plugin regenerates it. Run `pnpm dev` or `pnpm build` and commit the regenerated
file in the same commit, or CI's `pnpm typecheck` fails.

## 7. Tests

**`apps/api/test/tracking.integration.test.ts`** (extend — the suite already signs a user in and
seeds Bebop/Frieren/Matrix): first check-in stamps `started_at` and leaves `finished_at` NULL → a
second check-in the same run does **not** move `started_at` → `completed` stamps both → back to
`in_progress` clears `finished_at` and keeps `started_at` → `planned` clears both and sweeps progress
→ `dropped` stamps only `started_at` → checking in on a `paused` log stamps the date without
re-opening the status. Plus the movie path (no parts, so status transitions are the only writer).

**`apps/api/test/history.integration.test.ts`** (new — copy the boilerplate block from
`tracking.integration.test.ts:33-58`: `TEST_DATABASE_URL_HISTORY ?? 'postgres://…/trackt_history_test'`,
`ensureTestDatabase()` + `describe.runIf(available)`, `runMigrations → createDb → seedMedia → loadEnv → buildApp`,
sign-up-then-grab-`set-cookie`). Because the interesting cases are all about *dates in the past*,
the fixtures write `user_media` rows directly through `db` rather than driving the API — that is the
only way to get a 2024 finish date without a clock shim.

Cases: a year filter returns only that year's entries → a work spanning New Year appears under its
finish year only → an open work files under its start year → `planned` never appears → season
narrows to the quarter and `?season=` without `?year=` is a 400 → kind and status filters compose →
`years` lists every year with a count and ignores the year filter but honours kind → `totals.episodes`
counts check-ins in the window, not parts of the listed titles → the cursor pages without gaps or
repeats and a tampered cursor is a 400 → a soft-deleted title drops out while its log row survives →
no cookie is 401.

**`apps/api/test/log-dates.integration.test.ts`** or the same tracking suite (either is fine, keep it
where the fixtures are): `PATCH` sets, clears with an explicit `null`, rejects a future date, rejects
`finished_at < started_at` **including against the stored value when only one field is sent**, rejects
the year-0202 floor, 404s on a media the viewer can't see, and 401s without a cookie.

**`apps/web/test/lib/history.test.ts`** (new, the framework-free half): `seasonOf` at every quarter
boundary (`03-31` vs `04-01`), `seasonWindow` round-tripping, and the month-grouping helper — all
pure, and all where the off-by-one lives.

**`packages/db`** — no test; the backfill is exercised by every integration suite's `runMigrations`.

## 8. Phasing

Three PRs, each green under `pnpm lint && pnpm typecheck && pnpm test && pnpm format:check`.

1. **Dates.** The index + backfill migrations; the write rules in `routes/v1/tracking.ts`;
   `PATCH /media/:id/log` + `LogDatesBodySchema`; `ViewerState` + `loadViewer`; the DATES pill and
   `LogDatesDialog`; the tracking/log-dates tests. Plus
   **`docs/adr/0007-log-dates-over-viewing-runs.md`** — the repo writes an ADR for exactly this class
   of decision (0003, 0004, 0006), and "one date pair per log, rewatch runs deferred", the filing
   rule, the season convention and the backfill's admitted guesswork all belong in one durable
   record rather than in a plan that goes stale on merge.
2. **History API.** `packages/shared/src/history.ts` + index export; `routes/v1/history.ts`;
   `loadYearCheckinCounts` gaining its optional window; the `home.ts` `completedThisYear` switch;
   `history.integration.test.ts`.
3. **History page.** `lib/history.ts`; `routes/history.tsx` + regenerated `routeTree.gen.ts`; the nav
   item; the profile stat links; the `KIND_LABELS` extraction; `apps/web/test/lib/history.test.ts`;
   ROADMAP + `docs/data-model.md` updates (the data model doc lists the log's date columns but
   predates anything writing them).

Phase 1 is independently useful — the dates start accumulating the day it merges, which means phase 3
lands on a history that already has something in it.

## 9. Verification

Per phase:

```sh
pnpm lint && pnpm typecheck && pnpm format:check
docker compose -f docker-compose.dev.yml up -d   # if Postgres isn't already up
pnpm test
pnpm --filter @trackt/api test -- history
```

The integration suites self-skip when Postgres is unreachable — **check the output for `skipped`
rather than assuming green**, or set `CI_REQUIRE_DB=1` to make absence a failure.

Migrations get a second look beyond a green suite: run `pnpm db:migrate` against a database that
already holds tracking rows (the dev database after a seed + a few check-ins), then confirm the
backfill filled what it should and left `planned` alone.

End-to-end, after phase 3: use the **`verify` skill** (`.claude/skills/verify/SKILL.md`) to bring up
catalog → worker → API → web, then drive the real flow — check in one episode and confirm the DATES
pill fills; mark a movie completed straight from nothing and confirm the dialog opens with today
prefilled; backdate it to last year; open `/history`, confirm the year chip for last year exists and
the film is under it; switch to a season and to ALL TIME; confirm the profile's this-year stat links
into the right filter.

## 10. Deferred, on purpose

- **Cumulative time watched** — the user's own "later, it's hard with video games". It is blocked on
  data before it is blocked on maths: no runtime lives anywhere structured. `media` carries a free-form
  `metadata` jsonb whose comment mentions runtime (`packages/db/src/schema/media.ts:73`), the slim
  catalog contract has no runtime field at all, and per-episode durations don't exist even in theory
  until the catalog carries per-part structure. Any number we showed today would be
  `episodes × 24 minutes`, which is a guess wearing a statistic's clothes. When the catalog grows a
  runtime, this page is where it surfaces.
- **Dated rewatch history** — `repeats` and `progress.repeat_index` exist and stay dead here. Doing it
  properly means a `media_run` table (one row per viewing run: `user_id, media_id, run_index,
  started_at, finished_at`), with today's date pair becoming run 0 and `user_media` keeping a
  denormalised copy of the latest run. That is a bigger data-model change than this feature needs,
  and PRD §3.1 lists it as its own bullet. §2's "re-opening clears `finished_at`" is the rule that
  changes when it lands.
- **Per-part dates in the history** — the `progress` rows carry a real timestamp each, so a
  per-episode diary ("14 Aug: E3, E4, E5") is available without new data. It's a different page shape
  (a feed, not a shelf) and the profile activity feed already gestures at it.
- **Friends' histories.** Everything here is `/me/*`. The public profile (ADR-0006) shows stats and
  recent activity; a friend-visible year view would need the visibility conversation that ADR
  deliberately deferred to a per-user privacy column.
- **Importers.** A TV Time / Trakt / AniList import is the other way this page fills up, and the
  dates it carries are exactly what this plan makes writable. Tracked separately in the ROADMAP.
