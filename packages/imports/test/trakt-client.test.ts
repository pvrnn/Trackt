import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ImportError } from '../src/errors.js';
import type { FetchLike } from '../src/http/fetch.js';
import { createTraktClient } from '../src/trakt/client.js';
import type { TraktWatchedMovie, TraktWatchedShow } from '../src/trakt/schemas.js';

/**
 * The Trakt fixtures are hand-written from the endpoints' documented shapes
 * (they are not captures): there is no TRAKT_CLIENT_ID on this machine, so the
 * live API was never called while building this client.
 */
function fixture<T>(name: string): T {
  return JSON.parse(
    readFileSync(new URL(`./fixtures/trakt/${name}`, import.meta.url), 'utf8'),
  ) as T;
}

interface StubResponse {
  body: unknown;
  status?: number;
  headers?: Record<string, string>;
}

function stub(respond: (url: string) => StubResponse): {
  fetch: FetchLike;
  calls: { url: string; headers: Record<string, string> }[];
} {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, headers: init.headers });
    const { body, status = 200, headers } = respond(url);
    return { ok: status >= 200 && status < 300, status, json: async () => body, headers };
  };
  return { fetch, calls };
}

function page(url: string): number {
  return Number(new URL(url).searchParams.get('page'));
}

async function failure(run: () => Promise<unknown>): Promise<unknown> {
  return run().catch((caught: unknown) => caught);
}

