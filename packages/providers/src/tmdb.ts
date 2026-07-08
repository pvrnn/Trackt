import type { MediaKind, MediaStatus } from '@trackt/shared';
import { fetchJson } from './http.js';
import { TokenBucket } from './rate-limit.js';
import {
  ProviderError,
  type CanonicalMedia,
  type CanonicalPart,
  type MetadataProvider,
  type ProviderSearchResult,
} from './types.js';

const API_BASE = 'https://api.themoviedb.org/3';
const IMAGE_BASE = 'https://image.tmdb.org/t/p/w500';

interface TmdbSearchItem {
  id: number;
  title?: string; // movies
  name?: string; // tv
  original_title?: string;
  original_name?: string;
  overview?: string;
  poster_path?: string | null;
  release_date?: string;
  first_air_date?: string;
}

interface TmdbMovieDetails extends TmdbSearchItem {
  runtime?: number;
  status?: string;
  genres?: { name: string }[];
  imdb_id?: string | null;
  vote_average?: number;
}

interface TmdbTvDetails extends TmdbSearchItem {
  status?: string;
  genres?: { name: string }[];
  number_of_seasons?: number;
  number_of_episodes?: number;
  seasons?: { season_number: number; name?: string; air_date?: string | null }[];
  external_ids?: { imdb_id?: string | null; tvdb_id?: number | null };
  vote_average?: number;
}

interface TmdbSeasonDetails {
  episodes?: {
    episode_number: number;
    season_number: number;
    name?: string;
    air_date?: string | null;
  }[];
}

function mapTvStatus(status: string | undefined): MediaStatus | undefined {
  switch (status) {
    case 'Returning Series':
      return 'airing';
    case 'Ended':
      return 'ended';
    case 'Canceled':
      return 'cancelled';
    case 'In Production':
    case 'Planned':
    case 'Pilot':
      return 'announced';
    default:
      return undefined;
  }
}

/**
 * TMDB: primary provider for movies and series (PRD §4).
 * Terms allow app-level caching but not redistribution; attribution is required
 * on media pages (handled by the web app footer).
 */
export class TmdbProvider implements MetadataProvider {
  readonly name = 'tmdb';
  readonly kinds = ['movie', 'series'] as const;

  private readonly bucket: TokenBucket;

  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
    // TMDB allows ~50 req/s; stay well under it.
    bucket = new TokenBucket(20, 10),
  ) {
    this.bucket = bucket;
  }

  private request<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    const url = new URL(`${API_BASE}${path}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const init: RequestInit = {};
    // v4 "API Read Access Token" (JWT) goes in the Authorization header; v3 keys as a query param.
    if (this.apiKey.startsWith('eyJ')) {
      init.headers = { Authorization: `Bearer ${this.apiKey}` };
    } else {
      url.searchParams.set('api_key', this.apiKey);
    }
    return fetchJson<T>(url.toString(), init, {
      provider: this.name,
      bucket: this.bucket,
      fetchImpl: this.fetchImpl,
    });
  }

  private assertKind(kind: MediaKind): asserts kind is 'movie' | 'series' {
    if (kind !== 'movie' && kind !== 'series') {
      throw new ProviderError(this.name, `unsupported media kind: ${kind}`);
    }
  }

  async search(query: string, kind: MediaKind): Promise<ProviderSearchResult[]> {
    this.assertKind(kind);
    const path = kind === 'movie' ? '/search/movie' : '/search/tv';
    const data = await this.request<{ results: TmdbSearchItem[] }>(path, {
      query,
      include_adult: 'false',
    });
    return data.results.slice(0, 20).map((item) => ({
      provider: this.name,
      externalId: String(item.id),
      kind,
      title: item.title ?? item.name ?? 'Untitled',
      originalTitle: item.original_title ?? item.original_name,
      year: yearOf(item.release_date ?? item.first_air_date),
      coverUrl: item.poster_path ? `${IMAGE_BASE}${item.poster_path}` : undefined,
      description: item.overview || undefined,
    }));
  }

  async getDetails(externalId: string, kind: MediaKind): Promise<CanonicalMedia> {
    this.assertKind(kind);
    if (kind === 'movie') {
      const movie = await this.request<TmdbMovieDetails>(`/movie/${externalId}`);
      return {
        kind,
        title: movie.title ?? 'Untitled',
        originalTitle: movie.original_title,
        description: movie.overview || undefined,
        coverUrl: movie.poster_path ? `${IMAGE_BASE}${movie.poster_path}` : undefined,
        releaseDate: movie.release_date || undefined,
        externalIds: {
          tmdb: movie.id,
          ...(movie.imdb_id ? { imdb: movie.imdb_id } : {}),
        },
        metadata: {
          runtime: movie.runtime,
          genres: movie.genres?.map((g) => g.name),
          voteAverage: movie.vote_average,
        },
      };
    }
    const tv = await this.request<TmdbTvDetails>(`/tv/${externalId}`, {
      append_to_response: 'external_ids',
    });
    return {
      kind,
      title: tv.name ?? 'Untitled',
      originalTitle: tv.original_name,
      description: tv.overview || undefined,
      coverUrl: tv.poster_path ? `${IMAGE_BASE}${tv.poster_path}` : undefined,
      releaseDate: tv.first_air_date || undefined,
      status: mapTvStatus(tv.status),
      externalIds: {
        tmdb: tv.id,
        ...(tv.external_ids?.imdb_id ? { imdb: tv.external_ids.imdb_id } : {}),
        ...(tv.external_ids?.tvdb_id ? { tvdb: tv.external_ids.tvdb_id } : {}),
      },
      metadata: {
        genres: tv.genres?.map((g) => g.name),
        seasons: tv.number_of_seasons,
        episodes: tv.number_of_episodes,
        voteAverage: tv.vote_average,
      },
    };
  }

  async getStructure(externalId: string, kind: MediaKind): Promise<CanonicalPart[]> {
    this.assertKind(kind);
    if (kind === 'movie') return [];

    const tv = await this.request<TmdbTvDetails>(`/tv/${externalId}`);
    const parts: CanonicalPart[] = [];
    for (const season of tv.seasons ?? []) {
      parts.push({
        kind: 'season',
        number: season.season_number,
        title: season.name,
        airDate: season.air_date ?? undefined,
      });
      const details = await this.request<TmdbSeasonDetails>(
        `/tv/${externalId}/season/${season.season_number}`,
      );
      for (const episode of details.episodes ?? []) {
        parts.push({
          kind: 'episode',
          number: episode.episode_number,
          parentNumber: episode.season_number,
          title: episode.name,
          airDate: episode.air_date ?? undefined,
        });
      }
    }
    return parts;
  }
}

function yearOf(date: string | undefined): number | undefined {
  if (!date) return undefined;
  const year = Number(date.slice(0, 4));
  return Number.isFinite(year) ? year : undefined;
}
