import { ImportError } from '../errors.js';
import { looksLikeChallenge, type PageFetcher } from '../http/fetch.js';
import {
  hasNextPage,
  parseDiary,
  parseFilmLinks,
  parsePosterGrid,
  type DiaryItem,
  type FilmLinks,
  type PosterItem,
} from './parse.js';

/**
 * Letterboxd's list pages. Every grid is server-rendered and paginated at
 * `/page/<n>/`; a page with no items is the end of the list.
 *
 * The client takes a `PageFetcher`, not a `fetch`: whether the pages arrive over
 * plain HTTP or through a browser (Cloudflare) is the operator's choice, and the
 * parser cannot tell.
 */

const DEFAULT_BASE_URL = 'https://letterboxd.com';
const DEFAULT_MAX_PAGES = 200;

export interface LetterboxdClientOptions {
  fetcher: PageFetcher;
  baseUrl?: string;
  /** Politeness delay between pages; the fetcher spaces its own requests too. */
  requestSpacingMs?: number;
  /** A runaway-loop guard; a real list ends on its own. */
  maxPages?: number;
}

export interface LetterboxdClient {
  /** The films the user has watched. */
  fetchFilms(user: string): Promise<PosterItem[]>;
  fetchWatchlist(user: string): Promise<PosterItem[]>;
  /** Diary viewings, newest first, as the site lists them. */
  fetchDiary(user: string): Promise<DiaryItem[]>;
  /** The TMDB/IMDb ids the film's own page links to. */
  fetchFilmLinks(slug: string): Promise<FilmLinks>;
}

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

function challengeError(status: number, what: string): ImportError {
  return new ImportError(
    `Letterboxd answered ${what} with a Cloudflare challenge (${status}) — run the import with ` +
      `IMPORT_FETCH_MODE=fallback and a browser installed ` +
      `(pnpm add -w playwright && pnpm exec playwright install chromium)`,
    'http',
    status,
  );
}

export function createLetterboxdClient(options: LetterboxdClientOptions): LetterboxdClient {
  const {
    fetcher,
    baseUrl = DEFAULT_BASE_URL,
    requestSpacingMs = 0,
    maxPages = DEFAULT_MAX_PAGES,
  } = options;

  async function read(url: string, user: string): Promise<string | null> {
    const response = await fetcher.get(url);
    if (response.status === 404) return null;
    if (looksLikeChallenge(response.status, response.body)) {
      throw challengeError(response.status, url);
    }
    if (response.status !== 200) {
      throw new ImportError(
        `Letterboxd answered ${response.status} for "${user}" (${url})`,
        'http',
        response.status,
      );
    }
    return response.body;
  }

  /**
   * Walk a paginated list. Page 1's 404 is "no such user"; a later page's 404 is
   * the list running out, which Letterboxd does not distinguish any other way.
   */
  async function pages<T>(
    user: string,
    pageUrl: (page: number) => string,
    parse: (html: string) => T[],
  ): Promise<T[]> {
    const rows: T[] = [];
    for (let page = 1; page <= maxPages; page++) {
      if (page > 1) await sleep(requestSpacingMs);
      const url = pageUrl(page);
      const html = await read(url, user);
      if (html === null) {
        if (page === 1) {
          throw new ImportError(`Letterboxd has no user "${user}"`, 'not-found', 404);
        }
        return rows;
      }
      const items = parse(html);
      if (items.length === 0) return rows;
      rows.push(...items);
      if (!hasNextPage(html)) return rows;
    }
    throw new ImportError(
      `Letterboxd kept paging past ${maxPages} pages — refusing to loop instead of truncating`,
      'http',
      null,
    );
  }

  function dedupeBySlug<T extends { slug: string }>(items: T[]): T[] {
    const bySlug = new Map<string, T>();
    for (const item of items) if (!bySlug.has(item.slug)) bySlug.set(item.slug, item);
    return [...bySlug.values()];
  }

  function fetchFilms(user: string): Promise<PosterItem[]> {
    return pages(
      user,
      (page) => `${baseUrl}/${encodeURIComponent(user)}/films/page/${page}/`,
      parsePosterGrid,
    ).then(dedupeBySlug);
  }

  function fetchWatchlist(user: string): Promise<PosterItem[]> {
    return pages(
      user,
      (page) => `${baseUrl}/${encodeURIComponent(user)}/watchlist/page/${page}/`,
      parsePosterGrid,
    ).then(dedupeBySlug);
  }

  function fetchDiary(user: string): Promise<DiaryItem[]> {
    return pages(
      user,
      // Page 1 is `/films/diary/`; the site's own "Older" link then moves the
      // list segment: `/<user>/diary/films/page/<n>/`.
      (page) =>
        page === 1
          ? `${baseUrl}/${encodeURIComponent(user)}/films/diary/`
          : `${baseUrl}/${encodeURIComponent(user)}/diary/films/page/${page}/`,
      parseDiary,
    );
  }

  async function fetchFilmLinks(slug: string): Promise<FilmLinks> {
    const url = `${baseUrl}/film/${encodeURIComponent(slug)}/`;
    const html = await read(url, slug);
    if (html === null) {
      throw new ImportError(`Letterboxd has no film "${slug}"`, 'not-found', 404);
    }
    return parseFilmLinks(html);
  }

  return { fetchFilms, fetchWatchlist, fetchDiary, fetchFilmLinks };
}
