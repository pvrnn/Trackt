import type { LogStatus } from '@trackt/shared';

/**
 * Account imports: taking a user's list *off* another tracker and writing it
 * into their Trackt log. Catalog population is a different pipeline entirely
 * (`scripts/*-scrape` + `apps/catalog`) — nothing here publishes media, and a
 * row the catalog does not carry is reported, never invented.
 */
export type ImportSource = 'mal';

/** Which of MAL's two lists an entry came from. They are separate id namespaces. */
export type ImportKind = 'anime' | 'manga';

/** One provider row, already normalised into Trackt's vocabulary. */
export interface ImportEntry {
  source: ImportSource;
  kind: ImportKind;
  /** Provider id — the MAL anime id or manga id. */
  externalId: number;
  /** Provider title, for the report; never written to the catalog. */
  title: string;
  status: LogStatus;
  /** 0–10, null when unscored. MAL's 0 means "not scored". */
  score: number | null;
  /** Episodes or chapters the account says are seen. */
  progress: number;
  repeats: number;
  /** `YYYY-MM-DD`; null when the provider has none or only a partial date. */
  startedAt: string | null;
  finishedAt: string | null;
  notes: string | null;
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
  | 'duplicate-external-id';

export interface ImportWarning {
  code: ImportWarningCode;
  externalId: number | null;
  title: string | null;
  message: string;
}

export function warning(
  code: ImportWarningCode,
  row: { externalId: number | null; title: string | null },
  message: string,
): ImportWarning {
  return { code, externalId: row.externalId, title: row.title, message };
}
