import type { MediaKind } from '@trackt/shared';
import type { ImportSource } from './types.js';

/**
 * A source's *shape*, declared once: what it can yield, how its rows are matched
 * back to catalog rows, and what an operator must supply to run it.
 */
export interface ImportSourceDefinition {
  id: ImportSource;
  /** Shown by the API's source list and the CLI. */
  label: string;
  /** What the source can yield — the catalog's kinds, not the source's lists. */
  kinds: readonly MediaKind[];
  /** `external_ids` keys, in the order the resolver tries them. */
  joinKeys: readonly string[];
  credential: { env: string; hint: string } | null;
  access: 'api' | 'scrape';
  /**
   * The source may need a real browser (Cloudflare); see http/fetch.ts.
   * `required` means plain HTTP is known to be refused, so the API reports the
   * source unavailable until a browser is configured; `optional` means the pages
   * answer HTTP but the browser is there for the day they stop.
   */
  browser?: 'required' | 'optional';
  /** Last resort: strict normalised title + exact year, unique match only. */
  titleFallback: boolean;
}

export const IMPORT_SOURCES: Record<ImportSource, ImportSourceDefinition> = {
  mal: {
    id: 'mal',
    label: 'MyAnimeList',
    kinds: ['anime', 'manga'],
    joinKeys: ['mal'],
    credential: null,
    access: 'scrape',
    browser: 'optional',
    // The seeds carry a MAL id for most rows, but the lists are public pages: a
    // work materialized from TMDB or an older seed has no MAL id to join on.
    titleFallback: true,
  },
  anilist: {
    id: 'anilist',
    label: 'AniList',
    kinds: ['anime', 'manga'],
    joinKeys: ['anilist'],
    credential: null,
    access: 'api',
    titleFallback: false,
  },
  letterboxd: {
    id: 'letterboxd',
    label: 'Letterboxd',
    kinds: ['movie'],
    joinKeys: ['tmdb', 'imdb'],
    credential: null,
    access: 'scrape',
    browser: 'required',
    titleFallback: true,
  },
  trakt: {
    id: 'trakt',
    label: 'Trakt',
    // A series row is one season (ADR-0003), so one show yields several entries.
    kinds: ['movie', 'series'],
    joinKeys: ['tmdb', 'imdb'],
    credential: {
      env: 'TRAKT_CLIENT_ID',
      hint:
        'create an API app at https://trakt.tv/oauth/applications and use its Client ID ' +
        '(public profiles need nothing else)',
    },
    access: 'api',
    titleFallback: false,
  },
};
