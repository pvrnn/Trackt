import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ListDetailSchema,
  ListSummarySchema,
  type CreateListBody,
  type ListDetail,
  type ListSummary,
  type UpdateListBody,
} from '@trackt/shared';
import { toError } from './http.js';
import { http, useIsAuthed } from './runtime.js';

/**
 * Lists data layer (PRD §3.4). Mutations invalidate rather than patch the cache:
 * positions, counts and cover fans are all server-derived, so re-reading is both
 * simpler and less likely to drift than mirroring the rules client-side.
 */

export const listsKey = ['lists'] as const;
export const listKey = (id: string) => ['list', id] as const;

/** List ids are UUIDs today, but every other data module encodes its path segments. */
const seg = encodeURIComponent;

async function request<T>(
  path: string,
  parse: (value: unknown) => T,
  init?: { method: 'POST' | 'PATCH' | 'DELETE'; json?: unknown },
): Promise<T> {
  const api = http();
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
  const isAuthed = useIsAuthed();
  return useQuery({
    queryKey: [...listsKey, containsMedia ?? null],
    enabled: isAuthed,
    queryFn: async () => {
      const search = containsMedia ? `?containsMedia=${encodeURIComponent(containsMedia)}` : '';
      return request(`lists${search}`, (value) => ListSummarySchema.array().parse(value));
    },
  });
}

/** One list. `data === null` is a real 404 — missing, or private to someone else. */
export function useList(id: string) {
  const isAuthed = useIsAuthed();
  return useQuery({
    queryKey: listKey(id),
    enabled: isAuthed,
    queryFn: async (): Promise<ListDetail | null> => {
      const response = await http().get(`lists/${seg(id)}`, { throwHttpErrors: false });
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
    request(`lists/${seg(id)}`, (v) => ListSummarySchema.parse(v), { method: 'PATCH', json: body }),
  remove: async (id: string) => {
    try {
      await http().delete(`lists/${seg(id)}`);
    } catch (error) {
      throw await toError(error, `DELETE lists/${seg(id)}`);
    }
  },
  addItem: (id: string, mediaId: string) =>
    request(`lists/${seg(id)}/items`, (v) => ListSummarySchema.parse(v), {
      method: 'POST',
      json: { mediaId },
    }),
  removeItem: (id: string, mediaId: string) =>
    request(`lists/${seg(id)}/items/${seg(mediaId)}`, (v) => ListSummarySchema.parse(v), {
      method: 'DELETE',
    }),
  moveItem: (id: string, mediaId: string, direction: 'up' | 'down') =>
    request(`lists/${seg(id)}/items/${seg(mediaId)}`, (v) => ListDetailSchema.parse(v), {
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
 * Relative "UPDATED …" label for a list card. Distinct from `home.ts`'s
 * compact activity stamps: cards read as sentences ("TODAY", "2D AGO"), not
 * feed ticks.
 */
/**
 * How a list card says when it changed. The words are supplied by the caller
 * (`UpdatedLabelCopy`) so web can pass translated copy; the English default
 * keeps mobile's behaviour identical.
 */
export interface UpdatedLabelCopy {
  justNow: string;
  today: string;
  yesterday: string;
  daysAgo: (days: number) => string;
  weeksAgo: (weeks: number) => string;
  monthsAgo: (months: number) => string;
}

const ENGLISH_UPDATED: UpdatedLabelCopy = {
  justNow: 'JUST NOW',
  today: 'TODAY',
  yesterday: 'YESTERDAY',
  daysAgo: (days) => `${days}D AGO`,
  weeksAgo: (weeks) => `${weeks}W AGO`,
  monthsAgo: (months) => `${months}MO AGO`,
};

export function updatedLabel(
  iso: string,
  now = Date.now(),
  copy: UpdatedLabelCopy = ENGLISH_UPDATED,
): string {
  const then = Date.parse(iso);
  const minutes = Math.max(0, Math.round((now - then) / 60_000));
  if (minutes < 60) return copy.justNow;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return copy.today;
  const days = Math.round(hours / 24);
  if (days === 1) return copy.yesterday;
  if (days < 7) return copy.daysAgo(days);
  const weeks = Math.round(days / 7);
  if (weeks < 5) return copy.weeksAgo(weeks);
  return copy.monthsAgo(Math.round(days / 30));
}

/** Visibility as the card meta row shows it. */
export function visibilityLabel(visibility: ListSummary['visibility']): string {
  return visibility.toUpperCase();
}
