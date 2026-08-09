import { sql } from 'drizzle-orm';
import type { Db } from '@trackt/db';
import type {
  Friend,
  FriendRequest,
  FriendshipStatus,
  FriendState,
  FriendsOverview,
  UserSearchResult,
} from '@trackt/shared';

/**
 * Mutual friendship (ADR-0006): request + accept, symmetric thereafter, one
 * canonical-pair row per relationship. `pairKey` is the ordering invariant
 * the DB's `friendship_pair_ordered` CHECK enforces — every write and read
 * against `friendship` goes through it so the two never drift apart.
 */

/** Order a pair of user ids the way `friendship`'s `(user_a_id, user_b_id)` PK requires. */
export function pairKey(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

type FriendshipRow = {
  status: FriendshipStatus;
  requestedBy: string;
};

/**
 * Viewer-relative state from a `friendship` row (or its absence). Pure and
 * DB-free on purpose — this is where an off-by-one direction bug would hide.
 * Does not handle `'self'`; callers compare ids before reaching for a row.
 */
export function friendStateFor(row: FriendshipRow | undefined, viewerId: string): FriendState {
  if (!row) return 'none';
  if (row.status === 'accepted') return 'friends';
  return row.requestedBy === viewerId ? 'outgoing' : 'incoming';
}

export async function areFriends(db: Db, userId1: string, userId2: string): Promise<boolean> {
  const [lo, hi] = pairKey(userId1, userId2);
  const rows = await db.execute(sql`
    SELECT 1 FROM friendship
    WHERE user_a_id = ${lo}::uuid AND user_b_id = ${hi}::uuid AND status = 'accepted'
    LIMIT 1
  `);
  return rows.length > 0;
}

/** The raw row for a pair, or undefined — the public-profile `friendState` reads this directly. */
export async function loadFriendshipRow(
  db: Db,
  userId1: string,
  userId2: string,
): Promise<FriendshipRow | undefined> {
  const [lo, hi] = pairKey(userId1, userId2);
  const [row] = await db.execute(sql`
    SELECT status, requested_by FROM friendship
    WHERE user_a_id = ${lo}::uuid AND user_b_id = ${hi}::uuid
  `);
  if (!row) return undefined;
  return { status: row.status as FriendshipStatus, requestedBy: row.requested_by as string };
}

/**
 * Send (or, if the other side already asked, auto-accept) a friend request.
 * Race-free by construction: the PK plus `ON CONFLICT ... WHERE` collapses
 * "A requests B while B requests A" into one statement instead of a racy
 * read-then-write. Returns the row's current state either way — `RETURNING`
 * is empty when the conflict clause no-ops (already pending mine, or already
 * friends), so we fall back to a plain read.
 */
export async function sendFriendRequest(
  db: Db,
  fromUserId: string,
  toUserId: string,
): Promise<FriendshipRow> {
  const [lo, hi] = pairKey(fromUserId, toUserId);
  const written = await db.execute(sql`
    INSERT INTO friendship (user_a_id, user_b_id, requested_by, status)
    VALUES (${lo}::uuid, ${hi}::uuid, ${fromUserId}::uuid, 'pending')
    ON CONFLICT (user_a_id, user_b_id) DO UPDATE
      SET status = 'accepted', responded_at = now()
      WHERE friendship.status = 'pending' AND friendship.requested_by <> ${fromUserId}::uuid
    RETURNING status, requested_by
  `);
  let result = written[0];
  if (!result) {
    const [row] = await db.execute(sql`
      SELECT status, requested_by FROM friendship
      WHERE user_a_id = ${lo}::uuid AND user_b_id = ${hi}::uuid
    `);
    result = row!;
  }
  return {
    status: result.status as FriendshipStatus,
    requestedBy: result.requested_by as string,
  };
}

/**
 * Accept an incoming pending request. The `requested_by <> viewer` predicate
 * also stops someone accepting their own outgoing request. Null on no match
 * (no such request, or it's mine, or already accepted) — the route 404s.
 */
export async function acceptFriendRequest(
  db: Db,
  viewerId: string,
  otherUserId: string,
): Promise<{ respondedAt: string } | null> {
  const [lo, hi] = pairKey(viewerId, otherUserId);
  const rows = await db.execute(sql`
    UPDATE friendship SET status = 'accepted', responded_at = now()
    WHERE user_a_id = ${lo}::uuid AND user_b_id = ${hi}::uuid
      AND status = 'pending' AND requested_by <> ${viewerId}::uuid
    RETURNING responded_at
  `);
  if (rows.length === 0) return null;
  return { respondedAt: rows[0]!.responded_at as string };
}

/**
 * Remove whatever links two users — outgoing pending (cancel), incoming
 * pending (decline), or accepted (unfriend). Always succeeds, even if no row
 * existed, so a double-clicked decline can't 404.
 */
export async function removeFriendship(db: Db, userId1: string, userId2: string): Promise<void> {
  const [lo, hi] = pairKey(userId1, userId2);
  await db.execute(sql`
    DELETE FROM friendship WHERE user_a_id = ${lo}::uuid AND user_b_id = ${hi}::uuid
  `);
}

/** Outstanding requests a user has sent — the anti-spam cap reads this. */
export async function countPendingOutgoing(db: Db, userId: string): Promise<number> {
  const [row] = await db.execute(sql`
    SELECT count(*)::int AS count FROM friendship
    WHERE status = 'pending' AND requested_by = ${userId}::uuid
  `);
  return Number(row?.count ?? 0);
}

/** Accepted friendships, either side of the pair — the profile header badge. */
export async function countFriends(db: Db, userId: string): Promise<number> {
  const [row] = await db.execute(sql`
    SELECT count(*)::int AS count FROM friendship
    WHERE (user_a_id = ${userId}::uuid OR user_b_id = ${userId}::uuid) AND status = 'accepted'
  `);
  return Number(row?.count ?? 0);
}

/** Pending requests from someone else, waiting on this user — the own-profile badge. */
export async function countIncomingRequests(db: Db, userId: string): Promise<number> {
  const [row] = await db.execute(sql`
    SELECT count(*)::int AS count FROM friendship
    WHERE status = 'pending' AND requested_by <> ${userId}::uuid
      AND (user_a_id = ${userId}::uuid OR user_b_id = ${userId}::uuid)
  `);
  return Number(row?.count ?? 0);
}

/**
 * Prefix-ILIKE on handle (handles are prefix-typed) + infix on display name,
 * trgm-indexed. A `LEFT JOIN` against `friendship` on the canonical pair
 * gives every row its `friendState` in one pass — no N+1. `username IS NOT
 * NULL` is load-bearing: the column is nullable pre-onboarding.
 */
export async function searchUsers(
  db: Db,
  q: string,
  limit: number,
  viewerId: string,
): Promise<UserSearchResult[]> {
  const rows = await db.execute(sql`
    SELECT u.id, u.display_username AS username, u.name, u.image,
           f.status AS friend_status, f.requested_by AS friend_requested_by
    FROM "user" u
    LEFT JOIN friendship f
      ON f.user_a_id = LEAST(u.id, ${viewerId}::uuid)
     AND f.user_b_id = GREATEST(u.id, ${viewerId}::uuid)
    WHERE u.username IS NOT NULL
      AND u.id <> ${viewerId}::uuid
      AND (u.username ILIKE ${q + '%'} OR u.name ILIKE ${'%' + q + '%'} OR u.name % ${q})
    ORDER BY u.username ASC
    LIMIT ${limit}
  `);

  return [...rows].map((row) => ({
    id: row.id as string,
    username: row.username as string,
    name: row.name as string,
    image: row.image as string | null,
    friendState: friendStateFor(
      row.friend_status === null
        ? undefined
        : {
            status: row.friend_status as FriendshipStatus,
            requestedBy: row.friend_requested_by as string,
          },
      viewerId,
    ),
  }));
}

/**
 * All three buckets in one query, joining `"user"` on whichever side of the
 * pair isn't the viewer and partitioning by status/direction in TS. The
 * dialog and the profile section both need all three at once.
 */
export async function loadFriendsOverview(db: Db, userId: string): Promise<FriendsOverview> {
  const rows = await db.execute(sql`
    SELECT u.id, u.display_username AS username, u.name, u.image,
           f.status, f.requested_by, f.created_at, f.responded_at
    FROM friendship f
    JOIN "user" u ON u.id = CASE WHEN f.user_a_id = ${userId}::uuid THEN f.user_b_id ELSE f.user_a_id END
    WHERE f.user_a_id = ${userId}::uuid OR f.user_b_id = ${userId}::uuid
    ORDER BY COALESCE(f.responded_at, f.created_at) DESC
  `);

  const friends: Friend[] = [];
  const incoming: FriendRequest[] = [];
  const outgoing: FriendRequest[] = [];

  for (const row of rows) {
    const summary = {
      id: row.id as string,
      username: row.username as string,
      name: row.name as string,
      image: row.image as string | null,
    };
    if (row.status === 'accepted') {
      friends.push({ ...summary, since: new Date(row.responded_at as string).toISOString() });
    } else if (row.requested_by === userId) {
      outgoing.push({ ...summary, requestedAt: new Date(row.created_at as string).toISOString() });
    } else {
      incoming.push({ ...summary, requestedAt: new Date(row.created_at as string).toISOString() });
    }
  }

  return { friends, incoming, outgoing };
}
