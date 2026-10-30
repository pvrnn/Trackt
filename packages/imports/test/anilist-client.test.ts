import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createAniListClient } from '../src/anilist/client.js';
import { ImportError } from '../src/errors.js';
import type { FetchLike } from '../src/http/fetch.js';

function fixture(name: string): unknown {
  return JSON.parse(
    readFileSync(new URL(`./fixtures/anilist/${name}`, import.meta.url), 'utf8'),
  ) as unknown;
}

interface StubCall {
  url: string;
  method?: string;
  headers: Record<string, string>;
  body?: string;
}

function stub(body: unknown, status = 200): { fetch: FetchLike; calls: StubCall[] } {
  const calls: StubCall[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, ...init });
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  return { fetch, calls };
}

async function failure(promise: Promise<unknown>): Promise<unknown> {
  return promise.catch((caught: unknown) => caught);
}

describe('createAniListClient', () => {
  it('posts one GraphQL query per media type and flattens every list', async () => {
    const { fetch, calls } = stub(fixture('media-list-anime.json'));
    const entries = await createAniListClient({ fetch }).fetchList('anime', 'taluun');

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://graphql.anilist.co');
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.headers['content-type']).toBe('application/json');
    expect(calls[0]?.headers['user-agent']).toMatch(/Mozilla/);
    const body = JSON.parse(calls[0]?.body ?? '{}') as {
      query: string;
      variables: { userName: string; type: string };
    };
    expect(body.variables).toEqual({ userName: 'taluun', type: 'ANIME' });
    expect(body.query).toContain('MediaListCollection');
    expect(body.query).toContain('startedAt');

    // 10 of the fixture's entries live across six lists.
    expect(entries).toHaveLength(10);
    expect(entries.map((entry) => entry.status)).toEqual(
      expect.arrayContaining([
        'COMPLETED',
        'CURRENT',
        'PLANNING',
        'DROPPED',
        'PAUSED',
        'REPEATING',
      ]),
    );
  });

  it('asks for the manga list of a manga import', async () => {
    const { fetch, calls } = stub(fixture('media-list-manga.json'));
    const entries = await createAniListClient({ fetch }).fetchList('manga', 'taluun');
    const body = JSON.parse(calls[0]?.body ?? '{}') as { variables: { type: string } };
    expect(body.variables.type).toBe('MANGA');
    expect(entries).toHaveLength(7);
  });

  it('reports a private list as private, not as a missing user', async () => {
    const { fetch } = stub(fixture('private-user.json'), 404);
    const error = await failure(createAniListClient({ fetch }).fetchList('anime', 'Luffy'));
    expect(error).toBeInstanceOf(ImportError);
    expect(error).toMatchObject({ kind: 'private' });
    expect((error as Error).message).toContain('private');
  });

  it('reports an unknown user as not-found', async () => {
    const { fetch } = stub(fixture('user-not-found.json'), 404);
    const error = await failure(createAniListClient({ fetch }).fetchList('anime', 'nobody'));
    expect(error).toMatchObject({ kind: 'not-found' });
  });

  it('treats a GraphQL error on a 200 as a failure', async () => {
    const { fetch } = stub({ data: null, errors: [{ message: 'Too Many Requests.' }] }, 200);
    const error = await failure(createAniListClient({ fetch }).fetchList('anime', 'taluun'));
    expect(error).toBeInstanceOf(ImportError);
    expect(error).toMatchObject({ kind: 'http' });
    expect((error as Error).message).toMatch(/rate-limit/);
  });

  it('refuses a response it cannot parse instead of importing half of it', async () => {
    const { fetch } = stub({ data: { MediaListCollection: { lists: [{ entries: [{}] }] } } });
    const error = await failure(createAniListClient({ fetch }).fetchList('anime', 'taluun'));
    expect(error).toMatchObject({ kind: 'malformed' });
  });

  it('refuses a body that is not a MediaListCollection', async () => {
    const { fetch } = stub({ data: { MediaListCollection: null } });
    const error = await failure(createAniListClient({ fetch }).fetchList('anime', 'taluun'));
    expect(error).toMatchObject({ kind: 'malformed' });
  });

  it('reports an HTML error page as http, not as a malformed list', async () => {
    const fetch: FetchLike = async () => ({
      ok: false,
      status: 503,
      json: async () => {
        throw new SyntaxError('Unexpected token <');
      },
    });
    const error = await failure(createAniListClient({ fetch }).fetchList('anime', 'taluun'));
    expect(error).toMatchObject({ kind: 'http', status: 503 });
  });
});
