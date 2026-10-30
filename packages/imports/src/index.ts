export {
  createAniListClient,
  type AniListClient,
  type AniListClientOptions,
} from './anilist/client.js';
export { mapAniListEntry } from './anilist/map.js';
export type { AniListDate, AniListListEntry, AniListMedia } from './anilist/schemas.js';
export { applyImportPlan, type ApplyOptions, type ImportReport } from './apply.js';
export { applyDateRules, dateFromParts, readFullDate } from './dates.js';
export { ImportError, type ImportErrorKind } from './errors.js';
export {
  BROWSER_USER_AGENT,
  createBrowserFetcher,
  createHttpFetcher,
  createImportFetcher,
  looksLikeChallenge,
  type BrowserFetcherOptions,
  type DisposablePageFetcher,
  type FetchLike,
  type HttpFetcherOptions,
  type ImportFetchMode,
  type ImportFetcherOptions,
  type PageFetcher,
  type TextFetchLike,
} from './http/fetch.js';
export {
  createLetterboxdClient,
  type LetterboxdClient,
  type LetterboxdClientOptions,
} from './letterboxd/client.js';
export {
  mapLetterboxdEntry,
  type LetterboxdList,
  type LetterboxdRawEntry,
} from './letterboxd/map.js';
export {
  hasNextPage,
  parseDiary,
  parseFilmLinks,
  parsePosterGrid,
  type DiaryItem,
  type FilmLinks,
  type PosterItem,
} from './letterboxd/parse.js';
export { createMalClient, MalApiError, type MalClient } from './mal/client.js';
export { mapMalEntry, type MapOptions } from './mal/map.js';
export type { MalListEntry, MalListStatus } from './mal/schemas.js';
export {
  buildImportPlan,
  unmatchedTitles,
  type BuildPlanInput,
  type ImportPlan,
  type ImportPlanRow,
} from './plan.js';
export {
  entryKey,
  findLoggedMediaIds,
  resolveImportEntries,
  type ImportTarget,
  type ResolveResult,
} from './resolve.js';
export { planImport, runImport, type ImportRun, type RunImportOptions } from './run.js';
export { IMPORT_SOURCES, type ImportSourceDefinition } from './sources.js';
export {
  warning,
  type FetchedEntries,
  type FetchEntriesOptions,
  type ImportCredentials,
  type ImportEntry,
  type ImportKind,
  type ImportSource,
  type ImportWarning,
  type ImportWarningCode,
} from './types.js';
