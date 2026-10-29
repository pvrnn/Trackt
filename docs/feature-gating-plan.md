# Plan — Feature gating (release flags, percentage rollout, country targeting)

> **Status:** Built — phases 0–2 (ADR-0011); phases 3–4 are optional and not
> started. The first consumer is the lists feature (`lists.custom`), not the
> news strip the pilot section below was drafted around.
> Deeper context: [PRD](PRD.md), [ROADMAP](ROADMAP.md), [ADR-0002](adr/0002-federated-catalog-search.md) (what an
> instance owns vs. what the catalog owns), [ADR-0008](adr/0008-first-party-mobile-client.md)
> (the client/server version contract).

## Context

There is no way to release a feature gradually. Every surface ships to every
user of every instance at once, or waits behind an environment variable that is
read once at boot (`packages/shared/src/env.ts:17`) and needs a redeploy to
change. Three release clocks already run independently:

- **self-hosted instances** upgrade on the operator's schedule (ADR-0001/0002);
- **the hosted instance** deploys on every merge to `main` (migrations run at
  boot, so a schema change is live within minutes);
- **the mobile binary** upgrades on the user's schedule, and cannot be recalled
  (ADR-0008 — `/api/v1` is a contract with clients we do not control).

A feature that is only safe for 10% of users, or only correct in one country, has
no expression today. A bad release can only be undone by another deploy.

**Goal.** A feature can be shipped dark, switched on for 1% → 10% → 100% of a
single instance's signed-in users, restricted to a country allowlist, and killed
in seconds — while a self-host that never touches the system keeps whatever the
code says. Web and mobile read the same decision through one hook.

**Out of scope, deliberately:**

| Not building | Why |
| --- | --- |
| A/B variants, experiment assignment, significance | The repo has no analytics or telemetry of any kind. A variant nobody measures is cosplay. This is *rollout*, not experimentation. |
| Entitlements / paywalls | Roles already exist for privilege; money is not a thing this instance does. |
| Central (catalog-side) flag distribution | An instance's own chrome must not depend on the catalog being reachable — a dead catalog may empty search and news, never hide a shipped feature. Operators own their rollout. |
| Anonymous bucketing | There is no stable anonymous identity in the repo, and minting one just to bucket feature flags is a privacy cost with no product return. Anonymous users are eligible only at 100%. |
| Flags in `apps/catalog`, `apps/worker`, `apps/discord` | The catalog has no users and its own database; the worker and bot are API consumers with their own surface. One table, one instance. |

## Decisions taken

| Question | Decision | Why |
| --- | --- | --- |
| Where policy lives | Instance Postgres (`feature_flag`) | Operator-owned, survives deploys and restarts, no external service to keep up. |
| Source of truth for keys and defaults | Code registry in `packages/shared/src/flags.ts` | Typo-proof on both clients, typed at every call site, and a flag dies with the feature it describes. |
| Evaluation | Server-side only; clients receive booleans | One implementation of the bucket; a client that computed its own rollout would disagree and could be edited. |
| Percentage identity | `sha256("<flag>:<userId>")` → integer bucket | Stable forever, independent per flag, and monotonic when the rollout widens. |
| Country source | Trusted proxy header, plus a fixed `FLAG_COUNTRY` fallback | No GeoIP database, no licence, no third-party call on the hot path. |
| Precedence | env > kill switch/schedule > per-user override > country > rollout | Emergency controls outrank grants; a grant outranks eligibility, so QA in a non-targeted country can still see the thing. |
| Client fallback before the snapshot resolves | The compiled registry `default` | A dead `/flags` endpoint must never hide a shipped feature, and an old binary must keep working. |
| API answer when a gate is closed | `404`, never `403` | Do not advertise unreleased endpoints (same posture as an unpublished news slug, ADR-0005). |
| Flag lifetime | Every flag names an owner and a `removeBy` date | Flag debt is the failure mode of every flag system. The audit is the tool, not a runtime error. |

---

## 1. What a flag is — and is not

Only two kinds are allowed into the registry:

1. **Release flag** — temporary. `default: false`, rolled out, then removed
   after GA. Its deletion is the definition of done.
2. **Kill switch** — `default: true`, `rollout: 100`. It exists so an operator
   can switch a shipped surface off without a deploy. It is not a latency
   control: the catalog timeouts (`CATALOG_*_TIMEOUT_MS`) already handle that.

