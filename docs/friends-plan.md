# Plan — Mutual friends (request + accept) and `followers` list visibility

> **Status:** Not started — planning only. Deeper context: [PRD](PRD.md), [ROADMAP](ROADMAP.md).
> The data-model and visibility decisions here should be recorded as **ADR-0006** when Phase 1 lands.

## Context

Trackt has no social graph. The `follow` table in `packages/db/src/schema/social.ts:79` was created in
migration `0000` and has **never been read or written** — a grep for it across `apps/` and `packages/`
returns zero hits. Everything downstream of it is a placeholder:

- `apps/api/src/lib/list-visibility.ts` deliberately fails closed on the `'followers'` visibility value,
  so a list set to "followers" is visible to nobody but its owner. `apps/api/test/lists.integration.test.ts:244`
  asserts exactly that.
- `apps/web/src/routes/lists.tsx:22` renders a `FOLLOWING` scope tab as an inert tooltip.
- `apps/web/src/routes/profile.tsx` shows a dead "PROFILE VISIBILITY / PRIVATE" card.
- `docs/design/Profile.dc.html` designs a `214 FOLLOWERS / 180 FOLLOWING` header row the live page omits.

This change lands the relationship layer those placeholders are waiting on. **Decided shape: mutual
friendship with request + accept** — A sends a request, B accepts, and the relationship is symmetric
thereafter. Not an asymmetric follow: the product surface it unlocks (`followers`-scoped lists) is a
consent-based audience, and a directed follow gives no consent gate.

Outcome: a user can search for someone by handle, send a friend request, accept incoming ones, and
see their friends on their profile; lists set to `followers` become visible to accepted friends; and
`/users/$username` becomes a real, linkable profile page.

**Out of scope:** the friends activity feed on `/home` (`apps/api/src/routes/v1/home.ts:18` stays a
placeholder), a friends-lists scope on `/lists`, blocking, and any per-user privacy column.

### Decisions taken

| Question | Decision |
| --- | --- |
| Relationship model | Mutual, request → accept, one row per pair |
| Discovery | `GET /v1/users/search`, pg_trgm over handle + display name, session required |
| `/users/$username` | **Anonymous-readable** (shareable link) |
| Non-friend visibility | **No gating** — stats, favourites and activity are all public |
| Enum value | Keep `'followers'` in the DB; relabel to "FRIENDS" in the UI |

⚠️ Anonymous + ungated means a profile's check-in/rating activity is world-readable at a public URL.
That is a deliberate choice for a self-hosted instance; record it in the ADR (below) so it reads as a
decision rather than an oversight, and note that adding a per-user visibility column later is additive.

---

## 1. Data model

**Drop `follow`.** Never written to, so the drop is data-lossless. Leaving an asymmetric-follow table
next to a symmetric friendship table creates a "which one is real?" ambiguity.

**Replace it with a canonical-pair `friendship` table** in `packages/db/src/schema/social.ts`:

```ts
export const friendship = pgTable(
  'friendship',
  {
    /** Ordered pair: user_a_id < user_b_id, so one row is the *whole* relationship. */
    userAId: uuid('user_a_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    userBId: uuid('user_b_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    /** Who sent the request — the only asymmetry a mutual relationship keeps. */
    requestedBy: uuid('requested_by').notNull().references(() => users.id, { onDelete: 'cascade' }),
    status: friendshipStatusEnum('status').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.userAId, t.userBId] }),
    index('friendship_user_b_idx').on(t.userBId, t.status),
    // The ordering invariant that makes one-row-per-pair possible; subsumes a no-self check.
    check('friendship_pair_ordered', sql`${t.userAId} < ${t.userBId}`),
    check('friendship_requester_member',
      sql`${t.requestedBy} = ${t.userAId} OR ${t.requestedBy} = ${t.userBId}`),
  ],
);
```

