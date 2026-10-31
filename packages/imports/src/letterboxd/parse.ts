import { isFullDate } from '../dates.js';

/**
 * Letterboxd's HTML → plain rows. String in, structure out: nothing here knows
 * about `fetch`, the import vocabulary or the catalog, so the parsers are tested
 * against pages captured from the live site and nothing else.
 *
 * Anchor on the attributes Letterboxd promises (`data-item-slug`,
 * `data-item-full-display-name`) and on the semantic classes (`rated-N`), never
 * on the hashed class names, which change with every deploy.
 */

export interface PosterItem {
  /** Letterboxd's film slug — the import's provider id. */
  slug: string;
  title: string;
  year: number | null;
  /** `film:709460`; kept for diagnostics, not for joining. */
  uid: string | null;
  /** The `rated-N` value: N out of 10, i.e. N/2 stars — already Trackt's scale. */
  rating: number | null;
  liked: boolean;
}

export interface DiaryItem {
  slug: string;
  title: string;
  year: number | null;
  /** `YYYY-MM-DD` from the diary's month/day cells. */
  watchedOn: string;
  rating: number | null;
  rewatch: boolean;
}

export interface FilmLinks {
  tmdb: string | null;
  imdb: string | null;
  /**
   * Where the film is from, as Letterboxd words it ("South Korea", "United
   * States"). Names, not ISO codes: the match compares them to the catalog's
   * codes, which is the only place the two vocabularies have to meet.
   */
  countries: string[];
}

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

const ENTITIES: Record<string, string> = {
  amp: '&',
  quot: '"',
  apos: "'",
  '#39': "'",
  nbsp: ' ',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  rsquo: '’',
  lsquo: '‘',
};

function decode(value: string): string {
  return value.replace(/&(#?\w+);/g, (whole, name: string) => ENTITIES[name] ?? whole);
}

function attribute(block: string, name: string): string | null {
  const match = new RegExp(`\\b${name}="([^"]*)"`).exec(block);
  return match?.[1] === undefined ? null : decode(match[1]);
}

/**
 * `"Movie (Director's Cut) (2001)"` → year 2001, title `Movie (Director's Cut)`:
 * the greedy prefix takes the *last* parenthesised year, which is the one
 * Letterboxd appends.
 */
function splitDisplayName(value: string): { title: string; year: number | null } {
  const match = /^(.*)\((\d{4})\)\s*$/.exec(value);
  if (!match) return { title: value.trim(), year: null };
  return { title: (match[1] ?? '').trim(), year: Number(match[2]) };
}

function readRating(block: string): number | null {
  const match = /class="[^"]*\brated-(\d+)/.exec(block);
  return match?.[1] === undefined ? null : Number(match[1]);
}

/** The `data-postered-identifier` JSON, decoded, once. */
function readUid(block: string): string | null {
  const match = /"uid":"([^"]+)"/.exec(block.replace(/&quot;/g, '"'));
  return match?.[1] ?? null;
}

/**
 * Poster grids (`/films/`, `/watchlist/`). Items are `<li class="griditem">`;
 * each block runs to the next item, so an item's rating is only ever its own.
 */
export function parsePosterGrid(html: string): PosterItem[] {
  const starts = [...html.matchAll(/<li class="griditem">/g)].map((match) => match.index ?? 0);
  const items: PosterItem[] = [];

  for (const [index, start] of starts.entries()) {
    const block = html.slice(start, starts[index + 1] ?? html.length);
    const slug = attribute(block, 'data-item-slug');
    if (!slug) continue;
    const displayName =
      attribute(block, 'data-item-full-display-name') ?? attribute(block, 'data-item-name') ?? slug;
    const { title, year } = splitDisplayName(displayName);
    items.push({
      slug,
      title,
      year,
      uid: readUid(block),
      rating: readRating(block),
      liked: block.includes('icon-liked'),
    });
  }

  return items;
}

/**
 * The diary. Its month and year are printed once per month and the following
 * rows leave those cells empty, so the parser carries them forward.
 */
export function parseDiary(html: string): DiaryItem[] {
  const items: DiaryItem[] = [];
  let year: number | null = null;
  let month: number | null = null;

  for (const [, block] of html.matchAll(/<tr class="diary-entry-row[^"]*"([\s\S]*?)<\/tr>/g)) {
    if (!block) continue;
    const printedMonth = /<a class="month"[^>]*>([A-Za-z]+)<\/a>/.exec(block)?.[1];
    if (printedMonth) month = MONTHS[printedMonth.slice(0, 3).toLowerCase()] ?? month;
    const printedYear = /<a class="year"[^>]*>(\d{4})<\/a>/.exec(block)?.[1];
    if (printedYear) year = Number(printedYear);

    const day = /<a class="daydate"[^>]*>(\d+)<\/a>/.exec(block)?.[1];
    const slug = attribute(block, 'data-item-slug');
    if (!day || !slug || !year || !month) continue;

    const watchedOn = `${year}-${String(month).padStart(2, '0')}-${String(Number(day)).padStart(2, '0')}`;
    if (!isFullDate(watchedOn)) continue;

    const displayName =
      attribute(block, 'data-item-full-display-name') ?? attribute(block, 'data-item-name') ?? slug;
    const { title, year: released } = splitDisplayName(displayName);
    // A rewatch row is the same cell without Letterboxd's explicit "off" class.
    const rewatchCell = /<td class="col-rewatch([^"]*)"/.exec(block)?.[1] ?? '';

    items.push({
      slug,
      title,
      year: released,
      watchedOn,
      rating: readRating(block),
      rewatch: !rewatchCell.includes('icon-status-off'),
    });
  }

  return items;
}

/**
 * The TMDB and IMDb ids a film page links to, plus its countries. This is the
 * only way in: the `/json/` endpoint is behind Cloudflare, the page is not.
 */
export function parseFilmLinks(html: string): FilmLinks {
  return {
    tmdb: /themoviedb\.org\/movie\/(\d+)/.exec(html)?.[1] ?? null,
    imdb: /imdb\.com\/title\/(tt\d+)/.exec(html)?.[1] ?? null,
    countries: parseCountries(html),
  };
}

/** `href="/films/country/south-korea/"` links carry the printable country name. */
function parseCountries(html: string): string[] {
  const found = new Set<string>();
  for (const match of html.matchAll(/href="\/films\/country\/[^"/]+\/"[^>]*>([^<]*)</g)) {
    const name = (match[1] ?? '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
    if (name) found.add(name);
  }
  return [...found];
}

/** Whether the page's pagination has an "Older" link. */
export function hasNextPage(html: string): boolean {
  return /<a class="next"[^>]*href="/.test(html);
}
