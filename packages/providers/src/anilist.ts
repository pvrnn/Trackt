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

const API_URL = 'https://graphql.anilist.co';

const MEDIA_FIELDS = `
  id
  idMal
  title { romaji english native }
  description(asHtml: false)
  coverImage { large }
  startDate { year month day }
  status
  format
  episodes
  chapters
  volumes
  genres
  averageScore
`;

interface AniListMedia {
  id: number;
  idMal: number | null;
  title: { romaji?: string; english?: string; native?: string };
  description?: string | null;
  coverImage?: { large?: string | null };
  startDate?: { year?: number | null; month?: number | null; day?: number | null };
  status?: string | null;
  format?: string | null;
  episodes?: number | null;
  chapters?: number | null;
  volumes?: number | null;
  genres?: string[];
  averageScore?: number | null;
}

function mapStatus(status: string | null | undefined, kind: MediaKind): MediaStatus | undefined {
  switch (status) {
    case 'RELEASING':
      return kind === 'anime' ? 'airing' : 'publishing';
    case 'FINISHED':
      return 'ended';
    case 'NOT_YET_RELEASED':
      return 'announced';
    case 'CANCELLED':
      return 'cancelled';
    case 'HIATUS':
      return kind === 'anime' ? 'airing' : 'publishing';
    default:
      return undefined;
  }
}

function isoDate(date: AniListMedia['startDate']): string | undefined {
  if (!date?.year) return undefined;
  const month = String(date.month ?? 1).padStart(2, '0');
  const day = String(date.day ?? 1).padStart(2, '0');
  return `${date.year}-${month}-${day}`;
}

function titleOf(media: AniListMedia): string {
  return media.title.english ?? media.title.romaji ?? media.title.native ?? 'Untitled';
}

/**
 * AniList: primary provider for anime and manga (PRD §4).
 * Public GraphQL API, no key required; rate limit ~90 req/min.
 */
export class AniListProvider implements MetadataProvider {
  readonly name = 'anilist';
  readonly kinds = ['anime', 'manga'] as const;

  constructor(
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly bucket = new TokenBucket(10, 1),
  ) {}

  private async query<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const data = await fetchJson<{ data: T; errors?: { message: string }[] }>(
      API_URL,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ query, variables }),
      },
      { provider: this.name, bucket: this.bucket, fetchImpl: this.fetchImpl },
    );
    if (data.errors?.length) {
      throw new ProviderError(this.name, data.errors.map((e) => e.message).join('; '));
    }
    return data.data;
  }

  private assertKind(kind: MediaKind): asserts kind is 'anime' | 'manga' {
    if (kind !== 'anime' && kind !== 'manga') {
      throw new ProviderError(this.name, `unsupported media kind: ${kind}`);
    }
  }

  async search(query: string, kind: MediaKind): Promise<ProviderSearchResult[]> {
    this.assertKind(kind);
    const type = kind === 'anime' ? 'ANIME' : 'MANGA';
    const data = await this.query<{ Page: { media: AniListMedia[] } }>(
      `query ($search: String, $type: MediaType) {
        Page(perPage: 20) { media(search: $search, type: $type) { ${MEDIA_FIELDS} } }
      }`,
      { search: query, type },
    );
    return data.Page.media.map((item) => ({
      provider: this.name,
      externalId: String(item.id),
      kind,
      title: titleOf(item),
      originalTitle: item.title.native ?? undefined,
      year: item.startDate?.year ?? undefined,
      coverUrl: item.coverImage?.large ?? undefined,
      description: item.description ?? undefined,
    }));
  }

  async getDetails(externalId: string, kind: MediaKind): Promise<CanonicalMedia> {
    this.assertKind(kind);
    const type = kind === 'anime' ? 'ANIME' : 'MANGA';
    const data = await this.query<{ Media: AniListMedia }>(
      `query ($id: Int, $type: MediaType) {
        Media(id: $id, type: $type) { ${MEDIA_FIELDS} }
      }`,
      { id: Number(externalId), type },
    );
    const item = data.Media;
    return {
      kind,
      title: titleOf(item),
      originalTitle: item.title.native ?? undefined,
      description: item.description ?? undefined,
      coverUrl: item.coverImage?.large ?? undefined,
      releaseDate: isoDate(item.startDate),
      status: mapStatus(item.status, kind),
      externalIds: {
        anilist: item.id,
        ...(item.idMal ? { mal: item.idMal } : {}),
      },
      metadata: {
        format: item.format,
        genres: item.genres,
        averageScore: item.averageScore,
        episodes: item.episodes,
        chapters: item.chapters,
        volumes: item.volumes,
      },
    };
  }

  /**
   * AniList exposes counts, not per-part listings, so the structure is synthesized:
   * episode 1..n for anime, volume/chapter 1..n for manga. Precise chapter→volume
   * mapping needs a secondary source (MangaDex, v1.x).
   */
  async getStructure(externalId: string, kind: MediaKind): Promise<CanonicalPart[]> {
    this.assertKind(kind);
    const details = await this.getDetails(externalId, kind);
    const parts: CanonicalPart[] = [];
    if (kind === 'anime') {
      const episodes = (details.metadata.episodes as number | null) ?? 0;
      for (let i = 1; i <= episodes; i++) parts.push({ kind: 'episode', number: i });
      return parts;
    }
    const volumes = (details.metadata.volumes as number | null) ?? 0;
    for (let i = 1; i <= volumes; i++) parts.push({ kind: 'volume', number: i });
    const chapters = (details.metadata.chapters as number | null) ?? 0;
    for (let i = 1; i <= chapters; i++) parts.push({ kind: 'chapter', number: i });
    return parts;
  }
}
