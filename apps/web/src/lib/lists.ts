import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ListDetailSchema,
  ListSummarySchema,
  type CreateListBody,
  type ListDetail,
  type ListSummary,
  type UpdateListBody,
} from '@trackt/shared';
import { authClient } from './auth-client';
import { api, toError } from './http';

/**
 * Lists data layer (PRD §3.4). Mutations invalidate rather than patch the cache:
 * positions, counts and cover fans are all server-derived, so re-reading is both
 * simpler and less likely to drift than mirroring the rules client-side.
 */

export const listsKey = ['lists'] as const;
export const listKey = (id: string) => ['list', id] as const;

async function request<T>(
  path: string,
  parse: (value: unknown) => T,
  init?: { method: 'POST' | 'PATCH' | 'DELETE'; json?: unknown },
): Promise<T> {
  try {
    const response = await api(path, {
      ...(init ? { method: init.method } : {}),
      ...(init?.json !== undefined ? { json: init.json } : {}),
    });
    return parse(await response.json());
  } catch (error) {
    throw await toError(error, `${init?.method ?? 'GET'} ${path}`);
  }
}

/** The viewer's own lists. `containsMedia` marks which already hold a title. */
export function useLists(containsMedia?: string) {
  const { data: session } = authClient.useSession();
  return useQuery({
    queryKey: [...listsKey, containsMedia ?? null],
    enabled: !!session,
    queryFn: async () => {
      const search = containsMedia ? `?containsMedia=${encodeURIComponent(containsMedia)}` : '';
      return request(`lists${search}`, (value) => ListSummarySchema.array().parse(value));
    },
  });
}

/** One list. `data === null` is a real 404 — missing, or private to someone else. */
export function useList(id: string) {
  const { data: session } = authClient.useSession();
  return useQuery({
    queryKey: listKey(id),
    enabled: !!session,
    queryFn: async (): Promise<ListDetail | null> => {
      const response = await api.get(`lists/${id}`, { throwHttpErrors: false });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`list responded ${response.status}`);
      return ListDetailSchema.parse(await response.json());
    },
  });
}

export const listsApi = {
  create: (body: CreateListBody) =>
    request('lists', (v) => ListSummarySchema.parse(v), { method: 'POST', json: body }),
  update: (id: string, body: UpdateListBody) =>
    request(`lists/${id}`, (v) => ListSummarySchema.parse(v), { method: 'PATCH', json: body }),
  remove: async (id: string) => {
    try {
      await api(`lists/${id}`, { method: 'DELETE' });
    } catch (error) {
      throw await toError(error, `DELETE lists/${id}`);
    }
  },
  addItem: (id: string, mediaId: string) =>
    request(`lists/${id}/items`, (v) => ListSummarySchema.parse(v), {
      method: 'POST',
      json: { mediaId },
    }),
  removeItem: (id: string, mediaId: string) =>
    request(`lists/${id}/items/${mediaId}`, (v) => ListSummarySchema.parse(v), {
      method: 'DELETE',
    }),
  moveItem: (id: string, mediaId: string, direction: 'up' | 'down') =>
    request(`lists/${id}/items/${mediaId}`, (v) => ListDetailSchema.parse(v), {
      method: 'PATCH',
      json: { direction },
    }),
};

/** Invalidate every list query — the index counts change whenever a list does. */
export function useListsInvalidator() {
  const queryClient = useQueryClient();
  return (id?: string) => {
    void queryClient.invalidateQueries({ queryKey: listsKey });
    if (id) void queryClient.invalidateQueries({ queryKey: listKey(id) });
  };
}

/** Create a list, then refresh the index. */
export function useCreateList() {
  const invalidate = useListsInvalidator();
  return useMutation({
    mutationFn: (body: CreateListBody) => listsApi.create(body),
    onSuccess: () => invalidate(),
  });
}

/**
 * Relative "UPDATED …" label for a list card. Distinct from lib/home.ts's
 * compact activity stamps: cards read as sentences ("TODAY", "2D AGO"), not
 * feed ticks.
 */
export function updatedLabel(iso: string, now = Date.now()): string {
  const then = Date.parse(iso);
  const minutes = Math.max(0, Math.round((now - then) / 60_000));
  if (minutes < 60) return 'JUST NOW';
  const hours = Math.round(minutes / 60);
  if (hours < 24) return 'TODAY';
  const days = Math.round(hours / 24);
  if (days === 1) return 'YESTERDAY';
  if (days < 7) return `${days}D AGO`;
  const weeks = Math.round(days / 7);
  if (weeks < 5) return `${weeks}W AGO`;
  return `${Math.round(days / 30)}MO AGO`;
}

/** Visibility as the card meta row shows it. */
export function visibilityLabel(visibility: ListSummary['visibility']): string {
  return visibility.toUpperCase();
}
