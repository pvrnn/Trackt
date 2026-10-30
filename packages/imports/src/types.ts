import type { ExternalIds, LogStatus, MediaKind } from '@trackt/shared';
import type { FetchLike, PageFetcher } from './http/fetch.js';

/**
 * Account imports: taking a user's list *off* another tracker and writing it
 * into their Trackt log. Catalog population is a different pipeline entirely
 * (`scripts/*-scrape` + `apps/catalog`) — nothing here publishes media, and a
 * row the catalog does not carry is reported, never invented.
 */
export type ImportSource = 'mal' | 'anilist' | 'letterboxd';

/** The media kinds an import can target — the catalog's own vocabulary, not a source's. */
export type ImportKind = MediaKind;

/** One provider row, already normalised into Trackt's vocabulary. */
export interface ImportEntry {
  source: ImportSource;
  kind: ImportKind;
  /** Provider id, stringified: MAL's numeric id, an AniList id, a Letterboxd slug. */
  externalId: string;
  /** Provider title, for the report; never written to the catalog. */
  title: string;
  year: number | null;
  /** ADR-0003: a series row is one season, so a per-season source names which. */
  seasonNumber: number | null;
  status: LogStatus;
  /** 0–10, null when unscored. The mapper converts from the provider's scale. */
  score: number | null;
  /** Episodes or chapters the account says are seen. */
  progress: number;
  repeats: number;
  /** `YYYY-MM-DD`; null when the provider has none or only a partial date. */
  startedAt: string | null;
  finishedAt: string | null;
  notes: string | null;
  /** Provider ids harvested while fetching; the resolver walks these first. */
  externalIds: ExternalIds;
}

export type ImportWarningCode =
  /** A status word the mapper does not know — the row is skipped, not guessed at. */
  | 'unknown-status'
  | 'score-invalid'
  /** The provider gave `YYYY` or `YYYY-MM`; a log date is a day (ADR-0007). */
  | 'partial-date'
  | 'future-date'
  | 'finish-before-start'
  /** Manga progress given only in volumes; chapters are what Trackt tracks. */
  | 'volume-only-progress'
  | 'progress-clamped'
  /** Two local rows claim the same provider id. */
  | 'duplicate-external-id'
  /** The title fallback found more than one local row: an import does not guess. */
  | 'ambiguous-title-match'
  /** The provider row cannot be read at all (it names no work). */
  | 'malformed-row'
  /** One of the source's lists could not be read; the rest of the import stands. */
  | 'partial-source';

export interface ImportWarning {
  code: ImportWarningCode;
  externalId: string | null;
  title: string | null;
  message: string;
}

export function warning(
  code: ImportWarningCode,
  row: { externalId: string | null; title: string | null },
  message: string,
): ImportWarning {
  return { code, externalId: row.externalId, title: row.title, message };
}

/**
 * Credentials resolved from env by the caller (CLI, worker) — never read here, so
 * a job carries what it needs and the pipeline stays testable.
 */
export interface ImportCredentials {
  malClientId?: string;
}

export interface FetchEntriesOptions {
  /** The provider username whose list is read. */
  profile: string;
  credentials: ImportCredentials;
  /** Injected clock, so date rules are testable. */
  now?: Date;
  /** Injected transport, so tests need no network. */
  fetch?: FetchLike;
  baseUrl?: string;
  requestSpacingMs?: number;
  /** Injected page transport for the scrape sources, so tests need no network. */
  fetcher?: PageFetcher;
  /** Scrape sources: read each work's own page for its provider ids. */
  enrichFilmPages?: boolean;
  /** Hard cap on those per-work requests (default 200). */
  maxEnrich?: number;
}

/** One source's fetch + map half: provider rows in, Trackt entries out. */
export interface FetchedEntries {
  entries: ImportEntry[];
  /** Mapper warnings, keyed by `entryKey`. */
  entryWarnings: Map<string, ImportWarning[]>;
  /** Warnings for rows the mapper refused — no plan row exists to carry them. */
  warnings: ImportWarning[];
}
