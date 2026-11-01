import { ImportError } from '../errors.js';
import { looksLikeChallenge, type PageFetcher } from '../http/fetch.js';
import type { ImportKind } from '../types.js';
import { parseFavorites, type FavoritesPage } from './parse.js';
import {
  MalAnimeRowSchema,
  MalMangaRowSchema,
  fromAnimeRow,
  fromMangaRow,
  type MalListRow,
} from './schemas.js';

/**
 * MyAnimeList's list pages. The visible page prints the first 300 rows and then
 * pages the rest in from `/animelist/<user>/load.json`; the client reads that
 * endpoint, because it is the only complete read — the page's own 300 are a
 * re-sorted subset, not the endpoint's first page.
 *
 * The client takes a `PageFetcher`, not a `fetch`: whether the pages arrive over
 * plain HTTP or through a browser is the operator's choice, and the parser
 * cannot tell.
 */

const DEFAULT_BASE_URL = 'https://myanimelist.net';
const DEFAULT_MAX_PAGES = 100;

export interface MalClientOptions {
  fetcher: PageFetcher;
  baseUrl?: string;
  /** Politeness delay between pages; the fetcher spaces its own requests too. */
  requestSpacingMs?: number;
  /** A runaway-loop guard: a 10 000-row list is 34 pages at MAL's page size. */
  maxPages?: number;
}

export interface MalClient {
  /** Every row of one list, whatever its status (MAL's `status=7`). */
  fetchList(kind: ImportKind, user: string): Promise<MalListRow[]>;
  /** The anime and manga the profile pins, plus whether the sections were found. */
  fetchFavorites(user: string): Promise<FavoritesPage>;
}

export class MalError extends ImportError {
  declare readonly kind: 'not-found' | 'private' | 'http' | 'malformed';

  constructor(message: string, kind: MalError['kind'], status: number | null) {
    super(message, kind, status);
    this.name = 'MalError';
  }
}

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

export function createMalClient(options: MalClientOptions): MalClient {
  const {
    fetcher,
    baseUrl = DEFAULT_BASE_URL,
    requestSpacingMs = 0,
    maxPages = DEFAULT_MAX_PAGES,
  } = options;

  function errorForStatus(status: number, user: string): MalError {
    if (status === 404) {
      return new MalError(`MyAnimeList has no user "${user}"`, 'not-found', status);
    }
    // MAL answers 400 for a list it will not serve — most often an unknown name.
    if (status === 400) {
      return new MalError(
        `MyAnimeList would not serve the list of "${user}" — check the profile name, ` +
          `and that the list is public`,
        'not-found',
        status,
      );
    }
    if (status === 403) {
      return new MalError(
        `MyAnimeList refused the list of "${user}" (403) — a private list cannot be imported`,
        'private',
        status,
      );
    }
    return new MalError(`MyAnimeList answered ${status}`, 'http', status);
  }

  async function read(url: string, user: string): Promise<string> {
    const response = await fetcher.get(url);
    if (looksLikeChallenge(response.status, response.body)) {
      throw new MalError(
        `MyAnimeList answered with a Cloudflare challenge (${response.status}) — run the import ` +
          `with IMPORT_FETCH_MODE=browser and a browser installed ` +
          `(pnpm add -w playwright && pnpm exec playwright install chromium)`,
        'http',
        response.status,
      );
    }
    if (response.status !== 200) throw errorForStatus(response.status, user);
    return response.body;
  }

  function parsePage(kind: ImportKind, body: string, user: string, url: string): MalListRow[] {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      throw new MalError(
        `MyAnimeList did not answer "${user}" with a list (${url}) — the list may be private, ` +
          `or the endpoint has changed`,
        'malformed',
        null,
      );
    }

    const bad = (issue: string | undefined) =>
      new MalError(
        `unexpected MyAnimeList list row: ${issue ?? 'invalid shape'}`,
        'malformed',
        null,
      );

    if (kind === 'anime') {
      const rows = MalAnimeRowSchema.array().safeParse(parsed);
      if (!rows.success) throw bad(rows.error.issues[0]?.message);
      return rows.data.map(fromAnimeRow);
    }
    const rows = MalMangaRowSchema.array().safeParse(parsed);
    if (!rows.success) throw bad(rows.error.issues[0]?.message);
    return rows.data.map(fromMangaRow);
  }

  async function fetchList(kind: ImportKind, user: string): Promise<MalListRow[]> {
    const list = kind === 'anime' ? 'animelist' : 'mangalist';
    const rows: MalListRow[] = [];
    const seen = new Set<string>();
    let offset = 0;

    for (let page = 0; page < maxPages; page++) {
      if (page > 0) await sleep(requestSpacingMs);
      const url =
        `${baseUrl}/${list}/${encodeURIComponent(user)}/load.json` + `?status=7&offset=${offset}`;
      const items = parsePage(kind, await read(url, user), user, url);
      // The last page is the empty one, which MAL keeps answering — so an empty
      // page is the only end-of-list signal the endpoint gives.
      if (items.length === 0) return rows;

      let added = 0;
      for (const item of items) {
        if (seen.has(item.externalId)) continue;
        seen.add(item.externalId);
        rows.push(item);
        added += 1;
      }
      offset += items.length;
      // A page of nothing new means the endpoint is repeating itself; asking
      // again would loop forever.
      if (added === 0) return rows;
    }

    throw new MalError(
      `MyAnimeList kept paging "${user}" past ${maxPages} pages — refusing to loop instead of truncating`,
      'http',
      null,
    );
  }

  async function fetchFavorites(user: string): Promise<FavoritesPage> {
    const url = `${baseUrl}/profile/${encodeURIComponent(user)}/favorites`;
    return parseFavorites(await read(url, user));
  }

  return { fetchList, fetchFavorites };
}