A flag is **not** an authorization primitive. `role`, media/list visibility and
friendship rules stay authoritative; a gated-off feature that somehow renders
must still fail its own permission check. A flag is also not configuration: new
instances still learn where their catalog is from `CATALOG_URL`, not a flag.
And it is not a migration switch: migrations still run at boot, so a feature
behind a flag must leave the schema readable by the code that runs without it.

Every flag is temporary-or-permanent by intent, and the registry makes that
visible (`removeBy` on a kill switch reads "review by", not "delete by").

## 2. The registry (`packages/shared/src/flags.ts`)

The registry is code, exported from `@trackt/shared` (`packages/shared/src/index.ts`)
so the API, web and mobile all compile against the same key union.

```ts
export interface FlagDefinition {
  summary: string;
  owner: string; // who is on the hook to delete it
  /** What a client renders before the snapshot resolves — the shipped state. */
  default: boolean;
  /** YYYY-MM-DD. Audit input, never a runtime error. */
  removeBy: string;
}

export const FLAG_DEFINITIONS = {
  'lists.custom': {
    summary: 'Custom lists: reading, creating and editing them, on both clients (PRD §3.4).',
    owner: 'paul',
    default: true,
    removeBy: '2027-06-30',
  },
} satisfies Record<string, FlagDefinition>;

export type FlagKey = keyof typeof FLAG_DEFINITIONS;

export const FlagsSnapshotSchema = z.object({ flags: z.record(z.string(), z.boolean()) });
```

Rules that make this maintainable:

- **Naming:** `<area>.<feature>`, lowercase kebab (`lists.collaborative`, not
  `ListsCollaborative`). Areas match the route/lib grouping so a grep for a flag
  finds its surface.
- **`default` is the shipped state, not the "off" state.** A kill switch graded
  in as `default: true` means an instance whose `/flags` call fails, and a
  mobile binary on last week's cache, both keep the feature. A release flag
  graded in as `default: false` means the same failures show nothing. That
  asymmetry is the entire reason clients carry a default at all.
- **A key that is `default: true` and `rollout: 100` forever is not a flag**, it
  is config with extra steps. Promote or delete it.
- **No secrets, no copy, no config values in definitions** — summaries are
  operator-facing text, nothing more.

## 3. Storage (migration `0021`)

Two tables in a new `packages/db/src/schema/flags.ts`, exported from
`schema/index.ts`:

```ts
export const featureFlags = pgTable(
  'feature_flag',
  {
    /** Registry key. No FK to a registry table — code owns the registry; a deleted flag's row is dead weight, not an error. */
    key: text('key').primaryKey(),
    /** Global kill switch. Outranks per-user overrides. */
    enabled: boolean('enabled').notNull().default(true),
    /** Percent of *eligible signed-in* users, 0–100. */
    rollout: smallint('rollout').notNull().default(100),
    /** ISO 3166-1 alpha-2 allowlist; empty means every country. */
    countries: text('countries').array().notNull().default(sql`'{}'::text[]`),
    startsAt: timestamp('starts_at', { withTimezone: true }),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [check('feature_flag_rollout_range', sql`${t.rollout} between 0 and 100`)],
);

export const featureFlagOverrides = pgTable(
  'feature_flag_override',
  {
    key: text('key')
      .notNull()
      .references(() => featureFlags.key, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    enabled: boolean('enabled').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.key, t.userId] }),
    index('feature_flag_override_user_idx').on(t.userId),
  ],
);
```

Design notes:

- **A row is a deviation, never the registry.** No row → the code default. That
  is what stops a stale self-host from resurrecting a feature deleted in code,
  and it makes an empty table a valid, fully working state.
- **A first write seeds from the registry default**, not from the column
  default: a `default: false` flag becomes `enabled: true, rollout: 0`, a
  `default: true` one becomes `rollout: 100`. Otherwise adding a country rule to
  a dark release flag would switch it on for that whole country — the rollout
  would be a side effect of a form field the operator did not touch.
- **Overrides need a parent row**: the admin/CLI write upserts `feature_flag`
  first. This keeps "delete the rule" honest — it drops the overrides with it.
- **No enum, no variant, no JSON rules.** Three named fields express percentage,
  country and schedule; a JSONB rule language would be a parser, a validator and
  a debugging surface for no extra expressiveness today.
- **Indexes:** the flags table holds one row per live flag (PK is enough); the
  override index exists for the per-request `WHERE user_id = $1` probe.
