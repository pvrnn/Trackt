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
  /** Scrape sources may need a real browser (Cloudflare); see http/fetch.ts. */
  browser?: boolean;
  /** Last resort: strict normalised title + exact year, unique match only. */
  titleFallback: boolean;
}

export const IMPORT_SOURCES: Record<ImportSource, ImportSourceDefinition> = {
  mal: {
    id: 'mal',
    label: 'MyAnimeList',
    kinds: ['anime', 'manga'],
    joinKeys: ['mal'],
    credential: {
      env: 'MAL_CLIENT_ID',
      hint:
        'create an API client at https://myanimelist.net/apiconfig and export its Client ID ' +
        '(public lists need nothing else).',
    },
    access: 'api',
    titleFallback: false,
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
    browser: true,
    titleFallback: true,
  },
};
