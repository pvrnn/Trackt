# ADR-0007: One date pair per log, over dated viewing runs

**Status:** Accepted — 2026-08-15 (see `docs/history-plan.md`)

## Context

Trackt recorded **that** you watched something and, per part, **when you ticked it
off** — but had no notion of when you *started* or *finished* a work, and no
surface answering "what did I watch in 2025?".

The columns already existed and were completely dead. `user_media.started_at`,
`finished_at`, `repeats` and `notes` were declared in
`packages/db/src/schema/tracking.ts` and created in migration `0000`; a grep for
any of them across `apps/` and `packages/` returned three hits, all in that
schema file. PRD §3.1 lists "Start/finish dates, personal notes per entry" and
"rewatch / reread counters with dated history" as core tracking features; none of
it was written, read, or exposed.

Downstream, everything that wanted a date reached for a proxy:

- `apps/api/src/routes/v1/home.ts` counted "completed this year" as
  `user_media.updated_at >= date_trunc('year', now())` — a row touched for any
  reason (a rating, a status correction) counted as a completion this year, and a
  title genuinely completed in January dropped out the moment it was edited in a
  later year.
- `loadYearCheckinCounts` counted *check-ins* since Jan 1, a good activity number
  that says nothing about titles, hard-coded to the current year.
- A movie has no parts, so it produced no `progress` rows at all: a year of films
  was invisible to every "this year" number the app showed.

## Decision

1. **One date pair per log, not a run table.** `started_at` / `finished_at` on the
   existing `user_media` row — no new table, no new columns. The alternative, a
   `media_run` table (one row per viewing run: `user_id, media_id, run_index,
   started_at, finished_at`, with today's pair becoming run 0 and `user_media`
   keeping a denormalised copy of the latest run), is what dated rewatch history
   actually needs and is deferred to its own decision. PRD §3.1 lists it as its
   own bullet, and it is a larger data-model change than a year view requires.
   `repeats` and `progress.repeat_index` stay dead here rather than being
   half-used.

2. **`date`, not `timestamp`.** A viewing start is a day, not an instant, and a
   day typed in by hand has no timezone to get wrong. Everything derived stays in
   UTC, matching `loadStreak` and `loadYearCheckinCounts`; there is no per-user
   timezone column yet, and adding one for this would be the tail wagging the dog.

3. **Status changes stamp the dates, in the statement.** `CURRENT_DATE` inside
   the SQL, never a JS `new Date()` — the API and the database must not disagree
   about the day.

   | New status    | `started_at`                | `finished_at`                |
   | ------------- | --------------------------- | ---------------------------- |
   | `planned`     | `NULL`                      | `NULL`                       |
   | `in_progress` | `COALESCE(existing, today)` | `NULL`                       |
   | `paused`      | `COALESCE(existing, today)` | unchanged                    |
   | `dropped`     | `COALESCE(existing, today)` | unchanged                    |
   | `completed`   | `COALESCE(existing, today)` | `COALESCE(existing, today)`  |

   `COALESCE`, never overwrite: marking a series completed, then paused, then
   completed again must not replace the real start date with today's. `planned`
   clears both because it already means "none of this has happened" — the route
   sweeps every check-in for it, and dates leaving with the check-ins is the
   consistent behaviour. `in_progress` clears `finished_at` because re-opening a
   completed log is either a correction or a rewatch, and under both readings
   "finished on" is no longer true; **this is the rule that changes when run 1
   lands**, at which point the clear becomes "close the current run, open a new
   one". `dropped` does not stamp `finished_at`: dropped works still appear in the
   history, filed under their start date, but `finished_at` keeps meaning
   *completed on* — what the column is called, what PRD §3.1 means by it, and what
   the UI labels it.

   The first check-in on an untracked work also stamps a start date, and fills one
   in on a pre-existing row that has none — without touching status, so checking
   in an episode of a `paused` show does not silently re-open it.

   Explicitly **not** adopted: auto-completing a work when its last part is
   checked in. It is a tempting one-liner and a behaviour change to a shipped
   flow — a 12-episode season would flip itself to `completed`, stamping a finish
   date, the moment the grid fills. If we want it, it deserves its own decision.