Why the canonical pair rather than a directed `(requester, addressee)` row: is-friend becomes a single
PK probe, and the **reverse-request race is impossible by construction** — A requesting B while B
requests A hits the PK and resolves in one `ON CONFLICT` statement instead of a racy read-then-write.
Two mirrored rows on accept is worse than both: doubled storage, two-row unfriend, and a consistency
invariant with no DB enforcement.

Cost: a `pairKey(a, b)` helper on every write (5 lines, unit-testable without a DB).

**Enum**, following the repo's shared-const pattern (`packages/db/src/schema/enums.ts` sources every
enum but `report_status` from `@trackt/shared`):

- `packages/shared/src/friends.ts` — `export const FRIENDSHIP_STATUSES = ['pending', 'accepted'] as const;`
- `packages/db/src/schema/enums.ts` — `export const friendshipStatusEnum = pgEnum('friendship_status', FRIENDSHIP_STATUSES);`

**Search indexes** in `packages/db/src/schema/auth.ts` — `pg_trgm` already exists (migration `0000` line 1),
and plain-column trgm indexes *are* expressible in Drizzle (`packages/db/src/schema/media.ts:102` proves
it), so no hand-written SQL like migration `0003` is needed. Convert `users` to the 2-arg `pgTable` form:

```ts
(t) => [
  index('user_username_trgm_idx').using('gin', sql`${t.username} gin_trgm_ops`),
  index('user_name_trgm_idx').using('gin', sql`${t.name} gin_trgm_ops`),
]
```

