import type { ZodType } from 'zod';
import { ImportError } from '../errors.js';
import { BROWSER_USER_AGENT, type FetchLike } from '../http/fetch.js';
import { IMPORT_SOURCES } from '../sources.js';
import {
  TraktRatingSchema,
  TraktShowProgressSchema,
  TraktWatchedMovieSchema,
  TraktWatchedShowSchema,
  TraktWatchlistItemSchema,
  type TraktRating,
  type TraktShowProgress,
  type TraktWatchedMovie,
  type TraktWatchedShow,
  type TraktWatchlistItem,
} from './schemas.js';

/**
 * Trakt's public API: a client id (no OAuth) is enough to read any public
 * profile, and every list is paged 100 rows at a time. Trakt's own paging lives
 * in response headers, not in the body, which is why `FetchLike` can hand them
 * over — without them the only end-of-list signal is a short page.
 */

const DEFAULT_BASE_URL = 'https://api.trakt.tv';
const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_MAX_PAGES = 200;
/** Trakt allows a thousand calls per five minutes; a third of a second is polite. */
const DEFAULT_SPACING_MS = 300;

export interface TraktClientOptions {
  /**
   * The Client ID of an app at https://trakt.tv/oauth/applications. Sent as
   * `trakt-api-key`; a public profile needs nothing beyond it.
   */
  clientId: string;
  fetch?: FetchLike;
  baseUrl?: string;
  requestSpacingMs?: number;
  /** A runaway-loop guard: a bad page-count header must not page forever. */
  maxPages?: number;
  pageSize?: number;
}

export interface TraktClient {
  fetchWatchedMovies(user: string): Promise<TraktWatchedMovie[]>;
  fetchWatchedShows(user: string): Promise<TraktWatchedShow[]>;
  /** Per-season completion for one show — the only place Trakt states it. */
  fetchShowProgress(user: string, traktId: number): Promise<TraktShowProgress>;
  fetchRatedMovies(user: string): Promise<TraktRating[]>;
  fetchRatedShows(user: string): Promise<TraktRating[]>;
  fetchWatchlistMovies(user: string): Promise<TraktWatchlistItem[]>;
  fetchWatchlistShows(user: string): Promise<TraktWatchlistItem[]>;
}

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

function header(headers: Record<string, string>, name: string): string | null {
  const key = name.toLowerCase();
  for (const [candidate, value] of Object.entries(headers)) {
    if (candidate.toLowerCase() === key) return value;
  }
  return null;
}

/**
 * `fetch` as `FetchLike`, except the headers come along: Trakt's page count is
 * there, and a raw `Response` does not answer `headers['x-…']`.
 */
function defaultFetch(): FetchLike {
  return async (url, init) => {
    const response = await globalThis.fetch(url, init);
    return {
      ok: response.ok,
      status: response.status,
      json: () => response.json(),
      headers: Object.fromEntries(response.headers),
    };
  };
}

function missingCredential(): ImportError {
  const hint = IMPORT_SOURCES.trakt.credential?.hint ?? 'export a Trakt API app Client ID';
  return new ImportError(
    `a Trakt client id is required (TRAKT_CLIENT_ID) — ${hint}`,
    'credential',
    null,
  );
}

function errorForStatus(
  status: number,
  user: string,
  what: string,
  headers: Record<string, string>,
): ImportError {
  if (status === 404) {
    return new ImportError(`Trakt has no user "${user}" (${what})`, 'not-found', status);
  }
  // 401 is a client id Trakt does not know; 403 is one it will not accept for
  // this profile. Neither is fixed by retrying.
  if (status === 401 || status === 403) {
    return new ImportError(
      `Trakt rejected the credentials (${status}) — check TRAKT_CLIENT_ID is the Client ID of an ` +
        'API app at https://trakt.tv/oauth/applications',
      'auth',
      status,
    );
  }
  if (status === 420) {
    return new ImportError(
      'Trakt is at this account’s API limit (420) — the import was stopped, retry later',
      'http',
      status,
    );
  }
  if (status === 429) {
    const retryAfter = header(headers, 'retry-after');
    return new ImportError(
      `Trakt is rate-limiting this instance (429)${retryAfter ? ` — retry after ${retryAfter}s` : ' — retry later'}`,
      'http',
      status,
    );
  }
  return new ImportError(`Trakt answered ${status} for ${what}`, 'http', status);
}