- **Migration is additive** (two new tables, one check, one index), generated
  once with `pnpm --filter @trackt/db db:generate`, reviewed per
  `CONTRIBUTING.md` § "Making schema changes". It runs at boot in both the
  monolith and Railway, so merging ships it.
- `updatedBy` is the whole audit trail. A change log table is not worth it for a
  single-operator instance; the Pino line on every write carries the diff.

## 4. Evaluation (`apps/api/src/lib/flags.ts`)

Everything that reads a flag goes through this module. It is the only place that
touches the table.

```ts
export interface FlagContext {
  userId?: string;
  /** ISO alpha-2, already resolved and validated by `countryFrom()`. */
  country?: string;
}

export type FlagSource = 'default' | 'db' | 'env';
```

### 4.1 Precedence

```
env override                                  → wins over everything (operator's emergency knob)
row absent                                    → registry default
row.enabled === false                         → false   (kill switch; outranks overrides)
outside [startsAt, endsAt)                    → false
per-user override                             → its value (grant or deny)
countries non-empty && !countryAllows         → false
rollout === 100                               → true    (no hashing; cannot exclude anyone)
rollout === 0                                 → false
no userId                                     → false   (anonymous is eligible only at 100%)
bucket(key, userId) < rollout * 100           → true
```

Two orderings are load-bearing: **kill switch before override** (an emergency
must not be defeated by a QA grant) and **override before country** (support
sometimes has to show a French user a France-gated feature while they debug it).

### 4.2 The bucket

```ts
const bucket = (flag: string, userId: string): number =>
  createHash('sha256').update(`${flag}:${userId}`).digest().readUInt32BE(0) % 10_000;

on = bucket < rollout * 100; // rollout is an integer percent
```

- **Stable for life:** the input is the immutable user id, so a user's bucket
  never changes across sessions, devices or a re-login.
- **Monotonic:** `bucket < a` implies `bucket < b` for `b > a`. Widening a
  rollout only ever adds users; it can never evict one. That property gets a
  test, because a rollout that reshuffles is indistinguishable from a bug.
- **Independent per flag:** the key is in the hash, so the same unlucky 10% is
  not excluded from every feature forever.
- **1% granularity.** Integer percent is what the operator asked for and what the
  admin UI can honestly show. At 0.4%, this would want basis points; it doesn't
  need them.
- **Small instances:** 1% of three users is zero, and the admin copy must say so
  ("≈ 1 in 100 users; on an instance this size use an override"). A slider that
  silently rounds to nobody is a lie.

### 4.3 Country

Resolution order, in `countryFrom(request, env)`:

