import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { PageFetcher } from '../src/http/fetch.js';
import { MalError, createMalClient } from '../src/mal/client.js';

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/mal/${name}`, import.meta.url), 'utf8');
}

function stubFetcher(routes: Record<string, { status?: number; body?: string }>): PageFetcher & {
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    async get(url: string) {
      calls.push(url);
      const route = routes[url];
      if (!route) throw new Error(`unexpected request: ${url}`);
      return { status: route.status ?? 200, body: route.body ?? '' };
    },
  };
}

const LIST = 'https://myanimelist.net/animelist/Kyoma__/load.json';
const MANGA = 'https://myanimelist.net/mangalist/Kyoma__/load.json';

async function failure(promise: Promise<unknown>): Promise<unknown> {
  return promise.catch((caught: unknown) => caught);
}

describe('createMalClient.fetchList', () => {
  it('reads a page and stops on the empty one after it', async () => {
    const fetcher = stubFetcher({
      [`${LIST}?status=7&offset=0`]: { body: fixture('anime-list.json') },
      [`${LIST}?status=7&offset=2`]: { body: '[]' },
    });
    const rows = await createMalClient({ fetcher }).fetchList('anime', 'Kyoma__');

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      kind: 'anime',
      externalId: '31646',
      title: '3-gatsu no Lion',
      status: 2,
      score: 8,
      progress: 22,
      repeating: true,
      notes: 'a quiet masterpiece',
      startedOn: '05-04-18',
      finishedOn: '17-04-18',
      releasedOn: '08-10-16',
    });
    expect(fetcher.calls).toEqual([`${LIST}?status=7&offset=0`, `${LIST}?status=7&offset=2`]);
  });

  it('advances the offset by the page size MAL returns, not by what it kept', async () => {
    const page = fixture('anime-list.json');
    const fetcher = stubFetcher({
      [`${LIST}?status=7&offset=0`]: { body: page },
      [`${LIST}?status=7&offset=2`]: { body: fixture('anime-list.json') },
    });
    const rows = await createMalClient({ fetcher, requestSpacingMs: 0 }).fetchList(
      'anime',
      'Kyoma__',
    );

    // Every row on the second page was already seen: that is the end, not a page
    // to ask for again.
    expect(rows).toHaveLength(2);
    expect(fetcher.calls).toHaveLength(2);
  });

  it('reads the manga namespace and its own fields', async () => {
    const fetcher = stubFetcher({
      [`${MANGA}?status=7&offset=0`]: { body: fixture('manga-list.json') },
      [`${MANGA}?status=7&offset=2`]: { body: '[]' },
    });
    const rows = await createMalClient({ fetcher }).fetchList('manga', 'Kyoma__');

    expect(rows.map((row) => row.externalId)).toEqual(['143991', '104']);
    expect(rows[1]).toMatchObject({ progress: 99, volumesRead: 9, releasedOn: '21-03-03' });
  });

  it('reports a refusing endpoint as no such user, naming both causes', async () => {
    const fetcher = stubFetcher({ [`${LIST}?status=7&offset=0`]: { status: 400 } });
    const error = await failure(createMalClient({ fetcher }).fetchList('anime', 'Kyoma__'));

    expect(error).toBeInstanceOf(MalError);
    expect(error).toMatchObject({ kind: 'not-found' });
    expect((error as Error).message).toMatch(/public/);
  });

  it('reports a 404 as no such user', async () => {
    const fetcher = stubFetcher({ [`${LIST}?status=7&offset=0`]: { status: 404 } });
    expect(await failure(createMalClient({ fetcher }).fetchList('anime', 'Kyoma__'))).toMatchObject(
      {
        kind: 'not-found',
      },
    );
  });

  it('reports a 403 as a private list, which an import cannot read', async () => {
    const fetcher = stubFetcher({ [`${LIST}?status=7&offset=0`]: { status: 403 } });
    expect(await failure(createMalClient({ fetcher }).fetchList('anime', 'Kyoma__'))).toMatchObject(
      {
        kind: 'private',
      },
    );
  });

  it('refuses a body that is not a list instead of importing half of it', async () => {
    const fetcher = stubFetcher({
      [`${LIST}?status=7&offset=0`]: { body: '<html><body>login</body></html>' },
    });
    const error = await failure(createMalClient({ fetcher }).fetchList('anime', 'Kyoma__'));
    expect(error).toMatchObject({ kind: 'malformed' });
    expect((error as Error).message).toMatch(/private|changed/);
  });

  it('refuses a row missing the id it joins on', async () => {
    const fetcher = stubFetcher({
      [`${LIST}?status=7&offset=0`]: {
        body: JSON.stringify([{ anime_title: 'no id', status: 1 }]),
      },
    });
    expect(await failure(createMalClient({ fetcher }).fetchList('anime', 'Kyoma__'))).toMatchObject(
      {
        kind: 'malformed',
      },
    );
  });

  it('refuses to loop past maxPages rather than truncating the list', async () => {
    const fetcher: PageFetcher = {
      async get(url) {
        const offset = Number(/offset=(\d+)/.exec(url)?.[1] ?? 0);
        return {
          status: 200,
          body: JSON.stringify([
            { anime_id: offset + 1, anime_title: `Work ${offset + 1}`, status: 1 },
          ]),
        };
      },
    };
    const error = await failure(
      createMalClient({ fetcher, maxPages: 2 }).fetchList('anime', 'Kyoma__'),
    );
    expect(error).toMatchObject({ kind: 'http' });
    expect((error as Error).message).toMatch(/refusing to loop/);
  });

  it('names a Cloudflare challenge rather than calling it a malformed list', async () => {
    const fetcher = stubFetcher({
      [`${LIST}?status=7&offset=0`]: {
        status: 403,
        body: '<html><head><title>Just a moment...</title></head></html>',
      },
    });
    const error = await failure(createMalClient({ fetcher }).fetchList('anime', 'Kyoma__'));
    expect((error as Error).message).toMatch(/IMPORT_FETCH_MODE/);
  });
});

describe('createMalClient.fetchFavorites', () => {
  it('reads the anime and manga sections, and not the characters below them', async () => {
    const fetcher = stubFetcher({
      'https://myanimelist.net/profile/Kyoma__/favorites': { body: fixture('favorites.html') },
    });
    const page = await createMalClient({ fetcher }).fetchFavorites('Kyoma__');

    expect(page.sections).toBe(2);
    expect(page.items).toEqual([
      { kind: 'anime', externalId: '1210', title: 'NHK ni Youkoso!', year: 2006 },
      {
        kind: 'anime',
        externalId: '5114',
        title: 'Fullmetal Alchemist: Brotherhood',
        year: 2009,
      },
      // The one entity that matters: `&amp;` in the printed title.
      { kind: 'manga', externalId: '104', title: 'Yotsuba&!', year: 2003 },
    ]);
  });

  it('says how many sections it found, so a layout change is not read as "no favourites"', async () => {
    const fetcher = stubFetcher({
      'https://myanimelist.net/profile/Kyoma__/favorites': { body: '<html></html>' },
    });
    expect((await createMalClient({ fetcher }).fetchFavorites('Kyoma__')).sections).toBe(0);
  });
});
