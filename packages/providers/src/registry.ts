import type { MediaKind } from '@trackt/shared';
import { AniListProvider } from './anilist.js';
import { TmdbProvider } from './tmdb.js';
import { TvmazeProvider } from './tvmaze.js';
import type { MetadataProvider, ProviderSearchResult } from './types.js';

export interface RegistryLogger {
  warn(message: string): void;
}

/**
 * Routes each media kind to its providers in priority order (PRD §4):
 * movies → TMDB; series → TMDB, then TVmaze; anime/manga → AniList;
 * webtoons → user-created entities only (no provider).
 */
export class ProviderRegistry {
  private readonly byKind = new Map<MediaKind, MetadataProvider[]>();

  constructor(
    providers: MetadataProvider[],
    private readonly logger: RegistryLogger = console,
  ) {
    for (const provider of providers) {
      for (const kind of provider.kinds) {
        const existing = this.byKind.get(kind) ?? [];
        existing.push(provider);
        this.byKind.set(kind, existing);
      }
    }
  }

  providersFor(kind: MediaKind): MetadataProvider[] {
    return this.byKind.get(kind) ?? [];
  }

  getProvider(name: string): MetadataProvider | undefined {
    for (const providers of this.byKind.values()) {
      const found = providers.find((p) => p.name === name);
      if (found) return found;
    }
    return undefined;
  }

  /** Query providers in priority order; fall through to the next on failure or empty results. */
  async search(query: string, kind: MediaKind): Promise<ProviderSearchResult[]> {
    for (const provider of this.providersFor(kind)) {
      try {
        const results = await provider.search(query, kind);
        if (results.length > 0) return results;
      } catch (error) {
        this.logger.warn(`search via ${provider.name} failed: ${(error as Error).message}`);
      }
    }
    return [];
  }
}

export interface CreateRegistryOptions {
  tmdbApiKey?: string | undefined;
  fetchImpl?: typeof fetch;
  logger?: RegistryLogger;
}

export function createDefaultRegistry(options: CreateRegistryOptions = {}): ProviderRegistry {
  const { tmdbApiKey, fetchImpl = fetch, logger = console } = options;
  const providers: MetadataProvider[] = [];

  if (tmdbApiKey) {
    providers.push(new TmdbProvider(tmdbApiKey, fetchImpl));
  } else {
    logger.warn(
      'TMDB_API_KEY missing — movie search disabled and series metadata limited to TVmaze. ' +
        'Get a free key at https://www.themoviedb.org/settings/api',
    );
  }
  providers.push(new TvmazeProvider(fetchImpl));
  providers.push(new AniListProvider(fetchImpl));

  return new ProviderRegistry(providers, logger);
}
