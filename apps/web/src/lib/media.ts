import { MediaDetailSchema, type LogStatus, type MediaDetail } from '@trackt/shared';
import { api, toError } from './http';

/**
 * Fetch helpers for the media detail page. Mutations return nothing — the page
 * applies optimistic state and re-syncs from `fetchMediaDetail` on error.
 */

export async function fetchMediaDetail(idOrSlug: string): Promise<MediaDetail | null> {
  const response = await api.get(`media/${encodeURIComponent(idOrSlug)}`, {
    throwHttpErrors: false,
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`media responded ${response.status}`);
  return MediaDetailSchema.parse(await response.json());
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