**Migrations.** Run `pnpm --filter @trackt/db db:generate` **twice** — once for the `follow` drop, once
for `friendship` + the indexes — so drizzle-kit never shows its interactive "renamed or dropped?" prompt.
Yields `0012_*` and `0013_*` plus their `meta/` snapshots and `_journal.json` entries. Review the emitted
SQL per `CONTRIBUTING.md`: confirm the `<` check renders as `"friendship"."user_a_id" < "friendship"."user_b_id"`
(uuid has a btree opclass, but the repo's precedents only use `<>`).

## 2. Request semantics

**Decline deletes the row** — no `'declined'` status. A retained declined row would silently block the
declined-by user from ever requesting back, and leaks "I declined you". The enum stays two-valued; a
future `'blocked'` is an additive `ALTER TYPE`.

**One endpoint, three verbs.** `DELETE /v1/me/friends/:userId` removes whatever row links the two users:
outgoing pending → cancel, incoming pending → decline, accepted → unfriend. Always `204`, even when no
row existed — a double-clicked DECLINE must not 404.

**Send is a single idempotent statement** in `apps/api/src/lib/friends.ts`:

```sql
INSERT INTO friendship (user_a_id, user_b_id, requested_by, status)
VALUES (${lo}::uuid, ${hi}::uuid, ${me}::uuid, 'pending')
ON CONFLICT (user_a_id, user_b_id) DO UPDATE
  SET status = 'accepted', responded_at = now()
  WHERE friendship.status = 'pending' AND friendship.requested_by <> ${me}::uuid
RETURNING *
```

Three race-free outcomes: no row → `pending`; the *other* user's pending request → **auto-accepted**
(requesting someone who already asked you is an accept); mine-pending or already-accepted → the
`DO UPDATE ... WHERE` no-ops, `RETURNING` is empty, so fall through to a `SELECT` and return current
state as `200`.

Accept is the explicit form: `UPDATE ... SET status='accepted', responded_at=now() WHERE (a,b)=(lo,hi)
AND status='pending' AND requested_by <> ${me} RETURNING *`; zero rows → `404`. That predicate also
stops someone accepting their own outgoing request.

**Anti-spam:** a per-user cap is the real control — `count(*) WHERE status='pending' AND requested_by = me`
over `FRIEND_REQUEST_PENDING_MAX` (50, exported from `packages/shared/src/friends.ts` beside the other
limit constants) → `429`. Add the route bucket too (`config: { rateLimit: { max: 30, timeWindow: '1 hour' } }`,
the `routes/v1/search.ts:18` precedent), but note `apps/api/src/app.ts:65` uses the default **per-IP**
key generator, so it throttles the wrong thing behind a NAT.

## 3. API surface

Two new `FastifyPluginAsyncZod` modules registered in `apps/api/src/routes/v1/index.ts`:
`friendRoutes` (`routes/v1/friends.ts`) and `userRoutes` (`routes/v1/users.ts`). Each handler keeps the
house preamble — `const db = app.deps.db; if (!db) return reply.status(503)…` then `getSessionUser` → 401.

| Method | Path | Body/query | 200 | Errors | Auth |
| --- | --- | --- | --- | --- | --- |
| GET | `/v1/users/search` | `UserSearchQuerySchema` | `UserSearchResultSchema[]` | 401, 503 | session |
| GET | `/v1/users/:username/profile` | params `{ username }` | `PublicProfileSchema` | 404, 503 | **optional** |
| GET | `/v1/me/friends` | — | `FriendsOverviewSchema` | 401, 503 | session |
| POST | `/v1/me/friends/requests` | `SendFriendRequestBodySchema` `{ username }` | `FriendshipStateSchema` | 400 self, 401, 404, 429, 503 | session |
| POST | `/v1/me/friends/requests/:userId/accept` | params `{ userId }` | `FriendSchema` | 401, 404, 503 | session |
| DELETE | `/v1/me/friends/:userId` | params `{ userId }` | `204` | 401, 503 | session |

Notes:

- **Separate from `/v1/search`**, which is federated media search (ADR-0002) with a catalog round-trip.
  Same 60/min bucket. New `searchUsers(db, query, viewerId)` in `apps/api/src/lib/friends.ts`, mirroring
  `searchLocalMedia` in `apps/api/src/lib/search.ts` (raw `db.execute`, trgm `%` with an ILIKE fallback
  for short queries): prefix-ILIKE on `username` (handles are prefix-typed), infix on `name`. A
  `LEFT JOIN friendship ON f.user_a_id = LEAST(u.id, ${me}) AND f.user_b_id = GREATEST(u.id, ${me})`
  gives every row its `friendState` in one pass — no N+1. `AND u.username IS NOT NULL` is load-bearing:
  the column is nullable (`packages/db/src/schema/auth.ts:19`).
- **Send takes `username`, mutations take `userId`.** Resolve the handle with `eq(users.username, input.toLowerCase())`
  — better-auth's username plugin stores lowercase in `username`, raw case in `displayUsername`.
- **`GET /v1/me/friends` returns all three buckets** (friends / incoming / outgoing) from one query that
  joins `"user"` on `CASE WHEN f.user_a_id = ${me} THEN f.user_b_id ELSE f.user_a_id END` and partitions
  in TS. Both the dialog and the profile section need all three at once.
- **Public profile:** optional session; `friendState` is `'none'` for anonymous viewers. Body is the same
  data as `GET /me/profile` minus the edit affordances, plus `friendState` and `friendCount`. No gating.
- **Reuse over duplication:** extract `loadProfileStats(db, userId)` and `loadFavorites(db, userId)` from
  `apps/api/src/routes/v1/profile.ts` into `apps/api/src/lib/me.ts` (which already hosts `loadActivity`,
  `loadStreak`, `loadYearCheckinCounts`) and call them from both handlers. Without this the two profile
  endpoints drift.
- **Pass the viewer into `loadActivity`.** It currently filters media by the *subject's* visibility, so a
  profile visitor could see the title of an `unverified` entry the owner created. One extra parameter,
  applying `visibleMediaSql(viewer)` — keeps the "media rules and social rules both apply" invariant that
  `apps/api/src/routes/v1/lists.ts` documents.

## 4. Unblocking `followers` list visibility

`canViewList` has **exactly one call site** — `apps/api/src/routes/v1/lists.ts:285` (`GET /lists/:id`) —
and there is no SQL-level list filtering anywhere (`GET /lists` is `WHERE owner_id = me`). So keep the
function pure and synchronous with a third parameter:

```ts
// apps/api/src/lib/list-visibility.ts
export function canViewList(
  list: { ownerId: string; visibility: Visibility },
  viewer: SessionUser | null,
  isFriend = false,
): boolean {
  if (viewer !== null && list.ownerId === viewer.id) return true;
  if (list.visibility === 'public') return true;
  return list.visibility === 'followers' && isFriend;
}
```

Compute it lazily in the handler so the common path gains zero queries:

```ts
const isFriend =
  row !== undefined && row.visibility === 'followers' && viewer !== null && row.ownerId !== viewer.id
    ? await areFriends(db, viewer.id, row.ownerId)
    : false;
```

Do **not** add a `visibleListSql` yet — no raw query needs it. When one does, the right shape is an
`EXISTS` subquery against `friendship`, not a `friendIds[]` array parameter (see the note in
`apps/api/src/routes/v1/media.ts` about array interpolation).

Rewrite `apps/api/test/lists.integration.test.ts:244` (`'fails closed on followers until the follow
system exists'`) into two assertions in one test: a befriended user gets 200, a stranger still 404s —
the suite already signs up a `stranger`; add one more signup.

**Keep the `'followers'` enum value.** Renaming means `ALTER TYPE ... RENAME VALUE`, a `VISIBILITIES`
change in `packages/shared/src/media.ts:132`, and churn through every `Visibility` consumer, for a label
the UI already overrides in one place. Add a comment at that line so the mismatch reads as intentional.

**Copy that currently asserts the feature doesn't exist** — update all of it:
`apps/web/src/routes/lists.tsx:22-35` (`VISIBILITY_HELP.followers`, the `SCOPES` comment; keep
`{ key: 'following', ready: false }` but relabel to `FRIENDS` and say it needs a friends-lists endpoint),
`packages/shared/src/lists.ts:9`, `apps/api/src/routes/v1/profile.ts:19`, `packages/shared/src/profile.ts:5`,
`apps/web/src/routes/profile.tsx:239` (the PROFILE VISIBILITY tooltip), `docs/ROADMAP.md:19-21,47,51-52`.

## 5. Shared schemas — `packages/shared/src/friends.ts`

New module, exported from `packages/shared/src/index.ts` in alphabetical position (after `./env-catalog.js`):

- `FRIENDSHIP_STATUSES` / `FriendshipStatusSchema` — `['pending','accepted']`, the DB enum source.
- `FRIEND_STATES` / `FriendStateSchema` — `['none','outgoing','incoming','friends','self']`. This is the
  **viewer-relative** state every button keys off, so no client ever re-derives direction from ids.
- `UserSummarySchema` — `{ id, username, name, image }` (`username` is the display-cased handle).
- `UserSearchQuerySchema` `{ q, limit }` / `UserSearchResultSchema` = summary + `friendState`.
- `FriendSchema` (summary + `since`), `FriendRequestSchema` (summary + `requestedAt`).
- `FriendsOverviewSchema` `{ friends, incoming, outgoing }`.
- `SendFriendRequestBodySchema` `{ username }`, `FriendshipStateSchema` `{ user, friendState }`.
- `FRIEND_REQUEST_PENDING_MAX = 50`.

`PublicProfileSchema` belongs in `packages/shared/src/profile.ts` instead, since it reuses
`FavoriteEntrySchema` and the stats object. Extract the inline schemas at `profile.ts:57-72` into named
`ProfileUserSchema` / `ProfileStatsSchema`, reference them from both `ProfileSummarySchema` and:

```ts
export const PublicProfileSchema = z.object({
  user: ProfileUserSchema,
  stats: ProfileStatsSchema,
  favorites: z.array(FavoriteEntrySchema),
  activity: z.array(ActivityEntrySchema),
  friendState: FriendStateSchema,
  friendCount: z.number().int().nonnegative(),
});
```

Add `friendCount` and `incomingRequestCount` to `ProfileSummarySchema.stats` for the own-profile header badge.

## 6. Web

**`apps/web/src/lib/friends.ts`** — mirror `apps/web/src/lib/lists.ts` exactly (exported query keys, a
module-private `request<T>()` helper, an `xxxApi` object, an invalidator hook, `useMutation` wrappers;
mutations invalidate rather than patch the cache):

- `friendsKey`, `publicProfileKey(username)`.
- `useFriends()` — gated on `authClient.useSession()`, parses `FriendsOverviewSchema`.
- `useUserSearch(q)` — the `apps/web/src/lib/search.ts` shape: `keepPreviousData`, `enabled: q.length >= 2`,
  `signal` passthrough. **Debounce lives in the component**, per that module's documented contract.
- `usePublicProfile(username)` — the `useList` 404-as-data idiom (`throwHttpErrors: false`, `404 → null`)
  so an unknown handle renders "no such user" instead of an error banner.
- `friendsApi = { sendRequest, accept, remove }` + `useFriendsInvalidator()` (invalidates `friendsKey`,
  `['profile']`, and the relevant `publicProfileKey`).

**`apps/web/src/components/social/AddFriendDialog.tsx`** — modelled on
`apps/web/src/components/media/AddToListDialog.tsx` (rows with a per-row action, inline `role="alert"`
error, ghost DONE footer). `Modal` + `ModalTitle`; an incoming-requests block at the top with
ACCEPT/DECLINE when non-empty; a 200 ms debounced `Input` (the `routes/search.tsx:50-60` timer, minus the
URL sync); result rows as `GlassCard as="li"` with `Avatar` + name + `@handle` and a `Button` whose label
comes off `friendState` (`＋ ADD` / `PENDING` disabled / `✓ FRIENDS`). Unfriend goes through
`components/ui/ConfirmDialog.tsx`.

**`apps/web/src/routes/profile.tsx`** — three edits: an `N FRIENDS` span in the header meta row beside
TITLES TRACKED (this is what the mockup's `FOLLOWERS / FOLLOWING` pair becomes — one count, because the
relationship is symmetric); a Friends section in the `lg:grid-cols-[2fr_1fr]` block beside Badges (avatar
grid linking to `/users/$username`, an `＋ ADD FRIEND` button, a pink badge when `incoming.length > 0`);
and the visibility-card copy fix.

**`apps/web/src/routes/users.$username.tsx`** — flat dot naming gives `/users/$username`. Anonymous-readable,
so use the optional-session pattern from `apps/web/src/routes/news_.$slug.tsx` (`MarketingNav` when signed
out, `AppNav` when signed in) rather than `useAuthedPage()`. To avoid a third copy of the header /
stat-strip / favourite-shelf markup, extract `components/profile/ProfileHeader.tsx` and
`components/profile/FavouriteShelves.tsx` out of `profile.tsx` (already ~480 lines) and consume both from
each route. The public page adds the friend-state action button (`＋ ADD FRIEND` / `REQUEST SENT` /
`ACCEPT REQUEST` / `✓ FRIENDS` with an unfriend confirm) and `friendCount`.

⚠️ `apps/web/src/routeTree.gen.ts` is **generated and committed**. The new route won't typecheck until the
TanStack Start plugin regenerates it — run `pnpm dev` or `pnpm build` and commit the regenerated file in
the same commit, or CI's `pnpm typecheck` fails.

**No new `NAV_ITEMS` entry** in `apps/web/src/components/layout/AppNav.tsx` — friends live on `/profile`;
a sixth top-level item for a feature with no dedicated page is noise. Use the incoming-request badge on
the PROFILE link for discoverability instead.

## 7. Tests

**New `apps/api/test/friends.integration.test.ts`** — copy the boilerplate block from
`lists.integration.test.ts:1-80` verbatim (`TEST_DATABASE_URL_FRIENDS ?? 'postgres://trackt:trackt@localhost:5432/trackt_friends_test'`,
`ensureTestDatabase()` + `describe.runIf(available)`, `runMigrations → createDb → seedMedia → loadEnv → buildApp`,
and the sign-up-then-grab-`set-cookie` helper). **Three** users — alice, bob, carol — because half the
assertions are "the third party sees nothing".

Cases: request creates outgoing/incoming and carol sees neither → accept makes both sides friends →
reverse request auto-accepts → duplicate request is idempotent (200, one row) → decline deletes and
re-request works → delete-after-accept unfriends both directions → self-request 400, unknown username 404,
no cookie 401 → `users/search` matches handle prefix, matches a typo'd handle via trgm, excludes self, and
reports the right `friendState` per relationship → `users/:username/profile` returns stats/favourites/activity
for anonymous, friend, and stranger alike, 404s on an unknown handle → pending cap returns 429.

**New `apps/api/test/friends.test.ts`** (no DB) — `pairKey(a,b) === pairKey(b,a)` and stable ordering, plus
the `friendStateFor(row, viewerId)` derivation. Both are pure, and both are where the off-by-one bugs live.

**Changed `apps/api/test/lists.integration.test.ts:244`** per §4.

## 8. Phasing

Four PRs, each green under `pnpm lint && pnpm typecheck && pnpm test && pnpm format:check`.

1. **Data model + friends API.** `packages/shared/src/friends.ts` + index export; `friendshipStatusEnum`;
   `friendship` table and `follow` removal; trgm indexes; migrations `0012`/`0013`;
   `apps/api/src/lib/friends.ts` (`pairKey`, `areFriends`, `friendStateFor`, `searchUsers`,
   `loadFriendsOverview`); `routes/v1/friends.ts` + `routes/v1/users.ts`; both test files. Plus
   **`docs/adr/0006-mutual-friends-over-asymmetric-follows.md`** — the repo writes an ADR for exactly this
   class of decision (0003, 0004), and dropping `follow` for a symmetric pair, plus the two open-visibility
   calls (anonymous profiles, authenticated user enumeration), deserves one.
2. **`followers` visibility unblock.** `canViewList` + its single call site + the lists test rewrite + all
   the "until the follow system ships" copy. The only phase that changes existing behaviour.
3. **Public profile endpoint + web data layer.** `loadProfileStats`/`loadFavorites` extraction;
   `ProfileUserSchema`/`ProfileStatsSchema`/`PublicProfileSchema`; `GET /v1/users/:username/profile`;
   `friendCount` on the own-profile summary; `apps/web/src/lib/friends.ts`; `AddFriendDialog`; the profile
   friends section and count.
4. **`/users/$username`.** `ProfileHeader`/`FavouriteShelves` extraction; the route + regenerated
   `routeTree.gen.ts`; links from friend rows and from the list-owner name (already carried as
   `ListDetail.owner.username`, currently plain text); ROADMAP/PRD updates.

Phases 1 and 2 can merge together if landing a table whose only consumer is its own test feels wrong.

## 9. Verification

Per phase:

```bash
pnpm lint && pnpm typecheck && pnpm format:check
pnpm test                         # integration suites need Postgres
docker compose -f docker-compose.dev.yml up -d   # if the DB isn't already running
pnpm --filter @trackt/api test -- friends
```

The integration suites self-skip when Postgres is unreachable — **check the output for `skipped` rather
than assuming green**, or set `CI_REQUIRE_DB=1` to make absence a failure.

End-to-end, after phase 3/4: use the **`verify` skill** (`.claude/skills/verify/SKILL.md`) to bring up
catalog → worker → API → web, then drive the real flow in the browser: sign up two accounts, search for
the second handle from the first, send a request, accept it from the second, confirm each profile shows
the other under Friends with the right count, set a list to `followers` on account A and confirm account B
can open it while a signed-out window 404s, and open `/users/<handle>` signed out to confirm it renders.
