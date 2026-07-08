import type { ExternalIds, MediaKind, MediaStatus, PartKind } from '@trackt/shared';

/** A single search hit from an upstream provider. */
export interface ProviderSearchResult {
  provider: string;
  externalId: string;
  kind: MediaKind;
  title: string;
  originalTitle?: string;
  year?: number;
  coverUrl?: string;
  description?: string;
}

/** Full details for one work, normalized to Trackt's canonical shape (maps onto the `media` table). */
export interface CanonicalMedia {
  kind: MediaKind;
  title: string;
  originalTitle?: string;
  description?: string;
  coverUrl?: string;
  /** ISO date (YYYY-MM-DD). */
  releaseDate?: string;
  status?: MediaStatus;
  externalIds: ExternalIds;
  /** Type-specific extras: runtime, genres, studios, demographics... */
  metadata: Record<string, unknown>;
}

/** One structural part: a season/episode or volume/chapter (maps onto `media_part`). */
export interface CanonicalPart {
  kind: PartKind;
  /** Numeric to support chapter 10.5. */
  number: number;
  title?: string;
  /** ISO date (YYYY-MM-DD). */
  airDate?: string;
  /** Number of the parent part (episode → its season, chapter → its volume). */
  parentNumber?: number;
}

/**
 * Provider abstraction layer (PRD §4): each instance fetches from upstream providers
 * with its own API keys and caches locally — no central metadata server.
 */
export interface MetadataProvider {
  /** Stable identifier, also used as the external-ids key (e.g. 'tmdb'). */
  readonly name: string;
  /** Which media types this provider serves. */
  readonly kinds: readonly MediaKind[];
  search(query: string, kind: MediaKind): Promise<ProviderSearchResult[]>;
  getDetails(externalId: string, kind: MediaKind): Promise<CanonicalMedia>;
  /** Seasons/episodes or volumes/chapters. */
  getStructure(externalId: string, kind: MediaKind): Promise<CanonicalPart[]>;
}

export class ProviderError extends Error {
  constructor(
    public readonly provider: string,
    message: string,
    public readonly status?: number,
  ) {
    super(`[${provider}] ${message}`);
    this.name = 'ProviderError';
  }
}