describe('createTraktClient', () => {
  it('sends the client id and the API version on every request', async () => {
    const { fetch, calls } = stub(() => ({
      body: fixture<TraktWatchedMovie[]>('watched-movies.json'),
    }));
    const movies = await createTraktClient({
      clientId: 'test-client',
      fetch,
      requestSpacingMs: 0,
    }).fetchWatchedMovies('paul');

    expect(movies).toHaveLength(3);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toContain('https://api.trakt.tv/users/paul/watched/movies');
    expect(calls[0]?.url).toContain('extended=full');
    expect(calls[0]?.headers).toMatchObject({
      'trakt-api-key': 'test-client',
      'trakt-api-version': '2',
      'content-type': 'application/json',
    });
    expect(calls[0]?.headers['user-agent']).toMatch(/Mozilla/);
  });

  it('follows the page count the response headers state', async () => {
    const movies = fixture<TraktWatchedMovie[]>('watched-movies.json');
    const { fetch, calls } = stub((url) => ({
      body: page(url) === 1 ? movies.slice(0, 2) : movies.slice(2),
      headers: { 'x-pagination-page-count': '2', 'x-pagination-limit': '2' },
    }));

    const rows = await createTraktClient({
      clientId: 'test-client',
      fetch,
      requestSpacingMs: 0,
      pageSize: 2,
    }).fetchWatchedMovies('paul');

    expect(calls.map((call) => page(call.url))).toEqual([1, 2]);
    expect(rows).toHaveLength(3);
  });

  it('falls back to "a short page ends the list" without the header', async () => {
    const movies = fixture<TraktWatchedMovie[]>('watched-movies.json');
    const { fetch, calls } = stub(() => ({ body: movies.slice(0, 1) }));

    const rows = await createTraktClient({
      clientId: 'test-client',
      fetch,
      requestSpacingMs: 0,
      pageSize: 2,
    }).fetchWatchedMovies('paul');

    expect(calls).toHaveLength(1);
    expect(rows).toHaveLength(1);
  });

  it('keeps paging when a header-less page is full, and stops on the short one', async () => {
    const movies = fixture<TraktWatchedMovie[]>('watched-movies.json');
    const { fetch, calls } = stub((url) => ({
      // Two full pages, then a short one: no header anywhere.
      body: page(url) === 1 ? movies.slice(0, 2) : movies.slice(2, 3),
    }));

    const rows = await createTraktClient({
      clientId: 'test-client',
      fetch,
      requestSpacingMs: 0,
      pageSize: 2,
    }).fetchWatchedMovies('paul');

    expect(calls).toHaveLength(2);
    expect(rows).toHaveLength(3);
  });

  it('reads the per-season progress of one show', async () => {
    const { fetch, calls } = stub(() => ({ body: fixture('show-progress.json') }));
    const progress = await createTraktClient({
      clientId: 'test-client',
      fetch,
      requestSpacingMs: 0,
    }).fetchShowProgress('paul', 1388);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toContain('/users/paul/shows/1388/progress/watched');
    expect(calls[0]?.url).toContain('specials=false');
    expect(progress.seasons?.[1]).toMatchObject({ number: 2, aired: 3, completed: 3 });
  });

  it('reads the watched shows with their seasons', async () => {
    const { fetch } = stub(() => ({ body: fixture<TraktWatchedShow[]>('watched-shows.json') }));
    const shows = await createTraktClient({
      clientId: 'test-client',
      fetch,
      requestSpacingMs: 0,
    }).fetchWatchedShows('paul');

    expect(shows).toHaveLength(2);
    expect(shows[0]?.seasons?.[0]?.episodes?.map((episode) => episode.number)).toEqual([1, 2, 5]);
  });

  it('reports a 404 as no such user', async () => {
    const { fetch } = stub(() => ({ body: { error: 'not found' }, status: 404 }));
    const error = await failure(() =>
      createTraktClient({ clientId: 'test-client', fetch }).fetchWatchedMovies('nobody'),
    );
    expect(error).toBeInstanceOf(ImportError);
    expect(error).toMatchObject({ kind: 'not-found', status: 404 });
    expect((error as Error).message).toContain('nobody');
  });

  it('reports a rejected client id as auth, naming the variable to fix', async () => {
    const { fetch } = stub(() => ({ body: {}, status: 403 }));
    const error = await failure(() =>
      createTraktClient({ clientId: 'wrong', fetch }).fetchWatchlistMovies('paul'),
    );
    expect(error).toMatchObject({ kind: 'auth', status: 403 });
    expect((error as Error).message).toContain('TRAKT_CLIENT_ID');
  });

  it('names the Retry-After a 429 states', async () => {
    const { fetch } = stub(() => ({ body: {}, status: 429, headers: { 'retry-after': '12' } }));
    const error = await failure(() =>
      createTraktClient({ clientId: 'test-client', fetch }).fetchRatedMovies('paul'),
    );
    expect(error).toMatchObject({ kind: 'http', status: 429 });
    expect((error as Error).message).toContain('12s');
  });

  it('refuses to run without a client id, and says where to get one', async () => {
    const error = await failure(async () => createTraktClient({ clientId: '' }));
    expect(error).toBeInstanceOf(ImportError);
    expect(error).toMatchObject({ kind: 'credential' });
    expect((error as Error).message).toContain('TRAKT_CLIENT_ID');
    expect((error as Error).message).toContain('trakt.tv/oauth/applications');
  });

  it('refuses a body it cannot parse instead of importing half of it', async () => {
    const { fetch } = stub(() => ({ body: { not: 'an array' } }));
    const error = await failure(() =>
      createTraktClient({ clientId: 'test-client', fetch }).fetchWatchedMovies('paul'),
    );
    expect(error).toMatchObject({ kind: 'malformed' });
  });

  it('refuses to loop past maxPages', async () => {
    const { fetch } = stub(() => ({
      body: fixture<TraktWatchedMovie[]>('watched-movies.json').slice(0, 2),
    }));
    const error = await failure(() =>
      createTraktClient({
        clientId: 'test-client',
        fetch,
        requestSpacingMs: 0,
        pageSize: 2,
        maxPages: 3,
      }).fetchWatchedMovies('paul'),
    );
    expect(error).toMatchObject({ kind: 'malformed' });
    expect((error as Error).message).toContain('3 pages');
  });
});
