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

const API_BASE = 'https://api.tvmaze.com';

interface TvmazeShow {
  id: number;
  name: string;
  summary?: string | null;
  premiered?: string | null;
  status?: string | null;
  image?: { medium?: string; original?: string } | null;
  genres?: string[];
  externals?: { tvrage?: number | null; thetvdb?: number | null; imdb?: string | null };
}

interface TvmazeEpisode {
  id: number;
  name?: string;
  season: number;
  number: number | null;
  airdate?: string | null;
}

function mapStatus(status: string | null | undefined): MediaStatus | undefined {
  switch (status) {
    case 'Running':
      return 'airing';
    case 'Ended':
      return 'ended';
    case 'To Be Determined':
    case 'In Development':
      return 'announced';
    default:
      return undefined;
  }
}

function stripHtml(html: string | null | undefined): string | undefined {
  if (!html) return undefined;
  return html.replace(/<[^>]+>/g, '').trim() || undefined;
}

/**
 * TVmaze: free, keyless fallback provider for series (PRD §4).
 * Rate limit: 20 requests / 10 seconds.
 */
export class TvmazeProvider implements MetadataProvider {
  readonly name = 'tvmaze';
  readonly kinds = ['series'] as const;

  constructor(
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly bucket = new TokenBucket(10, 2),
  ) {}

  private request<T>(path: string): Promise<T> {
    return fetchJson<T>(
      `${API_BASE}${path}`,
      {},
      {
        provider: this.name,
        bucket: this.bucket,
        fetchImpl: this.fetchImpl,
      },
    );
  }

  private assertKind(kind: MediaKind): asserts kind is 'series' {
    if (kind !== 'series') {
      throw new ProviderError(this.name, `unsupported media kind: ${kind}`);
    }
  }

  async search(query: string, kind: MediaKind): Promise<ProviderSearchResult[]> {
    this.assertKind(kind);
    const data = await this.request<{ show: TvmazeShow }[]>(
      `/search/shows?q=${encodeURIComponent(query)}`,
    );
    return data.map(({ show }) => ({
      provider: this.name,
      externalId: String(show.id),
      kind,
      title: show.name,
      year: show.premiered ? Number(show.premiered.slice(0, 4)) : undefined,
      coverUrl: show.image?.medium ?? undefined,
      description: stripHtml(show.summary),
    }));
  }

  async getDetails(externalId: string, kind: MediaKind): Promise<CanonicalMedia> {
    this.assertKind(kind);
    const show = await this.request<TvmazeShow>(`/shows/${externalId}`);
    return {
      kind,
      title: show.name,
      description: stripHtml(show.summary),
      coverUrl: show.image?.original ?? show.image?.medium ?? undefined,
      releaseDate: show.premiered ?? undefined,
      status: mapStatus(show.status),
      externalIds: {
        tvmaze: show.id,
        ...(show.externals?.imdb ? { imdb: show.externals.imdb } : {}),
        ...(show.externals?.thetvdb ? { tvdb: show.externals.thetvdb } : {}),
      },
      metadata: { genres: show.genres },
    };
  }

  async getStructure(externalId: string, kind: MediaKind): Promise<CanonicalPart[]> {
    this.assertKind(kind);
    const episodes = await this.request<TvmazeEpisode[]>(`/shows/${externalId}/episodes`);
    const parts: CanonicalPart[] = [];
    const seasons = new Set<number>();
    for (const episode of episodes) {
      if (!seasons.has(episode.season)) {
        seasons.add(episode.season);
        parts.push({ kind: 'season', number: episode.season });
      }
      if (episode.number === null) continue; // specials without a number
      parts.push({
        kind: 'episode',
        number: episode.number,
        parentNumber: episode.season,
        title: episode.name,
        airDate: episode.airdate ?? undefined,
      });
    }
    return parts;
  }
}