4. **A separate `PATCH /v1/media/:id/log` for manual edits**, not optional dates on
   the existing `PUT`. `PUT` runs `setAllProgress` on `completed`/`planned`, which
   for a 900-chapter manga is thousands of rows across chunked inserts; editing a
   date must not pay that cost. And re-sending status as a side effect of
   correcting a typo is exactly the kind of implicit write that makes a log row's
   history unreadable later. The PATCH deliberately does not touch status: filling
   in a finish date on an in-progress show is recording history, not completing
   it. Wiring the two together is a UI affordance, not a server rule.

   Three server-side checks, all 400s: neither date in the future; a floor of
   `1900-01-01` so a slipped keystroke (`0202-08-14`) fails loudly instead of
   filing a title 1800 years back and stretching every year facet; and
   `finished_at >= started_at` **as the row will be after the patch**, not as the
   body describes it — a patch moving only `started_at` is validated against the
   stored `finished_at`.

5. **`COALESCE(finished_at, started_at)` is the filing rule.** One expression
   decides which year a work belongs to, and the filter, the sort, the cursor and
   the facets all read it. A completed work files under the day you finished it,
   because "what I watched in 2025" is a list of things you *got through* in 2025;
   anything still open files under the day you started. Rows with neither date are
   excluded — after the backfill that is `planned` and nothing else, which is
   correct: a watchlist is not a history.

   The consequence, accepted deliberately: a series started in December 2025 and
   finished in January 2026 appears **only** under 2026. That is the intended
   reading of "what I watched in 2026", and it is why entry rows show the full
   range (`04 JAN → 11 FEB`) rather than a single date.

6. **Seasons are anime quarters** — winter Jan–Mar, spring Apr–Jun, summer
   Jul–Sep, autumn Oct–Dec. Meteorological seasons (winter = Dec–Feb) straddle the
   year boundary, which would make `?year=2025&season=winter` ambiguous about its
   December; and the audience PRD §2 names — people who "track anime seasons" —
   already thinks in these quarters. A season without a year is a 400: it is a
   subdivision of the year filter, not an independent one.

7. **The backfill guesses, and says so.** Migration `0015` derives dates from the
   check-ins that prove them, then falls back to the row's own `created_at` /
   `updated_at` for movies and anything logged without a check-in. That second
   half is a guess dressed as data — a title imported and marked completed long
   after the fact gets the import date. It is accepted *because* point 4 makes
   every date editable, and because the alternative is an empty history page for
   every existing user of the instance. It is deliberately not applied to
   `planned`: a watchlist entry has no viewing date, and inventing one would file
   it into the history.

## Consequences

- `/history` supersedes the ROADMAP's **Library page** item rather than landing
  beside it: ALL TIME with no kind or status filter is the viewer's whole tracked
  collection, which is what that item asked for.
- `home.ts`'s `completedThisYear` now counts from `finished_at`, so the dashboard
  and `/history?year=…` report the same number for the same year.
- History is `/me/*` only. The public profile (ADR-0006) shows stats and recent
  activity; a friend-visible year view needs the per-user privacy column that ADR
  deliberately deferred.
- **Cumulative time watched stays out**, and is blocked on data before it is
  blocked on maths: no runtime lives anywhere structured. `media.metadata` is a
  free-form jsonb whose comment mentions runtime, the slim catalog contract has no
  runtime field at all, and per-episode durations do not exist even in theory
  until the catalog carries per-part structure. Any number shown today would be
  `episodes × 24 minutes`, which is a guess wearing a statistic's clothes. When
  the catalog grows a runtime, this page is where it surfaces.
