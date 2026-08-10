import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  FriendsOverviewSchema,
  PublicProfileSchema,
  UserSearchResultSchema,
  type FriendsOverview,
  type PublicProfile,
  type UserSearchResult,
} from '@trackt/shared';
import { authClient } from './auth-client';
import { api, toError } from './http';

/**
 * Mutual friends data layer (ADR-0006). Mirrors `lib/lists.ts`: mutations
 * invalidate rather than patch the cache, since `friendState` is derived
 * server-side from whichever side of the pair the viewer is on.
 */

export const friendsKey = ['friends'] as const;

/** The viewer's own friends/incoming/outgoing — session-gated. */
export function useFriends() {
  const { data: session } = authClient.useSession();
  return useQuery({
    queryKey: friendsKey,
    enabled: !!session,
    queryFn: async (): Promise<FriendsOverview> => {
      try {
        return FriendsOverviewSchema.parse(await api.get('me/friends').json());
      } catch (error) {
        throw await toError(error, 'friends overview');
      }
    },
  });
}

/**
 * Handle/name search for sending a request. `enabled: q.length >= 2` and
 * `keepPreviousData` follow `lib/search.ts`'s contract — debounce lives in
 * the component, not here.
 */
export function useUserSearch(q: string) {
  const trimmed = q.trim();
  return useQuery({
    queryKey: ['user-search', trimmed],
    enabled: trimmed.length >= 2,
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }): Promise<UserSearchResult[]> => {
      try {
        const json = await api.get('users/search', { searchParams: { q: trimmed }, signal }).json();
        return UserSearchResultSchema.array().parse(json);
      } catch (error) {
        throw await toError(error, 'user search');
      }
    },
  });
}

export const publicProfileKey = (username: string) => ['public-profile', username] as const;

/**
 * Someone else's profile (`GET /v1/users/:username/profile`). Deliberately
 * ungated by session — the endpoint is anonymous-readable (ADR-0006 point 3),
 * so a signed-out visitor gets the same body with `friendState: 'none'`.
 * 404 comes back as `null` (the `useList` idiom) so an unknown handle renders
 * "no such user" instead of an error banner.
 */
export function usePublicProfile(username: string) {
  return useQuery({
    queryKey: publicProfileKey(username),
    queryFn: async (): Promise<PublicProfile | null> => {
      const response = await api.get(`users/${encodeURIComponent(username)}/profile`, {
        throwHttpErrors: false,
      });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`public profile responded ${response.status}`);
      return PublicProfileSchema.parse(await response.json());
    },
  });
}

export const friendsApi = {
  sendRequest: async (username: string) => {
    try {
      await api.post('me/friends/requests', { json: { username } });
    } catch (error) {
      throw await toError(error, 'send friend request');
    }
  },
  accept: async (userId: string) => {
    try {
      await api.post(`me/friends/requests/${userId}/accept`);
    } catch (error) {
      throw await toError(error, 'accept friend request');
    }
  },
  remove: async (userId: string) => {
    try {
      await api.delete(`me/friends/${userId}`);
    } catch (error) {
      throw await toError(error, 'remove friend');
    }
  },
};

/** Friend mutations touch three surfaces: the friends list, both profile summaries. */
export function useFriendsInvalidator() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: friendsKey });
    void queryClient.invalidateQueries({ queryKey: ['profile'] });
    void queryClient.invalidateQueries({ queryKey: ['public-profile'] });
  };
}

export function useSendFriendRequest() {
  const invalidate = useFriendsInvalidator();
  return useMutation({
    mutationFn: (username: string) => friendsApi.sendRequest(username),
    onSuccess: () => invalidate(),
  });
}

export function useAcceptFriendRequest() {
  const invalidate = useFriendsInvalidator();
  return useMutation({
    mutationFn: (userId: string) => friendsApi.accept(userId),
    onSuccess: () => invalidate(),
  });
}

export function useRemoveFriend() {
  const invalidate = useFriendsInvalidator();
  return useMutation({
    mutationFn: (userId: string) => friendsApi.remove(userId),
    onSuccess: () => invalidate(),
  });
}
