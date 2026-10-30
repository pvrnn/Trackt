import { MalListResponseSchema, type MalListEntry } from './schemas.js';
import type { ImportKind } from '../types.js';

/** The slice of `fetch` this client uses, so a test can pass a stub. */
export type FetchLike = (
  url: string,
  init: { headers: Record<string, string> },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export type MalErrorKind = 'auth' | 'not-found' | 'http' | 'malformed';

export class MalApiError extends Error {
  constructor(
    message: string,
    readonly kind: MalErrorKind,
    readonly status: number | null,
  ) {
    super(message);
    this.name = 'MalApiError';
  }
}

export interface MalClientOptions {
  /**
   * The API client id from https://myanimelist.net/apiconfig. Sent as
   * `X-MAL-CLIENT-ID`, which the user-list endpoints accept in place of an OAuth
   * token — so a *public* list needs no user authorisation at all.
   */
  clientId: string;
  fetch?: FetchLike;
  baseUrl?: string;
  /** MAL caps the user-list endpoints at 1000. */
  pageSize?: number;
  /** MAL allows 3 requests/second; two lists are two requests, but keep it polite. */
  requestSpacingMs?: number;
  /** A far-future loop guard: someone with 40k entries still finishes, a bad cursor does not. */
  maxPages?: number;
}

export interface MalClient {
  /** Every entry of one public list, following `paging.next`. */
  fetchList(kind: ImportKind, username: string): Promise<MalListEntry[]>;
}

const DEFAULT_BASE_URL = 'https://api.myanimelist.net/v2';

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

function errorForStatus(status: number, username: string): MalApiError {
  if (status === 404) {
    return new MalApiError(`MyAnimeList has no user "${username}"`, 'not-found', status);
  }
  // MAL answers 403 for a missing/blocked client id and 401 for an expired token;
  // both are "this import cannot run until someone fixes credentials".
  if (status === 401 || status === 403) {
    return new MalApiError(
      status === 403
        ? 'MyAnimeList rejected the request (403) — check MAL_CLIENT_ID, and that the list is public'
        : 'MyAnimeList rejected the credentials (401)',
      'auth',
      status,
    );
  }
  return new MalApiError(
    status === 400
      ? // MAL answers 400 rather than 403 for a client id it cannot validate.
        'MyAnimeList answered 400 — check MAL_CLIENT_ID, and that the profile name is spelled as it appears on the site'
      : `MyAnimeList answered ${status}`,
    'http',
    status,
  );
}

export function createMalClient(options: MalClientOptions): MalClient {
  const {
    clientId,
    fetch = globalThis.fetch as unknown as FetchLike,
    baseUrl = DEFAULT_BASE_URL,
    pageSize = 1000,
    requestSpacingMs = 400,
    maxPages = 40,
  } = options;

  if (!clientId) throw new Error('a MyAnimeList client id is required (MAL_CLIENT_ID)');

  async function fetchList(kind: ImportKind, username: string): Promise<MalListEntry[]> {
    const list = kind === 'anime' ? 'animelist' : 'mangalist';
    const entries: MalListEntry[] = [];

    for (let page = 0; page < maxPages; page++) {
      if (page > 0) await sleep(requestSpacingMs);
      const offset = entries.length;
      const url =
        `${baseUrl}/users/${encodeURIComponent(username)}/${list}` +
        `?fields=list_status&nsfw=true&limit=${pageSize}&offset=${offset}`;

      let response: Awaited<ReturnType<FetchLike>>;
      try {
        response = await fetch(url, { headers: { 'X-MAL-CLIENT-ID': clientId } });
      } catch (error) {
        throw new MalApiError(
          `could not reach MyAnimeList: ${error instanceof Error ? error.message : String(error)}`,
          'http',
          null,
        );
      }
      if (!response.ok) throw errorForStatus(response.status, username);

      const parsed = MalListResponseSchema.safeParse(await response.json());
      if (!parsed.success) {
        throw new MalApiError(
          `unexpected MyAnimeList response: ${parsed.error.issues[0]?.message ?? 'invalid shape'}`,
          'malformed',
          response.status,
        );
      }

      entries.push(...parsed.data.data);
      const next = parsed.data.paging?.next;
      if (!next || parsed.data.data.length < pageSize) return entries;
    }

    throw new MalApiError(
      `MyAnimeList kept paging past ${maxPages} pages — refusing to loop`,
      'malformed',
      null,
    );
  }

  return { fetchList };
}