1. `FLAG_COUNTRY_HEADER` (default: unset) — the header name set by the operator's
   reverse proxy, e.g. `cf-ipcountry`, `x-vercel-ip-country`. Value uppercased,
   validated `^[A-Z]{2}$`; `XX` and `T1` (Cloudflare's unknown and Tor markers)
   are treated as unknown.
2. `FLAG_COUNTRY` — a fixed code for a single-region deployment.
3. Unknown.

**Unknown fails closed** for any flag with a non-empty allowlist: "not released
here" is the safe read, and a spoofed header can only grant early access to a
feature, never data. Trust model, stated in the env docs: only name a header
your own edge sets. If the API is exposed directly, the header is spoofable and
country gating degrades to an honour system — acceptable for release gating,
not for anything legal or rights-related (which would need the same check *and*
a server-side source with no client-adjacent hop).

At boot, if any registry flag has `countries` and neither variable is set, log
**one warning** — an instance must not refuse to start over a rollout rule it
isn't using.

### 4.4 Schedule

`startsAt` inclusive, `endsAt` exclusive, compared in UTC (`timestamptz`), so a
launch can be prepared and a temporary rollout can expire without anyone awake.
No timezone negotiation: operators think in UTC for this one control.

### 4.5 Cache and failure

- **Rows are memoized for 5 s per process**, the same `TtlMemo` pattern as
  `apps/api/src/lib/news.ts:47` (simpler: a module-level `{ value, expiresAt }`).
  A kill switch is live immediately on the process that made the change and
  within 5 s everywhere else. Every admin write calls `clearFlagCache()`.
- **Overrides are never cached** — one PK query per evaluation that has a
  viewer. Guards on hot routes pay it; that is the price of QA grants working.
- **`deps.db` absent** (unit tests) → registry defaults, exactly as the rest of
  the API treats a missing database.
- **DB error while reading rules** → registry defaults + a logged warning, never
  a 500 on `/v1/flags`; the flags endpoint must not be able to break a page that
  would otherwise render.

## 5. Contracts

### 5.1 `GET /v1/flags`

Anonymous-readable, evaluated for the requesting viewer:

```json
{ "flags": { "lists.custom": true } }
```

- Contains **every registry key, always** — absence is meaningful to a client
  (it means "this build asked for a key this instance doesn't know") and must
  stay reserved for that.
- `cache-control: private, max-age=0, must-revalidate`: it is per-viewer
  (percentage, overrides, country), so nothing shared may store it, but a
  conditional request is nearly free. A weak `ETag` (hash of the body) makes
  revalidation cheap for browsers; mobile's fetch ignores it and takes the full
  tiny body.
- Booleans only. Rule values never leave the admin surface.
- Uses the global rate limit (300/min); the endpoint is ~one small query per app
  launch, not a poll.

### 5.2 `/v1/admin/flags` (new admin surface)

The API has had **no session-role guard since the moderation queue was removed**
(ROADMAP "instance-side entry creation removed"), so this reintroduces one small
one in `apps/api/src/lib/admin.ts`:

| Route | Body | Notes |
| --- | --- | --- |
| `GET /v1/admin/flags` | — | Registry + row (or null) + `source: 'default' \| 'db' \| 'env'` + the rule as written + the effective answer for an anonymous viewer, and for one named user when `?userId=` is passed + warnings. There is deliberately no single "signed-in" boolean at a partial rollout — the admin UI says the percentage instead of inventing an answer. |
| `PATCH /v1/admin/flags/:key` | `{ enabled?, rollout?, countries?, startsAt?, endsAt? }` | Upsert; `key` must be in the registry (400 otherwise). The first write seeds `enabled`/`rollout` from the registry default (§3), not from the column default. |
| `DELETE /v1/admin/flags/:key` | — | Drops the row and its overrides; back to the registry default. |
| `PUT /v1/admin/flags/:key/overrides/:userId` | `{ enabled }` | Per-user grant/deny. |
| `DELETE /v1/admin/flags/:key/overrides/:userId` | — | |

- 401 unauthenticated, 403 non-admin (role `admin`, bootstrapped with
  `pnpm db:set-role`), 400 unknown key or bad body, **409 `env-locked`** when an
  env override owns the key.
- CSRF posture: cookie-authenticated JSON PATCH behind the production CORS
  allowlist (`apps/api/src/app.ts:58`); a cross-site HTML form cannot set
  `content-type: application/json`. No token-in-a-header scheme is invented for
  this.
- Every write logs `{ key, before, after, actor }` at info.
- `GET` deliberately reports `source`, so an operator staring at a rollout
  slider that does nothing is told why instead of filing a bug.

### 5.3 Environment (operator's emergency knob)

```sh
FEATURE_FLAGS="lists.custom=off,other.feature=25"
FLAG_COUNTRY_HEADER=cf-ipcountry
FLAG_COUNTRY=FR
```

- Grammar: `on` | `off` | integer `0`–`100`. Parsed by a pure
  `parseFlagOverrides(string)` in `@trackt/shared` that returns
  `{ overrides, warnings }` rather than logging, so `loadEnv` can print the
  warnings once at boot and the unit test can assert them without a server.
- An unknown key is **warned and ignored**, never fatal: an operator's stale
  `.env` must not brick an upgrade, and a key removed from the registry is a
  normal event.
- Duplicates: last wins, with a warning. Empty string means unset (compose files
  pass optional keys through as `''`, `packages/shared/src/env.ts:25`).
- Env wins in both directions, including over a DB kill switch. The admin read
  marks the key `source: 'env'` and the UI locks it — no dead controls.
- **Turbo trap:** add all three names to `turbo.json`'s `dev.passThroughEnv` or a
  developer's `FEATURE_FLAGS` never reaches `apps/api` (strict env mode).
  Deliberately *not* in turbo's `test.env`: flag values would bust the test cache
  on every developer's machine, and the unit tests pass a source object instead.
  A suite that drives country parsing passes the variables to
  `loadEnv({ FEATURE_FLAGS: ..., FLAG_COUNTRY_HEADER: ... })` directly.
- Also: `.env.example` (a new "Feature flags" section), `docker-compose.yml`'s
  `app` environment block (self-hosters), and Railway variables for `app` when
  the hosted instance needs a static override.

### 5.4 CLI (operators without a session)

`packages/db/src/bin/flag.ts`, mirroring `set-role.ts`'s posture — the db package
already depends on `@trackt/shared`, so it imports the registry and shares the
validation:

```sh
pnpm --filter @trackt/db db:flag -- lists.custom=25 --countries=FR,BE --until=2026-12-01
pnpm --filter @trackt/db db:flag -- lists.custom=off
pnpm --filter @trackt/db db:flag:list
```

Same table, same checks, no second implementation. The CLI is the pnpm path;
Docker and Railway operators use the admin API (or
`docker compose exec app node dist/bin/flag.js`, which is built into the image).

## 6. Clients

### 6.1 `@trackt/client` (`packages/client/src/flags.ts`)

```ts
export const flagsKey = (viewerId: string | null) => ['flags', viewerId ?? 'anonymous'] as const;

export function useFlags() { /* anonymous-readable query, staleTime 5 min */ }
export function useFlag(key: FlagKey): boolean {
  return useFlags().data?.flags[key] ?? FLAG_DEFINITIONS[key].default;
}
```

- **`ClientRuntime` gains `useViewerId(): string | null`.** The seam currently
  exposes only `useIsAuthed()` (`packages/client/src/runtime.ts:23`), which is
  enough to know *whether* to fetch but not which cache entry to use. Web and
  mobile each have the id in their better-auth session (`apps/web/src/lib/client.ts`,
  `apps/mobile/src/lib/client.ts`), so this is a one-line addition on each side —
  no better-auth import enters the package.
- **Keyed by viewer id.** A signed-out snapshot and a signed-in one can differ
  (percentage, override, and the 100%-only anonymous rule), so signing in must
  produce a new cache entry rather than serving the anonymous answer until
  `staleTime` expires.
- **Pending, errored or absent key → the compiled default**, never `false`. A
  flags outage must not hide a `default: true` feature, and it must not reveal a
  `default: false` one.
- One query per client, shared by every `useFlag`. `/v1/flags` is deliberately
  not session-gated (`enabled: true`), because public pages must render the same
  chrome.
- `refetchOnWindowFocus` keeps a long-lived tab honest; there is no polling — a
  flip is expected within a navigation, not instantly.

### 6.2 Web

- **No SSR evaluation.** The SSR process sits *behind* the API in the monolith
  with no route back (`docker/entrypoint.sh`), the same constraint that made the
  landing band client-fetched. The first paint uses compiled defaults; since
  every authed body already renders client-side behind `useAuthedPage`, this
  adds no new flash — and for a release flag (`default: false`) it adds no
  premature reveal either.
- **Deep links:** a `FlagGate` component renders a translated "This feature
  isn't available on this instance" panel. Redirecting a deep link to `/home`
  silently would read as a bug, and a blank page reads as a broken build.
- **Nav/shelves:** segments, tabs and shelf entries filter on `useFlag`, so a
  half-rolled-out instance never shows a destination that answers "unavailable".
  A user below the bucket just doesn't see the entry — which is the point of a
  percentage rollout, and why it must never gate something already in the nav at
  100% (`default: true` protects the signed-out case, not the bucketed one).
- A `Translate`d copy key per `FlagGate`; no per-flag copy in the registry.

### 6.3 Mobile

- The hook and the gate pattern are inherited from web (both clients already
  share `packages/client`); the snapshot is written to the persisted MMKV cache
  like every other query, **per origin**, so last-known flags survive offline.
  There is no cross-platform component layer, so mobile's gate is the
  `ScreenState`/`EmptyState` panel its screens already use, not web's
  `FlagGate` — and it landed with the first mobile surface that needed one
  (the lists screens).
- **Consequence, documented not hidden:** a feature killed while a phone is
  offline stays visible until the app reconnects (the flags query refetches on
  focus). Nothing security-relevant is gated by a flag, so this is a stale UI,
  not an exposure. The server check is the enforcement.
- **ADR-0008 compatibility, both directions:**
  - old binary, new server, key deleted → server omits it → compiled default
    applies (the feature is either GA'd to `true` or gone);
  - new binary, old instance, endpoint absent → `404` → the compiled default
    applies. A release flag's default is `false`, so it stays invisible — which
    is the behaviour the old instance would have produced anyway. A kill switch
    defaults to `true`, so a feature the old instance still serves is not hidden
    by the missing endpoint. Hiding it would be the regression: it is exactly
    the failure this default guards against.
- Offline mutation replay to a newly killed endpoint is a real case: a queued
  write replayed against a 404 must surface as a failed write (it already fails
  visibly in the subway-replay path) — add that to the phase 2 check-list rather
  than assume it.

### 6.4 The first consumer (pilot): `lists.custom`

One real flag, not a synthetic canary, so nothing dead enters the tree:

- Registry entry `lists.custom`, `default: true` (a kill switch), owner and
  `removeBy` set.
- API: `requireFlag('lists.custom')` as a `preHandler` hook on the whole
  `listRoutes` plugin (`apps/api/src/routes/v1/lists.ts`) → every `/v1/lists*`
  route answers `404`.
- Server hooks: `useLists`/`useList` set `enabled: useFlag('lists.custom')`, so
  a client that knows the answer never asks.
- Web: the `LISTS` nav entry is filtered out (a destination that answers
  "unavailable" is worse than an absent one), `/lists` and `/lists/$id` render
  the `FlagGate` panel on a deep link, and the media page's `＋ LIST` control is
  not rendered.
- Mobile: the Profile row is hidden, the two list screens render the unavailable
  panel, and the media screen does not pass `onAddToList` (the control does not
  exist rather than sitting inert).
- This exercises: registry → DB → evaluator → preHandler → 404 → client hook →
  UI disappearance, on a surface whose absence is unremarkable.

The pilot is `default: true`, so it changes no behaviour on merge — an instance
with no `feature_flag` row keeps lists exactly as they were. The percentage
path has no real dark feature yet; it is held to unit and integration tests
until the next feature needs it, rather than shipping a canary nobody uses.

## 7. Server enforcement

- `requireFlag(key)` is a **preHandler factory** in `apps/api/src/lib/flags.ts`,
  wired like the catalog's `requireAdmin` (`apps/catalog/src/lib/admin-auth.ts:27`)
  so a route cannot forget to check a boolean return.
- Closed gate → `404 { error: 'not found' }`. Existing routes that were public
  before the gate keep answering `401` first when unauthenticated if that is
  their existing contract; the gate runs after validation, not before.
- **Resolve the viewer once.** `getSessionUser` (`apps/api/src/lib/session.ts:25`)
  is memoized on the request (a `Symbol` property) so the guard and the handler
  share one better-auth lookup instead of paying two. No signature changes.
- A flag never replaces a role check, a visibility check, or a friendship
  check. Where a feature is both gated and permissioned, the permission check
  still answers `404` on its own terms.

## 8. Operator surface

- **Phase 1:** API + CLI + a `CONTRIBUTING.md` section ("Rolling a feature out")
  with the three commands that matter: list, set 10%, kill.
- **Phase 3 (optional):** `/admin/flags` in `apps/web` on the existing Radix
  primitives (`Switch`, `Select`, a countries multi-select), role-gated by the
  API, not by hiding the route. Source badges (`default` / `db` / `env`), a
  read-only lock on env-owned rows, a rollout field with the small-instance
  caveat, a schedule pair, and a per-user override lookup by handle (`/users/search`
  already exists). No "view as user 42" bucket preview: a bucket cannot be
  simulated honestly, so the page shows the anonymous answer, the rule, and — for
  a user the operator explicitly picks — that user's evaluation, which is the
  only signed-in answer it can state without lying.
- **Audit:** `pnpm flags:audit` (`scripts/flags-audit/` or a db bin) prints flags
  past `removeBy`, flags untouched for 90 days and overrides older than 90 days.
  A warning in `pnpm lint` would be theatre; run it before a release.

## 9. Phases

Each phase is independently shippable, and neither phase 1 nor phase 2 changes
behaviour: phase 2's pilot is a kill switch graded in `default: true`.

### Phase 0 — registry + pure evaluator

| File | Change |
| --- | --- |
| `packages/shared/src/flags.ts` | `FlagDefinition`, `FLAG_DEFINITIONS` (empty), `FlagKey`, `FlagsSnapshotSchema`, `parseFlagOverrides` |
| `packages/shared/src/index.ts` | export |
| `apps/api/src/lib/flags.ts` | `bucket`, `countryFrom`, `evaluate` (pure, no DB) |
| `apps/api/test/flags.test.ts`, `packages/shared/test/flags.test.ts` | unit tests |

Acceptance: bucket distribution within ±1% over 10 000 synthetic ids;
monotonicity; per-flag independence; env grammar (invalid/unknown/duplicate/
empty); unknown country and empty allowlist; window boundaries; no viewer.

### Phase 1 — storage, endpoint, admin, env, CLI

| File | Change |
| --- | --- |
| `packages/db/src/schema/flags.ts` + `schema/index.ts` | two tables |
| `packages/db/migrations/0021_*.sql` | generated, reviewed |
| `apps/api/src/lib/flags.ts` | `loadFlagRows` + 5 s memo, `clearFlagCache`, `isFlagOn`, `evaluateSnapshot`, `requireFlag` |
| `apps/api/src/lib/admin.ts` | `requireAdminRole` |
| `apps/api/src/routes/v1/flags.ts`, `routes/v1/admin/flags.ts`, `routes/v1/index.ts` | `GET /v1/flags`, admin CRUD |
| `apps/api/src/lib/session.ts` | memoize `getSessionUser` per request |
| `packages/shared/src/env.ts` | `FEATURE_FLAGS`, `FLAG_COUNTRY_HEADER`, `FLAG_COUNTRY` (+ hints) |
| `turbo.json` | `dev.passThroughEnv` |
| `.env.example`, `docker-compose.yml` | document + pass through |
| `packages/db/src/bin/flag.ts`, `package.json` | `db:flag`, `db:flag:list` |
| `CONTRIBUTING.md` | operator section |
| `apps/api/test/flags.integration.test.ts` | see §10 |

Acceptance: `GET /v1/flags` → `{ flags: {} }`; an admin write is visible on the
next request and 401/403/400/409 behave; env wins and is reported; a flag at 0%
is off for every viewer including a signed-out one; no existing route changes
behaviour.

### Phase 2 — clients + pilot

| File | Change |
| --- | --- |
| `packages/client/src/flags.ts`, `index.ts` | `useFlags`, `useFlag`, `flagsKey` |
| `packages/client/src/runtime.ts`, `apps/web/src/lib/client.ts`, `apps/mobile/src/lib/client.ts` | `useViewerId` in the runtime seam |
| `apps/web/src/components/ui/FlagGate.tsx` | unavailable panel (translated) |
| `packages/client/src/lists.ts`, `apps/api/src/routes/v1/lists.ts` | pilot `requireFlag` + `enabled: useFlag` |
| `apps/web/src/components/layout/AppNav.tsx`, `routes/lists*.tsx`, `routes/media.$slug.tsx` | hide the surfaces |
| `apps/mobile/app/(app)/lists/*`, `(tabs)/profile.tsx`, `media/[slug].tsx`, `MediaActions.tsx` | hide the surfaces |
| `packages/shared/src/flags.ts` | the `lists.custom` entry |
| `packages/client/test/flags.test.ts` | fallback rules |
| `apps/web/src/i18n` | `FlagGate` copy |

Acceptance: with the flag on, every list surface is unchanged and no extra
request is made; `db:flag lists.custom=off` makes the API answer `404` and the
surfaces disappear within the cache TTL; `=25` shows it to a bucketed user and
not to an unbucketed one (an override proves the grant path); a queued mobile
write replayed against a killed route surfaces as a failed write.

### Phase 3 (optional) — admin UI + audit

`/admin/flags`, a nav entry only for `role === 'admin'`, and `flags:audit`.
Acceptance: every control either writes and is reflected on the next read, or is
visibly inert with the reason (`env` lock, unknown country source).

### Phase 4 (optional) — flag retirement tooling

A `db:flag --delete` path that refuses while the registry still has the key,
plus the documented order in §12. Cheap; it prevents the one failure that
matters once the system is boring.

## 10. Testing

**Unit (`apps/api/test/flags.test.ts`, no database):**

- bucket: 10 000 uuid-shaped ids at 1/10/50%, each within ±1 percentage point;
  monotonic widening; same id → same bucket across calls; different flag keys →
  different buckets.
- precedence: env > kill switch > override > country > rollout, one test per
  rung and one for the pair that must not cross (kill switch beats an override).
- country: allowlist hit/miss, unknown country fails closed, empty list means all,
  `XX`/`T1` as unknown, header normalization (`fr` → `FR`).
- window: before/in/at-end, `NULL` bounds.
- no viewer → only 100% passes; no row → default; db error → default.

**Integration (`apps/api/test/flags.integration.test.ts`):**

- its own database (`TEST_DATABASE_URL_FLAGS` → `trackt_flags_test`), migrated
  with `runMigrations`, self-skipping when Postgres is down (and throwing under
  `CI_REQUIRE_DB`, the `home.integration.test.ts:29` pattern). Persistent test
  databases keep rows between runs, so every test starts by deleting this
  suite's rule (its overrides cascade).
- admin auth: anonymous 401, `user` role 403, `admin` 200; unknown key 400;
  `rollout: 101` 400; env-owned key 409.
- read-through: PATCH then `GET /v1/flags` for a signed-in and a signed-out
  viewer; an override flips exactly one user; a kill switch defeats an override.
- country: `FLAG_COUNTRY_HEADER` set once through the suite's `loadEnv({...})`,
  the header itself varied per request, allowlist admits and excludes.
- pilot: `lists.custom` ruled off → `GET /v1/lists` 404, signed in or not.
- `cache-control: private, max-age=0, must-revalidate` and a stable `ETag` per
  viewer.

**Client (`packages/client/test/flags.test.ts`):** snapshot absent / pending /
error → compiled default; snapshot present → snapshot value; key absent from a
snapshot → compiled default; query key changes with the viewer id.

Run with `CI_REQUIRE_DB=1 pnpm test --force` (a cached replay proves nothing),
and say in the PR whether Docker was up.

## 11. Risks and non-goals

- **Two sources of truth (code default, DB rule).** Mitigated by one read module
  and by the admin read reporting `source`; every `PATCH` shows what it changed.
- **Stale rules across replicas.** Bounded at 5 s, not zero. A kill switch that
  must be instant is `FEATURE_FLAGS` + restart, or an infra-level block.
- **Spoofable country.** Only a trusted edge header is honoured; the failure is
  early access, not data exposure.
- **Percentage is not measurement.** No analytics means "rolled out to 10% and
  nobody complained" is the only signal. That is fine for releases, useless for
  experiments — hence no variants.
- **Small instances.** Percentages are near-meaningless under a few hundred
  users; overrides are the tool there.
- **Offline mobile.** Last-known flags can outlive a kill switch until the next
  fetch; server enforcement is unaffected.
- **Flag debt.** `removeBy` plus `flags:audit` is a policy, not a guarantee; the
  registry's `default` makes deletion safe in the right order (§12).
- **Flag-gated UI and accessibility.** A hidden nav entry is not an
  accessibility problem; a *visible* disabled control with no explanation is.
  `FlagGate` never replaces a control with a dead one.

## 12. Rollback and retiring a flag

- **Roll back a release:** set `rollout` back (or `enabled: false`) — no deploy,
  no data change. Users who already used the feature keep their data; gating is
  about presentation and API reachability, never about deleting what was
  written.
- **Kill a shipped feature:** `FEATURE_FLAGS=<key>=off` for the instant answer,
  then the DB row for the durable one.
- **Retire a flag, in this order:**
  1. flip the registry `default` to the shipped state and deploy (old binaries
     keep the feature);
  2. drop the DB row (`DELETE /v1/admin/flags/:key`);
  3. delete the registry entry and every branch in the same PR;
  4. run `flags:audit` — it should report nothing.
  Never delete the key while `default: false` and clients still ask for it: that
  turns a shipped feature off for every old binary at once.

## Acceptance criteria

1. A new feature can ship in `main` behind `default: false`, appear for 1% of
   signed-in users, widen to 100% and be killed, with no deploy after the first.
2. A flag restricted to `FR` is invisible outside France *and* when the country
   is unknown, with one boot warning if the instance has no country source.
3. `/v1/flags` degradation never hides a `default: true` feature and never
   reveals a `default: false` one.
4. Every flag has an owner and a review date, and `flags:audit` finds the ones
   that don't.
5. No flag is ever an authorization check.

## Open questions

- **Should the hosted instance's rollout be coordinated with self-hosts?** Today:
  no — each instance owns its number. If a catalog-wide feature ever needs one
  switch, it becomes a catalog contract, not this table.
- **Self-declared country** (`user.country`) as a fallback for instances behind
  no proxy? Deferred: it needs a profile field, a UI, and a privacy line, and it
  is spoofable in exactly the way a header is. The seam in `countryFrom` leaves
  room.
- **Retention of override rows** for deleted users: the FK cascades on user
  deletion (`DELETE /v1/me`), so nothing to clean.
- **A flag's effect on `/readyz`**: none. A flag is not a dependency.
