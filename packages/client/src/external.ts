import type { ExternalIds, MediaKind } from '@trackt/shared';

/**
 * Where a provider id points. Only providers whose page URL is derivable from
 * the id alone are listed: an external id is a shortcut to the source record,
 * and one that cannot be resolved would be a dead link rather than a shortcut.
 */
const PROVIDER_PATHS: Record<string, (kind: MediaKind, id: string) => string> = {
  anilist: (kind, id) => `https://anilist.co/${printMediaPath(kind)}/${id}`,
  mal: (kind, id) => `https://myanimelist.net/${printMediaPath(kind)}/${id}`,
  anidb: (_kind, id) => `https://anidb.net/anime/${id}`,
  ann: (_kind, id) => `https://www.animenewsnetwork.com/encyclopedia/anime.php?id=${id}`,
  tmdb: (kind, id) => `https://www.themoviedb.org/${kind === 'movie' ? 'movie' : 'tv'}/${id}`,
  imdb: (_kind, id) => `https://www.imdb.com/title/${id}/`,
};

/** AniList and MAL spell print works differently from their video pages. */
function printMediaPath(kind: MediaKind): string {
  return kind === 'manga' || kind === 'webtoon' ? 'manga' : 'anime';
}

export interface ExternalProfile {
  /** The `external_ids` key, lowercased — also the label a caller renders. */
  provider: string;
  /** Null when the provider's page cannot be derived from the id. */
  url: string | null;
}

/**
 * The upstream records a work came from, in the order the ids were stored, for
 * the detail page's external links. Unknown providers are kept with a null url
 * instead of being dropped: the id itself is still worth showing, and silently
 * hiding a provider would make the row disagree with the data.
 */
export function externalProfiles(
  kind: MediaKind,
  externalIds: ExternalIds,
  metadata: Record<string, unknown> = {},
): ExternalProfile[] {
  return Object.entries(externalIds).map(([provider, id]) => {
    if (provider.toLowerCase() === 'igdb') {
      return { provider, url: igdbGameUrl(metadata.igdbUrl) };
    }
    const path = PROVIDER_PATHS[provider.toLowerCase()];
    return {
      provider,
      url: path ? path(kind, String(id)) : null,
    };
  });
}

function igdbGameUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' &&
      url.hostname === 'www.igdb.com' &&
      /^\/games\/[a-z0-9-]+\/?$/.test(url.pathname)
      ? url.href
      : null;
  } catch {
    return null;
  }
}
