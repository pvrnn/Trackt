import { z } from 'zod';
import type { ImportReport } from './apply.js';
import { ImportError, type ImportErrorKind } from './errors.js';
import type { ImportRun } from './run.js';
import { IMPORT_SOURCES } from './sources.js';
import type { ImportCredentials, ImportSource, ImportWarningCode } from './types.js';

/**
 * The `importer` queue's contract, declared once: the API produces it, the
 * worker consumes it, and the wizard reads the result back through the API.
 * Everything here crosses a Redis job, so it stays JSON-serialisable and small —
 * a plan of thousands of rows never travels, only its summary.
 */

const SOURCE_IDS = Object.keys(IMPORT_SOURCES) as [ImportSource, ...ImportSource[]];

/** The known sources, derived from the registry so a new one needs no change here. */
export const ImportSourceSchema = z.enum(SOURCE_IDS);

export interface ImportJobData {
  userId: string;
  source: ImportSource;
  profile: string;
  overwrite?: boolean;
  dryRun?: boolean;
}

const importJobData = z.object({
  userId: z.string().min(1),
  source: ImportSourceSchema,
  /** The provider username; a wizard passes what the viewer typed, trimmed. */
  profile: z.string().trim().min(1).max(100),
  overwrite: z.boolean().optional(),
  dryRun: z.boolean().optional(),
});

export const ImportJobDataSchema: z.ZodType<ImportJobData> = importJobData;

/** The API's body: the session supplies `userId`; `dryRun` asks for a preview. */
export const ImportRequestSchema = importJobData.omit({ userId: true });
export type ImportRequest = z.infer<typeof ImportRequestSchema>;

/**
 * One job per (viewer, source) and per kind of run, so a double-click joins the
 * job already in flight instead of starting a second scrape of the same
 * profile — while a preview and the import it previews stay two jobs, since the
 * first is discarded as soon as the viewer reads it.
 *
 * BullMQ refuses `:` in a custom id (it separates the Redis key's parts), so the
 * separator is `-`; neither a uuid nor a source id contains one alone.
 */
export function importJobId(userId: string, source: ImportSource, dryRun = false): string {
  return `${userId}-${source}${dryRun ? '-preview' : ''}`;
}

/** Rows applied / rows to apply. `errorKind` is how a failure's kind survives BullMQ. */
export interface ImportJobProgress {
  done: number;
  total: number;
  errorKind?: ImportErrorKind;
}

/** How many unmatched provider rows a job result carries; the report has them all. */
export const MAX_JOB_UNMATCHED = 100;

/** The plan the UI needs to render an outcome, without the rows behind it. */
export interface ImportPlanSummary {
  source: ImportSource;
  profile: string;
  total: number;
  matched: number;
  unmatched: number;
  existing: number;
  pending: number;
  /** Of `matched`, the rows the central catalog supplied. */
  fromCatalog: number;
  /** Matched rows the provider pinned as a favourite. */
  favourites: number;
  warnings: number;
  /** Entries that only matched through the title + year fallback. */
  matchedByTitle: number;
}

export interface ImportUnmatchedEntry {
  externalId: string;
  title: string;
}

export interface ImportJobResult {
  /** Null on a dry run. */
  report: ImportReport | null;
  plan: ImportPlanSummary;
  /** Provider rows this instance's catalog does not carry, capped at `MAX_JOB_UNMATCHED`. */
  unmatched: { entries: ImportUnmatchedEntry[]; truncated: boolean };
}

export function toJobResult(run: ImportRun): ImportJobResult {
  const { plan, report } = run;
  const missing = plan.rows
    .filter((row) => row.target === null)
    .map((row) => ({ externalId: row.entry.externalId, title: row.entry.title }));
  const entries = missing.slice(0, MAX_JOB_UNMATCHED);

  return {
    report,
    plan: {
      source: plan.source,
      profile: plan.profile,
      total: plan.summary.total,
      matched: plan.summary.matched,
      unmatched: plan.summary.unmatched,
      existing: plan.summary.existing,
      pending: plan.summary.pending,
      fromCatalog: plan.summary.fromCatalog,
      favourites: plan.summary.favourites,
      warnings: plan.summary.warnings,
      matchedByTitle: plan.rows.filter((row) => row.matchedBy === 'title').length,
    },
    unmatched: { entries, truncated: missing.length > entries.length },
  };
}

export const ImportWarningSchema = z.object({
  // Checked as a string rather than an enum: the codes are a closed set in this
  // package, but a client reading an older job must tolerate a newer one's.
  code: z.custom<ImportWarningCode>((value) => typeof value === 'string'),
  externalId: z.string().nullable(),
  title: z.string().nullable(),
  message: z.string(),
});

export const ImportReportSchema = z.object({
  source: ImportSourceSchema,
  profile: z.string(),
  created: z.number(),
  updated: z.number(),
  skippedExisting: z.number(),
  withProgress: z.number(),
  ratings: z.number(),
  favourites: z.number(),
  warnings: z.array(ImportWarningSchema),
  unmatched: z.array(z.object({ externalId: z.string(), title: z.string() })),
});

export const ImportPlanSummarySchema = z.object({
  source: ImportSourceSchema,
  profile: z.string(),
  total: z.number(),
  matched: z.number(),
  unmatched: z.number(),
  existing: z.number(),
  pending: z.number(),
  fromCatalog: z.number(),
  favourites: z.number(),
  warnings: z.number(),
  matchedByTitle: z.number(),
});

export const ImportJobResultSchema = z.object({
  report: ImportReportSchema.nullable(),
  plan: ImportPlanSummarySchema,
  unmatched: z.object({
    entries: z.array(z.object({ externalId: z.string(), title: z.string() })),
    truncated: z.boolean(),
  }),
});

/** The env var each credential field is filled from. */
const CREDENTIAL_FIELDS = {
  MAL_CLIENT_ID: 'malClientId',
  TRAKT_CLIENT_ID: 'traktClientId',
} as const;

/** The slice of the environment credentials are read from: `loadEnv()` and `process.env` both fit. */
export type ImportCredentialEnv = Partial<Record<keyof typeof CREDENTIAL_FIELDS, string>>;

/**
 * Credentials for one source. Throws `ImportError('credential')` naming the
 * missing variable — an instance's configuration is the operator's to fix, and
 * the name is the only thing safe to report.
 */
export function credentialsFromEnv(
  env: ImportCredentialEnv,
  source: ImportSource,
): ImportCredentials {
  const definition = IMPORT_SOURCES[source];
  if (!definition.credential) return {};

  const name = definition.credential.env as keyof ImportCredentialEnv;
  const value = env[name];
  if (!value) {
    throw new ImportError(
      `${name} is not set on this instance — ${definition.credential.hint}`,
      'credential',
    );
  }

  const credentials: ImportCredentials = {};
  credentials[CREDENTIAL_FIELDS[name]] = value;
  return credentials;
}
