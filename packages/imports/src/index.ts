export {
  createAniListClient,
  type AniListClient,
  type AniListClientOptions,
} from './anilist/client.js';
export { mapAniListEntry } from './anilist/map.js';
export type { AniListDate, AniListListEntry, AniListMedia } from './anilist/schemas.js';
export { applyImportPlan, type ApplyOptions, type ImportReport } from './apply.js';
export {
  applyDateRules,
  dateFromParts,
  formatDateParts,
  readFullDate,
  isFullDate,
} from './dates.js';
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
  ImportJobDataSchema,
  ImportJobResultSchema,
  ImportPlanSummarySchema,
  ImportReportSchema,
  ImportRequestSchema,
  ImportSourceSchema,
  ImportWarningSchema,
  MAX_JOB_UNMATCHED,
  UncertainCandidateSchema,
  UncertainMatchListSchema,
  UncertainMatchSchema,
  credentialsFromEnv,
  importJobId,
  toJobResult,
  type ImportCredentialEnv,
  type ImportJobData,
  type ImportJobProgress,
  type ImportJobResult,
  type ImportPlanSummary,
  type ImportRequest,
  type ImportUnmatchedEntry,
  type UncertainMatchList,
} from './job.js';
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
export { createMalClient, MalError, type MalClient, type MalClientOptions } from './mal/client.js';
export { mapMalEntry, type MapOptions } from './mal/map.js';
export { parseFavorites, type FavoritesPage } from './mal/parse.js';
export type { MalFavorite, MalListRow } from './mal/schemas.js';
export {
  buildImportPlan,
  unmatchedTitles,
  type BuildPlanInput,
  type ImportPlan,
  type ImportPlanRow,
} from './plan.js';
export { buildPlanReport, planReportCsv, type PlanReport, type PlanReportRow } from './report.js';
export {
  entryFromReportRow,
  replayImportReport,
  type ReplayOptions,
  type ReplayRun,
} from './replay.js';
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
  MAX_UNCERTAIN_CANDIDATES,
  UNCERTAIN_FLOOR,
  type UncertainCandidate,
  type UncertainMatch,
} from './uncertain.js';
export { mergeTraktRatings } from './trakt/adapter.js';
export { createTraktClient, type TraktClient, type TraktClientOptions } from './trakt/client.js';
export {
  mapTraktMovie,
  mapTraktSeason,
  mapTraktWatchlistMovie,
  readTraktScore,
  type MapOptions as TraktMapOptions,
  type TraktRow,
} from './trakt/map.js';
export type {
  TraktIds,
  TraktMovie,
  TraktProgressEpisode,
  TraktProgressSeason,
  TraktRating,
  TraktShow,
  TraktShowProgress,
  TraktWatchedEpisode,
  TraktWatchedMovie,
  TraktWatchedSeason,
  TraktWatchedShow,
  TraktWatchlistItem,
} from './trakt/schemas.js';
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
