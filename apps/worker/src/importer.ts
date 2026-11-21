import type { Db } from '@trackt/db';
import {
  ImportError,
  ImportJobDataSchema,
  credentialsFromEnv,
  runImport as runImportImpl,
  toJobResult,
  updateImportRun,
  type ImportRunPatch,
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
  /** Writes the job's `import_run` row; tests inject a recorder. */
  runs?: ImportRunStore;
}

export interface ImportRunStore {
  update(runId: string, patch: ImportRunPatch): Promise<void>;
}

export function dbRunStore(db: Db): ImportRunStore {
  return {
    update: (runId, patch) => updateImportRun(db, runId, patch),
  };
}

/** A row write per applied entry would double the import's own write load. */
const PROGRESS_WRITE_MS = 2_000;

/** The slice of BullMQ's `Job` a processor touches. */
export interface ImportJobLike {
  id?: string | undefined;
  data: unknown;
  /** Attempts already failed before this one. */
  attemptsMade?: number;
  opts?: { attempts?: number | undefined };
  updateProgress(progress: ImportJobProgress): Promise<unknown>;
}

export type ImportProcessor = (job: ImportJobLike) => Promise<ImportJobResult>;

export function createImportProcessor({
  db,
  env,
  runImport = runImportImpl,
  runs = dbRunStore(db),
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
    const runId = data.runId;
    // The run row is a record, not the work: a failed write must not fail the import.
    const record = async (patch: ImportRunPatch) => {
      if (runId) await runs.update(runId, patch).catch(() => undefined);
    };
    await record({ state: 'running', startedAt: new Date(), errorKind: null, error: null });

    let progress: ImportJobProgress = { done: 0, total: 0 };
    let lastWrite = 0;
    // Awaited before the final write, so a slow progress write cannot land after it.
    let pendingWrite: Promise<void> = Promise.resolve();
    const report = (done: number, total: number) => {
      progress = { done, total };
      // Progress is a courtesy: a Redis hiccup must not abort an import that is
      // already writing rows.
      void job.updateProgress(progress).catch(() => undefined);
      const now = Date.now();
      if (now - lastWrite >= PROGRESS_WRITE_MS) {
        lastWrite = now;
        pendingWrite = record({ done, total });
      }
    };

    try {
      const run = await runImport(db, {
        userId: data.userId,
        source: data.source,
        profile: data.profile,
        ...(data.upload === undefined ? {} : { upload: data.upload }),
        credentials: credentialsFromEnv(env, data.source),
        ...(data.overwrite === undefined ? {} : { overwrite: data.overwrite }),
        ...(data.dryRun === undefined ? {} : { dryRun: data.dryRun }),
        ...(env.CATALOG_URL ? { catalogUrl: env.CATALOG_URL } : {}),
        onProgress: report,
      });
      const result = toJobResult(run);
      // A dry run applies nothing, so the hook above never fired.
      report(result.plan.total, result.plan.total);
      await pendingWrite;
      await record({
        state: 'completed',
        done: result.plan.total,
        total: result.plan.total,
        result: result as unknown as Record<string, unknown>,
        finishedAt: new Date(),
      });
      return result;
    } catch (error) {
      const kind = error instanceof ImportError ? error.kind : null;
      await pendingWrite;
      const final = (job.attemptsMade ?? 0) + 1 >= (job.opts?.attempts ?? 1);
      await record({
        // BullMQ retries a non-final failure, so the run is waiting again.
        state: final ? 'failed' : 'queued',
        errorKind: kind,
        error: error instanceof Error ? error.message : String(error),
        ...(final ? { finishedAt: new Date() } : {}),
      });
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
