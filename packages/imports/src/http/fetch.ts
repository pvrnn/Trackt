/**
 * The slice of `fetch` the provider clients use, so a test can pass a stub.
 * `body` and `method` exist for the POST-shaped APIs (AniList GraphQL); the
 * scrape fetchers later agents add take their own seam.
 */
export type FetchLike = (
  url: string,
  init: { method?: string; headers: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** What a public web page expects to see; several providers 403 a bare client. */
export const BROWSER_USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
