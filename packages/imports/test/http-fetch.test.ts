import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ImportError } from '../src/errors.js';
import { createHttpFetcher, looksLikeChallenge, type TextFetchLike } from '../src/http/fetch.js';

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/letterboxd/${name}`, import.meta.url), 'utf8');
}

function stubTransport(
  status = 200,
  body = '<html>ok</html>',
): TextFetchLike & {
  calls: { url: string; headers: Record<string, string> }[];
} {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const transport = (async (url: string, init: { headers: Record<string, string> }) => {
    calls.push({ url, headers: init.headers });
    return { status, text: async () => body };
  }) as TextFetchLike & { calls: typeof calls };
  transport.calls = calls;
  return transport;
}

describe('createHttpFetcher', () => {
  it('sends a browser user-agent and an accept-language header', async () => {
    const transport = stubTransport();
    const page = await createHttpFetcher({ fetch: transport, requestSpacingMs: 0 }).get(
      'https://letterboxd.com/dave/films/page/1/',
    );
    expect(page).toEqual({ status: 200, body: '<html>ok</html>' });
    expect(transport.calls[0]?.headers['user-agent']).toMatch(/Mozilla/);
    expect(transport.calls[0]?.headers['accept-language']).toMatch(/^en/);
  });

  it('stops at its request budget instead of hammering the site', async () => {
    const transport = stubTransport();
    const fetcher = createHttpFetcher({
      fetch: transport,
      requestSpacingMs: 0,
      maxRequests: 2,
    });
    await fetcher.get('https://letterboxd.com/a/');
    await fetcher.get('https://letterboxd.com/b/');
    const error = await fetcher.get('https://letterboxd.com/c/').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ImportError);
    expect(error).toMatchObject({ kind: 'http' });
    expect((error as Error).message).toMatch(/request budget/);
    expect(transport.calls).toHaveLength(2);
  });

  it('reports a transport failure as http rather than leaking the error', async () => {
    const transport = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as TextFetchLike;
    const error = await createHttpFetcher({ fetch: transport, requestSpacingMs: 0 })
      .get('https://letterboxd.com/a/')
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject({ kind: 'http' });
    expect((error as Error).message).toContain('could not reach letterboxd.com');
  });
});

describe('looksLikeChallenge', () => {
  it('recognises the Cloudflare interstitial Letterboxd serves', () => {
    expect(looksLikeChallenge(403, fixture('challenge.html'))).toBe(true);
    expect(looksLikeChallenge(429, fixture('challenge.html'))).toBe(true);
  });

  it('recognises a short challenge page whatever the status', () => {
    expect(
      looksLikeChallenge(200, '<html><head><title>Just a moment...</title></head></html>'),
    ).toBe(true);
  });

  it('does not mistake a real page or a plain 403 for a challenge', () => {
    expect(looksLikeChallenge(200, fixture('films-page-1.html'))).toBe(false);
    expect(looksLikeChallenge(403, '<html><body>Forbidden</body></html>')).toBe(false);
    expect(looksLikeChallenge(500, 'Internal Server Error')).toBe(false);
  });
});