export function createTraktClient(options: TraktClientOptions): TraktClient {
  const {
    clientId,
    fetch = defaultFetch(),
    baseUrl = DEFAULT_BASE_URL,
    requestSpacingMs = DEFAULT_SPACING_MS,
    maxPages = DEFAULT_MAX_PAGES,
    pageSize = DEFAULT_PAGE_SIZE,
  } = options;

  if (!clientId) throw missingCredential();

  let lastRequestAt = 0;

  async function request(
    path: string,
    user: string,
    what: string,
  ): Promise<{ body: unknown; headers: Record<string, string> }> {
    if (lastRequestAt > 0) await sleep(requestSpacingMs - (Date.now() - lastRequestAt));
    lastRequestAt = Date.now();

    let response: Awaited<ReturnType<FetchLike>>;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        headers: {
          'content-type': 'application/json',
          'trakt-api-version': '2',
          'trakt-api-key': clientId,
          'user-agent': BROWSER_USER_AGENT,
        },
      });
    } catch (error) {
      throw new ImportError(
        `could not reach Trakt: ${error instanceof Error ? error.message : String(error)}`,
        'http',
        null,
      );
    }

    const headers = response.headers ?? {};
    if (!response.ok) throw errorForStatus(response.status, user, what, headers);

    try {
      return { body: await response.json(), headers };
    } catch {
      throw new ImportError(
        `unexpected Trakt response for ${what}: the body is not JSON`,
        'malformed',
        response.status,
      );
    }
  }

  async function pages<T>(
    user: string,
    what: string,
    path: (page: number) => string,
    schema: ZodType<T[]>,
  ): Promise<T[]> {
    const rows: T[] = [];
    for (let page = 1; page <= maxPages; page++) {
      const response = await request(path(page), user, what);

      const parsed = schema.safeParse(response.body);
      if (!parsed.success) {
        throw new ImportError(
          `unexpected Trakt response for ${what}: ${parsed.error.issues[0]?.message ?? 'invalid shape'}`,
          'malformed',
          200,
        );
      }
      rows.push(...parsed.data);

      // The page count is authoritative when present; a body-only response (or
      // a proxy that strips headers) leaves "a short page ends the list".
      const pageCount = Number(header(response.headers, 'x-pagination-page-count'));
      if (Number.isFinite(pageCount) && pageCount > 0) {
        if (page >= pageCount) return rows;
        continue;
      }
      if (parsed.data.length < pageSize) return rows;
    }

    throw new ImportError(
      `Trakt kept paging past ${maxPages} pages — refusing to loop instead of truncating`,
      'malformed',
      null,
    );
  }

  function listPath(user: string, segment: string) {
    return (page: number) =>
      `/users/${encodeURIComponent(user)}/${segment}?extended=full&limit=${pageSize}&page=${page}`;
  }

  return {
    fetchWatchedMovies: (user) =>
      pages(
        user,
        'watched movies',
        listPath(user, 'watched/movies'),
        TraktWatchedMovieSchema.array(),
      ),
    fetchWatchedShows: (user) =>
      pages(user, 'watched shows', listPath(user, 'watched/shows'), TraktWatchedShowSchema.array()),
    fetchRatedMovies: (user) =>
      pages(user, 'movie ratings', listPath(user, 'ratings/movies'), TraktRatingSchema.array()),
    fetchRatedShows: (user) =>
      pages(user, 'show ratings', listPath(user, 'ratings/shows'), TraktRatingSchema.array()),
    fetchWatchlistMovies: (user) =>
      pages(
        user,
        'movie watchlist',
        listPath(user, 'watchlist/movies'),
        TraktWatchlistItemSchema.array(),
      ),
    fetchWatchlistShows: (user) =>
      pages(
        user,
        'show watchlist',
        listPath(user, 'watchlist/shows'),
        TraktWatchlistItemSchema.array(),
      ),

    async fetchShowProgress(user, traktId) {
      const { body } = await request(
        `/users/${encodeURIComponent(user)}/shows/${traktId}/progress/watched?hidden=false&specials=false`,
        user,
        `progress of show ${traktId}`,
      );
      const parsed = TraktShowProgressSchema.safeParse(body);
      if (!parsed.success) {
        throw new ImportError(
          `unexpected Trakt progress response for show ${traktId}: ${parsed.error.issues[0]?.message ?? 'invalid shape'}`,
          'malformed',
          200,
        );
      }
      return parsed.data;
    },
  };
}
