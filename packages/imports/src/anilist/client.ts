import { ImportError } from '../errors.js';
import { BROWSER_USER_AGENT, type FetchLike } from '../http/fetch.js';
import type { ImportKind } from '../types.js';
import { AniListResponseSchema, type AniListListEntry } from './schemas.js';

/**
 * AniList's public GraphQL API needs no credential at all: a public list is one
 * POST per media type, and the whole list comes back in that response — no
 * paging. A missing or private user answers 404 with a GraphQL `errors` array,
 * so the body is read before the status is judged.
 */

const DEFAULT_ENDPOINT = 'https://graphql.anilist.co';

const LIST_QUERY = `query ($userName: String, $type: MediaType) {
  MediaListCollection(userName: $userName, type: $type) {
    lists {
      name
      entries {
        mediaId
        status
        score
        progress
        repeat
        notes
        startedAt { year month day }
        completedAt { year month day }
        media {
          id
          idMal
          episodes
          chapters
          format
          seasonYear
          title { romaji english }
        }
      }
    }
  }
}`;

export interface AniListClientOptions {
  fetch?: FetchLike;
  endpoint?: string;
}

export interface AniListClient {
  /** Every entry of one media type, across all of the user's lists. */
  fetchList(kind: ImportKind, userName: string): Promise<AniListListEntry[]>;
}

function errorFor(message: string, status: number | null, userName: string): ImportError {
  const text = message.toLowerCase();
  if (text.includes('private')) {
    return new ImportError(
      `AniList user "${userName}" keeps their lists private`,
      'private',
      status,
    );
  }
  if (text.includes('not found')) {
    return new ImportError(`AniList has no user "${userName}"`, 'not-found', status);
  }
  if (text.includes('too many requests') || status === 429) {
    return new ImportError('AniList is rate-limiting this instance — retry later', 'http', status);
  }
  return new ImportError(`AniList answered ${status ?? 'an error'}: ${message}`, 'http', status);
}

export function createAniListClient(options: AniListClientOptions = {}): AniListClient {
  const { fetch = globalThis.fetch as unknown as FetchLike, endpoint = DEFAULT_ENDPOINT } = options;

  async function fetchList(kind: ImportKind, userName: string): Promise<AniListListEntry[]> {
    const type = kind === 'anime' || kind === 'manga' ? kind.toUpperCase() : null;
    if (!type) throw new Error(`AniList has no ${kind} list`);

    let response: Awaited<ReturnType<FetchLike>>;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          'user-agent': BROWSER_USER_AGENT,
        },
        body: JSON.stringify({ query: LIST_QUERY, variables: { userName, type } }),
      });
    } catch (error) {
      throw new ImportError(
        `could not reach AniList: ${error instanceof Error ? error.message : String(error)}`,
        'http',
        null,
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new ImportError(
        response.ok
          ? 'unexpected AniList response: the body is not JSON'
          : `AniList answered ${response.status}`,
        response.ok ? 'malformed' : 'http',
        response.status,
      );
    }

    const parsed = AniListResponseSchema.safeParse(body);
    if (!parsed.success) {
      throw new ImportError(
        `unexpected AniList response: ${parsed.error.issues[0]?.message ?? 'invalid shape'}`,
        'malformed',
        response.status,
      );
    }

    const graphqlError = parsed.data.errors?.[0];
    if (graphqlError) throw errorFor(graphqlError.message, response.status, userName);
    if (!response.ok) {
      throw new ImportError(`AniList answered ${response.status}`, 'http', response.status);
    }

    const collection = parsed.data.data?.MediaListCollection;
    if (!collection) {
      throw new ImportError(
        'unexpected AniList response: no MediaListCollection',
        'malformed',
        200,
      );
    }
    return (collection.lists ?? []).flatMap((list) => list.entries);
  }

  return { fetchList };
}
