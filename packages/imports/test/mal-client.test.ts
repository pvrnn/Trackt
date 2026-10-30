import { describe, expect, it } from 'vitest';
import { createMalClient, MalApiError, type FetchLike } from '../src/mal/client.js';

function entry(id: number) {
  return {
    node: { id, title: `Work ${id}` },
    list_status: { status: 'watching', num_episodes_watched: 1 },
  };
}

function stub(pages: unknown[], statuses: number[] = []): { fetch: FetchLike; urls: string[] } {
  const urls: string[] = [];
  let call = 0;
  const fetch: FetchLike = async (url) => {
    urls.push(url);
    const index = call++;
    const status = statuses[index] ?? 200;
    const body = pages[index];
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    };
  };
  return { fetch, urls };
}

const client = (fetch: FetchLike, pageSize = 2) =>
  createMalClient({ clientId: 'client-id', fetch, pageSize, requestSpacingMs: 0 });

describe('createMalClient', () => {
  it('reads one page and stops when the provider has less than a page', async () => {
    const { fetch, urls } = stub([{ data: [entry(1)], paging: {} }]);
    const rows = await client(fetch).fetchList('anime', 'Kyoma__');
    expect(rows).toHaveLength(1);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain('/users/Kyoma__/animelist');
    expect(urls[0]).toContain('fields=list_status');
    expect(urls[0]).toContain('nsfw=true');
  });

  it('follows paging.next and passes the offset without repeating rows', async () => {
    const { fetch, urls } = stub([
      { data: [entry(1), entry(2)], paging: { next: 'https://api.myanimelist.net/v2/…offset=2' } },
      { data: [entry(3)], paging: {} },
    ]);
    const rows = await client(fetch).fetchList('anime', 'Kyoma__');
    expect(rows.map((row) => row.node.id)).toEqual([1, 2, 3]);
    expect(urls[1]).toContain('offset=2');
  });

  it('uses enum, not the alternate list, per kind', async () => {
    const { fetch, urls } = stub([{ data: [] }]);
    await client(fetch).fetchList('manga', 'Kyoma__');
    expect(urls[0]).toContain('/mangalist');
  });

  it('reports a missing user as not-found rather than an empty list', async () => {
    const { fetch } = stub([{}], [404]);
    await expect(client(fetch).fetchList('anime', 'nobody')).rejects.toMatchObject({
      kind: 'not-found',
    });
  });

  it('reports 403 as an auth problem — the usual wrong-or-missing client id', async () => {
    const { fetch } = stub([{}], [403]);
    const error = await client(fetch)
      .fetchList('anime', 'Kyoma__')
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(MalApiError);
    expect((error as MalApiError).kind).toBe('auth');
    expect((error as MalApiError).message).toContain('MAL_CLIENT_ID');
  });

  it('refuses a response it cannot parse instead of importing half of it', async () => {
    const { fetch } = stub([{ data: [{ node: { title: 'no id' } }] }]);
    await expect(client(fetch).fetchList('anime', 'Kyoma__')).rejects.toMatchObject({
      kind: 'malformed',
    });
  });

  it('requires a client id', () => {
    expect(() => createMalClient({ clientId: '' })).toThrow(/client id/i);
  });
});
