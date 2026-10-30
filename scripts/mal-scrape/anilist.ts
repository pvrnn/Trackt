/**
 * AniList GraphQL client — transport and media query shapes.
 *
 * AniList is the catalog's identity provider for anime and manga (ADR-0001), so
 * unlike the MAL scraper nothing here has to translate an id: the API answers
 * with the very `id` a canonical uuid is derived from, and it hands back each
 * work's relations in the same payload. One request per 50 works, relations
 * included, is the whole import.
 *
 * The API allows 30 requests a minute (it reports the figure in
 * `x-ratelimit-limit`), so the client spaces calls rather than bursting and
 * treats a 429 as an instruction to wait, not an error to abandon.
 */

export const ANILIST_ENDPOINT = 'https://graphql.anilist.co';

/** Observed `x-ratelimit-limit`; also the historical degraded-mode floor. */
export const ANILIST_REQUESTS_PER_MINUTE = 30;

export interface AniListClientOptions {
  fetchImpl?: typeof fetch;
  /** Minimum gap between requests. Defaults to 60s / ANILIST_REQUESTS_PER_MINUTE. */
  spacingMs?: number;
  /** Extra attempts for a 5xx. */
  retries?: number;
  /** How many times to sit out a 429 before giving up. */
  rateLimitWaits?: number;
  onWarn?: (message: string) => void;
}

export interface AniListError {
  message: string;
  status?: number;
  locations?: { line?: number; column?: number }[];
}

export interface AniListEnvelope<T> {
  data: T | null;
  errors?: AniListError[];
}

/** A pacer: every call resolves at most once per `spacingMs`. */
export function createThrottle(spacingMs: number): () => Promise<void> {
  let last = 0;
  return async () => {
    if (spacingMs <= 0) return;
    const wait = spacingMs - (Date.now() - last);
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    last = Date.now();
  };
}

/**
 * How long to sit out a rejected request: `Retry-After` if the server said so,
 * else the window reset, else an exponential backoff. Capped at five minutes so
 * a bad header cannot park a bulk run for an hour.
 */
export function cooldownMs(response: Response, attempt: number, baseDelayMs: number): number {
  const retryAfter = Number(response.headers.get('retry-after'));
  if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.min(retryAfter, 300) * 1000;
  const reset = Number(response.headers.get('x-ratelimit-reset'));
  if (Number.isFinite(reset) && reset > 0) {
    return Math.min(Math.max(reset * 1000 - Date.now(), 1000), 300_000);
  }
  return Math.min(baseDelayMs * (attempt + 2) * 2, 300_000);
}

export interface AniListClient {
  query<T>(query: string, variables?: Record<string, unknown>): Promise<AniListEnvelope<T>>;
  requestCount(): number;
}

export function createAniListClient(options: AniListClientOptions = {}): AniListClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const spacingMs = options.spacingMs ?? Math.ceil(60_000 / ANILIST_REQUESTS_PER_MINUTE);
  const retries = options.retries ?? 2;
  const rateLimitWaits = options.rateLimitWaits ?? 4;
  const onWarn = options.onWarn ?? (() => {});
  const throttle = createThrottle(spacingMs);
  let requests = 0;

  return {
    requestCount: () => requests,
    async query<T>(query: string, variables: Record<string, unknown> = {}) {
      let backoffs = 0;
      let rateLimited = 0;
      for (;;) {
        await throttle();
        requests++;
        const response = await fetchImpl(ANILIST_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ query, variables }),
        });

        if (response.ok) {
          const body = (await response.json()) as AniListEnvelope<T>;
          if (body.errors?.length) {
            onWarn(`AniList: ${body.errors.map((error) => error.message).join('; ')}`);
          }
          return body;
        }

        if (response.status === 429 && rateLimited < rateLimitWaits) {
          rateLimited++;
          const wait = cooldownMs(response, rateLimited, spacingMs);
          onWarn(`AniList rate limit: waiting ${Math.round(wait / 1000)}s`);
          await new Promise((resolve) => setTimeout(resolve, wait));
          continue;
        }
        if (response.status >= 500 && backoffs < retries) {
          backoffs++;
          await new Promise((resolve) =>
            setTimeout(resolve, cooldownMs(response, backoffs, spacingMs)),
          );
          continue;
        }
        throw new Error(`AniList ${response.status}: ${(await response.text()).slice(0, 300)}`);
      }
    },
  };
}

/* ------------------------------------------------------------------ *
 * Media shape
 * ------------------------------------------------------------------ */

/** AniList's partial dates: `month`/`day` are unknown often enough to be null. */
export interface AniListDate {
  year?: number | null;
  month?: number | null;
  day?: number | null;
}

