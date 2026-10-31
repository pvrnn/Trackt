import type { Db } from '@trackt/db';
import {
  ImportError,
  ImportJobDataSchema,
  credentialsFromEnv,
  runImport as runImportImpl,
  toJobResult,
  type ImportCredentialEnv,
  type ImportJobProgress,
  type ImportJobResult,
} from '@trackt/imports';

/**
 * The consumer side of the `importer` queue: one job in, one report out.
 *
 * Split from the `Worker` construction so the wiring is testable with a fake job
 * and a stubbed pipeline — no Redis, no provider, no database.
 */

/** The pipeline's entry point, injected by tests. */
export type RunImportFn = typeof runImportImpl;

export interface ImportProcessorDeps {
  db: Db;
  /** Read for credentials and the catalog URL; the fetcher reads `IMPORT_FETCH_MODE`. */
  env: ImportCredentialEnv & { CATALOG_URL?: string | undefined };
  runImport?: RunImportFn;
}

/** The slice of BullMQ's `Job` a processor touches. */
export interface ImportJobLike {
  id?: string | undefined;
  data: unknown;
  updateProgress(progress: ImportJobProgress): Promise<unknown>;
}

export type ImportProcessor = (job: ImportJobLike) => Promise<ImportJobResult>;

export function createImportProcessor({
  db,
  env,
  runImport = runImportImpl,
}: ImportProcessorDeps): ImportProcessor {
  return async (job) => {
    const parsed = ImportJobDataSchema.safeParse(job.data);
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map((issue) => `${issue.path.join('.') || 'job'} ${issue.message}`)
        .join('; ');
      throw new ImportError(`invalid import job: ${detail}`, 'malformed');
    }
    const data = parsed.data;

    let progress: ImportJobProgress = { done: 0, total: 0 };
    const report = (done: number, total: number) => {
      progress = { done, total };
      // Progress is a courtesy: a Redis hiccup must not abort an import that is
      // already writing rows.
      void job.updateProgress(progress).catch(() => undefined);
    };

    try {
      const run = await runImport(db, {
        userId: data.userId,
        source: data.source,
        profile: data.profile,
        credentials: credentialsFromEnv(env, data.source),
        ...(data.overwrite === undefined ? {} : { overwrite: data.overwrite }),
        ...(data.dryRun === undefined ? {} : { dryRun: data.dryRun }),
        ...(env.CATALOG_URL ? { catalogUrl: env.CATALOG_URL } : {}),
        onProgress: report,
      });
      const result = toJobResult(run);
      // A dry run applies nothing, so the hook above never fired.
      report(result.plan.total, result.plan.total);
      return result;
    } catch (error) {
      const kind = error instanceof ImportError ? error.kind : null;
      if (kind !== null) {
        // BullMQ keeps a failed job's message but not its error class, and
        // progress is the only field the API can read back — so the importer's
        // own kind rides there, for the client to render as "private", not "failed".
        await job.updateProgress({ ...progress, errorKind: kind }).catch(() => undefined);
      }
      throw error;
    }
  };
}
