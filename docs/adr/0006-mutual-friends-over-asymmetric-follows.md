# ADR-0006: Mutual friends over asymmetric follows

**Status:** Accepted — 2026-08-09 (Phase 1 of 4; see `docs/friends-plan.md`)

## Context

Trackt has no social graph. The `follow` table in `packages/db/src/schema/social.ts`
was created in the initial migration and had never been read or written — a grep
across `apps/` and `packages/` returned zero hits. Everything downstream of it was
a placeholder: `apps/api/src/lib/list-visibility.ts` deliberately failed closed on
the `'followers'` visibility value, `apps/web/src/routes/lists.tsx` rendered a
`FOLLOWING` scope tab as an inert tooltip, `apps/web/src/routes/profile.tsx` showed
a dead "PROFILE VISIBILITY / PRIVATE" card, and `docs/design/Profile.dc.html`
designed a `214 FOLLOWERS / 180 FOLLOWING` header row the live page omitted.

This ADR records the relationship layer those placeholders were waiting on.

## Decision

1. **Mutual friendship, request → accept — not an asymmetric follow.** A sends a
   request, B accepts, and the relationship is symmetric thereafter. The product
   surface this unlocks (`followers`-scoped lists) is a consent-based audience: a
   list owner is trusting a specific set of people, not broadcasting to whoever
   chose to follow them. A directed follow gives no consent gate on the follower
   side, so it cannot back that surface honestly. The `'followers'` enum value on
   `list.visibility` is kept as-is (relabelled "FRIENDS" in the UI only) — renaming
   it would touch every `Visibility` consumer for a label the UI already overrides
   in one place.

2. **Canonical-pair row, not two mirrored directed rows.** `friendship` stores one
   row per relationship, keyed on `(user_a_id, user_b_id)` with `user_a_id <
   user_b_id` enforced by a CHECK — the ordering invariant that makes one-row-per-
   pair possible, and it subsumes a no-self check for free. `requested_by` is the
   only asymmetry a mutual relationship keeps. The alternative — a directed
   `(requester, addressee)` row, mirrored into two rows on accept — was rejected:
   is-friend stops being a single PK probe, unfriending must delete two rows
   instead of one, and the mirrored pair is a consistency invariant the database
   cannot enforce, only application code can maintain. The canonical pair also
   makes the reverse-request race impossible by construction: A requesting B while
   B requests A hits the same primary key and resolves inside one `ON CONFLICT`
   statement, rather than a racy read-then-write across two directed rows.

3. **Public, anonymous-readable profiles with no non-friend gating.** `GET
   /v1/users/:username/profile` (phase 3) answers without a session, and nothing
   on it — stats, favourites, activity — is hidden from a stranger or an anonymous
   visitor. This is a deliberate choice for a self-hostable, mostly-small-instance
   product where a shareable profile link matters more than protecting check-in
   history from other logged-in users, not an oversight. It does mean a profile's
   rating/check-in activity is world-readable at a public URL once phase 3/4 land.
   Adding a per-user visibility column later is additive and does not require
   revisiting this table.

4. **Declining deletes the row; no `'declined'` status.** A retained declined row
   would silently block the declined-by user from ever requesting again and would
   leak "I declined you" to anyone probing state. The enum stays two-valued
   (`pending`, `accepted`); a future `'blocked'` status is an additive `ALTER
   TYPE` when moderation needs it, not a reason to add one now.

5. **User discovery is authenticated, symmetric-search only.** `GET
   /v1/users/search` requires a session — unlike the public profile route, open
   handle enumeration by anonymous callers isn't a surface this phase opens.

## Consequences

- `follow` is dropped (migration `0012`), data-lossless since it was never
  written. Leaving it beside `friendship` would create a "which relationship is
  real?" ambiguity for every future reader of the schema.
- `friendship` costs a `pairKey(a, b)` helper on every read and write
  (`apps/api/src/lib/friends.ts`) — five lines, unit-testable without a database —
  in exchange for the race-freedom and single-row storage above.
- `canViewList`'s `followers` branch (phase 2) depends on an `areFriends` query
  the common `public`/`private`/owner paths never pay for; it is computed lazily,
  only when the list is `followers`-scoped and the viewer isn't the owner.
- Two open-visibility calls compound: an anonymous profile page (point 3) plus
  authenticated user search (point 5) mean a signed-in user can enumerate other
  handles by prefix, and anyone can read a known handle's public activity. Both
  are accepted for a self-hosted instance; a private/invite-only mode is future
  work, not blocking.
- `packages/shared/src/friends.ts`'s `FriendState` (`none | outgoing | incoming |
  friends | self`) becomes the single vocabulary every client button keys off —
  no consumer re-derives direction from raw user ids.