/** The node fields a relation *target* needs to be publishable in its own right. */
export interface AniListNode {
  id: number;
  idMal: number | null;
  type: 'ANIME' | 'MANGA';
  format: string | null;
  status: string | null;
  seasonYear: number | null;
  episodes: number | null;
  chapters: number | null;
  title: { romaji?: string | null; english?: string | null; native?: string | null };
  synonyms?: string[] | null;
  genres?: string[] | null;
  /** AniList's own 0–100 weighted mean of user scores; null when unscored. */
  averageScore?: number | null;
  startDate?: AniListDate | null;
  endDate?: AniListDate | null;
  /** Minutes per episode; for a film, its running time. */
  duration?: number | null;
  /** Published volumes; manga only, and null for most web-published works. */
  volumes?: number | null;
  coverImage?: { large?: string | null } | null;
  /** Wide header artwork, 1900×400-ish; null for most manga and older works. */
  bannerImage?: string | null;
  description?: string | null;
  /** Main studios only; sub-contractors are filed without `isMain`. */
  studios?: { nodes: { name: string }[] } | null;
  /** Credit edges of the work itself; relation targets do not carry them. */
  staff?: { edges: AniListStaffEdge[] } | null;
}

/** One AniList credit. `role` is free text: `Director`, `Story & Art (vols 1-41)`… */
export interface AniListStaffEdge {
  role: string;
  node: { name: { full?: string | null } | null } | null;
}

export interface AniListMedia extends AniListNode {
  relations?: { edges: { relationType: string; node: AniListNode }[] } | null;
}

export interface AniListPage<T> {
  pageInfo: { total: number; currentPage: number; lastPage: number; hasNextPage: boolean };
  media: T[];
}

const NODE_FIELDS = `
  id idMal type format status seasonYear episodes chapters
  title { romaji english native }
  synonyms genres averageScore startDate { year month day } endDate { year month day }
  duration volumes coverImage { large } bannerImage
`;

/**
 * Credits and studios are asked for on the work itself only: they are the
 * largest part of a page payload, and repeating them on every relation target
 * would multiply a 50-work request by its edges for rows the walk reaches as
 * their own top-level work anyway.
 *
 * `staff` is a nested connection, and AniList caps nested connections at 25
 * rows per page whatever `perPage` says. Sorting by `RELEVANCE` is what makes
 * those 25 the work's main staff rather than 25 key animators: the unsorted
 * default mixes in episode-level roles.
 */
const CREDITS_FIELDS = `
  studios(isMain: true) { nodes { name } }
  staff(perPage: 25, sort: [RELEVANCE]) { edges { role node { name { full } } } }
`;

/**
 * `description` is opt-in: it is a paragraph per work, and pulling it for 50
 * works × 5 relation targets per page would multiply the payload for a field the
 * catalog leaves null by policy.
 */
export function mediaFields(options: { withDescription?: boolean } = {}): string {
  const description = options.withDescription ? 'description(asHtml: false)' : '';
  return `
    ${NODE_FIELDS}
    ${description}
    ${CREDITS_FIELDS}
    relations {
      edges {
        relationType
        node { ${NODE_FIELDS} ${description} }
      }
    }
  `;
}

/**
 * Works whose MAL ids are known: how a MAL ranking is pulled, 50 ids per request.
 * The type is mandatory and literal: MAL anime and manga ids are separate
 * namespaces, and filtering keeps a same-numbered work of the other type out.
 */
export function mediaByMalIdsQuery(fields: string, type: AniListMediaType = 'ANIME'): string {
  return `
    query ($ids: [Int], $page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        pageInfo { total currentPage lastPage hasNextPage }
        media(idMal_in: $ids, type: ${type}) { ${fields} }
      }
    }
  `;
}

/** `Media.type`: the two AniList namespaces this catalog imports. */
export type AniListMediaType = 'ANIME' | 'MANGA';

/**
 * AniList's own ordering: no MAL involved at all. The API refuses a sorted walk
 * past 5000 entries ("Page depth exceeds maximum allowed"), so this path cannot
 * reach a top 10k on its own — that is what the MAL list walk is for.
 */
export function mediaBySortQuery(fields: string): string {
  return `
    query ($sort: [MediaSort], $type: MediaType, $page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        pageInfo { total currentPage lastPage hasNextPage }
        media(sort: $sort, type: $type) { ${fields} }
      }
    }
  `;
}

/**
 * Everything of one kind that started inside a date window.
 *
 * A sorted walk stops at page 100 (`Page depth exceeds maximum allowed`), so no
 * single ordering can enumerate the whole catalogue. Windows are the way round
 * it: no year holds more than a few thousand works, so a year per window stays
 * under the depth cap and the windows tile the id space.
 *
 * `FuzzyDateInt` is `YYYYMMDD`; an exclusive lower bound of `(year-1)1231` and an
 * exclusive upper bound of `year1231` select exactly the works dated in `year`,
 * partial dates (`YYYY0000`) included.
 */
export function mediaByStartDateQuery(fields: string): string {
  return `
    query ($lo: FuzzyDateInt, $hi: FuzzyDateInt, $type: MediaType, $page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        pageInfo { hasNextPage }
        media(startDate_greater: $lo, startDate_lesser: $hi, type: $type, sort: [ID]) { ${fields} }
      }
    }
  `;
}

/** Works in a status — announced rows have no start date, so no window reaches them. */
export function mediaByStatusQuery(fields: string): string {
  return `
    query ($status: [MediaStatus], $type: MediaType, $page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        pageInfo { hasNextPage }
        media(status_in: $status, type: $type, sort: [ID]) { ${fields} }
      }
    }
  `;
}

/** `perPage` maximum the API accepts. */
export const ANILIST_MAX_PER_PAGE = 50;
