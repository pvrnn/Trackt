import { z } from 'zod';

/**
 * Mutual friendship — request + accept, symmetric thereafter (ADR-0006). No
 * asymmetric follow: the product surface it unlocks (`followers`-scoped lists,
 * see media.ts's `VISIBILITIES`) is a consent-based audience.
 */

export const FRIENDSHIP_STATUSES = ['pending', 'accepted'] as const;
export const FriendshipStatusSchema = z.enum(FRIENDSHIP_STATUSES);
export type FriendshipStatus = z.infer<typeof FriendshipStatusSchema>;

/**
 * Viewer-relative relationship state — every action button keys off this, so
 * no client ever re-derives direction from raw ids.
 */
export const FRIEND_STATES = ['none', 'outgoing', 'incoming', 'friends', 'self'] as const;
export const FriendStateSchema = z.enum(FRIEND_STATES);
export type FriendState = z.infer<typeof FriendStateSchema>;

export const UserSummarySchema = z.object({
  id: z.uuid(),
  username: z.string(),
  name: z.string(),
  image: z.string().nullable(),
});
export type UserSummary = z.infer<typeof UserSummarySchema>;

export const UserSearchQuerySchema = z.object({
  q: z.string().trim().min(1),
  limit: z.coerce.number().int().positive().max(50).default(20),
});
export type UserSearchQuery = z.infer<typeof UserSearchQuerySchema>;

export const UserSearchResultSchema = UserSummarySchema.extend({
  friendState: FriendStateSchema,
});
export type UserSearchResult = z.infer<typeof UserSearchResultSchema>;

export const FriendSchema = UserSummarySchema.extend({
  since: z.iso.datetime(),
});
export type Friend = z.infer<typeof FriendSchema>;

export const FriendRequestSchema = UserSummarySchema.extend({
  requestedAt: z.iso.datetime(),
});
export type FriendRequest = z.infer<typeof FriendRequestSchema>;

export const FriendsOverviewSchema = z.object({
  friends: z.array(FriendSchema),
  incoming: z.array(FriendRequestSchema),
  outgoing: z.array(FriendRequestSchema),
});
export type FriendsOverview = z.infer<typeof FriendsOverviewSchema>;

export const SendFriendRequestBodySchema = z.object({ username: z.string().trim().min(1) });
export type SendFriendRequestBody = z.infer<typeof SendFriendRequestBodySchema>;

export const FriendshipStateSchema = z.object({
  user: UserSummarySchema,
  friendState: FriendStateSchema,
});
export type FriendshipState = z.infer<typeof FriendshipStateSchema>;

/** Per-sender cap on pending outgoing requests — the real anti-spam control. */
export const FRIEND_REQUEST_PENDING_MAX = 50;
