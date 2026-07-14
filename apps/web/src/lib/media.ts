import { useQuery } from '@tanstack/react-query';
import { MediaDetailSchema, type LogStatus, type MediaDetail } from '@trackt/shared';
import { authClient } from './auth-client';
import { api, toError } from './http';

/**
 * Fetch helpers for the media detail page. Mutations return nothing — the page
 * applies optimistic cache updates and re-syncs by invalidating the query.
 */

export async function fetchMediaDetail(idOrSlug: string): Promise<MediaDetail | null> {
  const response = await api.get(`media/${encodeURIComponent(idOrSlug)}`, {
    throwHttpErrors: false,
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`media responded ${response.status}`);
  return MediaDetailSchema.parse(await response.json());
}

/**
 * Media detail query — gated on session. `data === null` means a real 404
 * (the page shows "Not found"); a thrown error surfaces as `isError`.
 */
export function useMediaDetail(slug: string) {
  const { data: session } = authClient.useSession();
  return useQuery({
    queryKey: ['media', slug],
    queryFn: () => fetchMediaDetail(slug),
    enabled: !!session,
  });
}

async function mutate(path: string, method: 'PUT' | 'DELETE', body?: unknown): Promise<void> {
  try {
    await api(path, { method, ...(body !== undefined ? { json: body } : {}) });
  } catch (error) {
    throw await toError(error, `${method} ${path}`);
  }
}

export const trackingApi = {
  setStatus: (id: string, status: LogStatus) => mutate(`media/${id}/log`, 'PUT', { status }),
  clearStatus: (id: string) => mutate(`media/${id}/log`, 'DELETE'),
  setScore: (id: string, score: number) => mutate(`media/${id}/rating`, 'PUT', { score }),
  clearScore: (id: string) => mutate(`media/${id}/rating`, 'DELETE'),
  checkIn: (id: string, number: number) => mutate(`media/${id}/progress/${number}`, 'PUT'),
  uncheck: (id: string, number: number) => mutate(`media/${id}/progress/${number}`, 'DELETE'),
  favorite: (id: string) => mutate(`media/${id}/favorite`, 'PUT'),
  unfavorite: (id: string) => mutate(`media/${id}/favorite`, 'DELETE'),
};
