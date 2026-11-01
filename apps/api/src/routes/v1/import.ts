import { and, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { importMatch } from '@trackt/db';
import { ApiErrorSchema, MediaKindSchema } from '@trackt/shared';
import {
  IMPORT_SOURCES,
  ImportError,
  ImportJobDataSchema,
  ImportJobResultSchema,
  ImportRequestSchema,
  UncertainMatchListSchema,
  credentialsFromEnv,
  importJobId,
  type ImportJobData,
  type ImportJobResult,
  type ImportSource,
} from '@trackt/imports';
import { getSessionUser } from '../../lib/session.js';

/**
 * Account imports (PRD §6): the producer half of the `importer` queue.
 *
 * The pipeline itself lives in `@trackt/imports` and the worker drives it, so
 * these routes do three things — say what this instance can import, enqueue one
 * job per (viewer, source) and kind of run, and report that job's state.
 *
 * Nothing here reads a provider. That is what keeps a slow scrape off the
 * request path, and it is why a missing credential is refused here (409) instead
 * of failing minutes later inside the worker.
 */

const JOB_STATES = ['waiting', 'active', 'completed', 'failed', 'delayed', 'unknown'] as const;
const ImportJobStateSchema = z.enum(JOB_STATES);
type ImportJobState = (typeof JOB_STATES)[number];

const ImportQueuedSchema = z.object({ jobId: z.string(), state: ImportJobStateSchema });

const ImportSourceStatusSchema = z.object({
  id: z.string(),
  label: z.string(),
  kinds: z.array(MediaKindSchema),
  access: z.enum(['api', 'scrape']),
  requiresBrowser: z.boolean(),
  available: z.boolean(),
  /** Why it is unavailable — the env var to set, never a value. */
  reason: z.string().optional(),
});

const ImportSourcesSchema = z.object({ sources: z.array(ImportSourceStatusSchema) });

const ImportJobStatusSchema = z.object({
  jobId: z.string(),
  state: ImportJobStateSchema,
  progress: z.object({ done: z.number(), total: z.number() }),
  /** The job's result once it completes; null while it runs. */
  result: ImportJobResultSchema.nullable(),
  failedReason: z.string().nullable(),
  /** `ImportError.kind` when the import itself failed, so a client can say why. */
  errorKind: z.string().nullable(),
});

function normalizeState(state: string): ImportJobState {
  return (JOB_STATES as readonly string[]).includes(state) ? (state as ImportJobState) : 'unknown';
}

/** BullMQ progress is `0` until the processor reports, and an object afterwards. */
function readProgress(value: unknown): { done: number; total: number; errorKind: string | null } {
  if (typeof value !== 'object' || value === null) return { done: 0, total: 0, errorKind: null };
  const record = value as Record<string, unknown>;
  return {
    done: typeof record.done === 'number' ? record.done : 0,
    total: typeof record.total === 'number' ? record.total : 0,
    errorKind: typeof record.errorKind === 'string' ? record.errorKind : null,
  };
}

/** The worker writes the pipeline's own result, so a stale or foreign shape is reported as absent. */
function readResult(value: unknown): ImportJobResult | null {
  const parsed = ImportJobResultSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function jobOwner(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null;
  const owner = (data as { userId?: unknown }).userId;
  return typeof owner === 'string' ? owner : null;
}

/** A source the operator can actually run on this instance, or the reason they cannot. */
function sourceStatus(
  id: ImportSource,
  env: { IMPORT_FETCH_MODE?: string | undefined },
  credentialError: string | null,
): z.infer<typeof ImportSourceStatusSchema> {
  const definition = IMPORT_SOURCES[id];
  const base = {
    id: definition.id,
    label: definition.label,
    kinds: [...definition.kinds],
    access: definition.access,
    requiresBrowser: definition.browser !== undefined,
  };

  if (credentialError !== null) {
    return { ...base, available: false, reason: credentialError };
  }
  // Only a source HTTP is known to be refused for is blocked on the mode; one
  // that offers a browser path as an option still runs without it.
  if (definition.browser === 'required' && (env.IMPORT_FETCH_MODE ?? 'http') === 'http') {
    return {
      ...base,
      available: false,
      reason:
        'IMPORT_FETCH_MODE=browser or fallback is required for this source (it sits behind a Cloudflare challenge)',
    };
  }
  return { ...base, available: true };
}

export const importRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/me/import/sources',
    {
      schema: {
        tags: ['imports'],
        response: { 200: ImportSourcesSchema, 401: ApiErrorSchema },
      },
    },
    async (request, reply) => {
      const user = await getSessionUser(app, request);
      if (!user) return reply.status(401).send({ error: 'authentication required' });

      const sources = (Object.keys(IMPORT_SOURCES) as ImportSource[]).map((id) => {
        try {
          credentialsFromEnv(app.deps.env, id);
        } catch (error) {
          if (error instanceof ImportError) return sourceStatus(id, app.deps.env, error.message);
          throw error;
        }
        return sourceStatus(id, app.deps.env, null);
      });

      return { sources };
    },
  );

  app.post(
    '/me/import',
    {
      schema: {
        tags: ['imports'],
        body: ImportRequestSchema,
        response: {
          202: ImportQueuedSchema,
          400: ApiErrorSchema,
          401: ApiErrorSchema,
          409: ApiErrorSchema,
          503: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const queue = app.deps.importQueue;
      if (!queue) return reply.status(503).send({ error: 'import queue unavailable' });
      const user = await getSessionUser(app, request);
      if (!user) return reply.status(401).send({ error: 'authentication required' });

      const { source, profile, overwrite, dryRun } = request.body;

      // Refuse at the door rather than after the job has been claimed and failed:
      // the operator can fix this, the viewer cannot.
      try {
        credentialsFromEnv(app.deps.env, source);
      } catch (error) {
        if (error instanceof ImportError) return reply.status(409).send({ error: error.message });
        throw error;
      }

      const data: ImportJobData = ImportJobDataSchema.parse({
        userId: user.id,
        source,
        profile,
        ...(overwrite === undefined ? {} : { overwrite }),
        ...(dryRun === undefined ? {} : { dryRun }),
      });
      // A preview is not the run it previews: distinct ids keep one from
      // joining (and swallowing) the other in the queue.
      const jobId = importJobId(user.id, source, dryRun ?? false);

      const existing = await queue.getJob(jobId);
      if (existing) {
        const state = normalizeState(await existing.getState());
        // Waiting, running or scheduled: this IS the job the viewer meant.
        if (state !== 'completed' && state !== 'failed' && state !== 'unknown') {
          return reply.status(202).send({ jobId, state });
        }
        // Finished jobs keep their id forever (BullMQ retains them so the result
        // can be read), so a re-run has to clear the id before re-adding it.
        await existing.remove();
      }

      const job = await queue.add('import', data, {
        jobId,
        attempts: 2,
        backoff: { type: 'exponential', delay: 10_000 },
      });
      return reply
        .status(202)
        .send({ jobId: job.id ?? jobId, state: normalizeState(await job.getState()) });
    },
  );

  /**
   * What the imports could not settle: a work that scored in the uncertain band,
   * or several rows that scored alike (see `import_match`). The pipeline stores
   * them; a client asks the viewer which row it is and writes the log from the
   * `entry` the row carries.
   */
  app.get(
    '/me/import/uncertain',
    {
      schema: {
        tags: ['imports'],
        response: {
          200: UncertainMatchListSchema,
          401: ApiErrorSchema,
          503: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const db = app.deps.db;
      if (!db) return reply.status(503).send({ error: 'database unavailable' });
      const user = await getSessionUser(app, request);
      if (!user) return reply.status(401).send({ error: 'authentication required' });

      const rows = await db
        .select()
        .from(importMatch)
        .where(and(eq(importMatch.userId, user.id), isNull(importMatch.resolvedAt)))
        // Closest call first: that is the one worth answering.
        .orderBy(desc(importMatch.bestScore), desc(importMatch.createdAt))
        .limit(200);

      return {
        matches: rows.map((row) => ({
          id: row.id,
          // The column is text (a new source must not need a migration); the
          // contract is the registry's closed set.
          source: row.source as ImportSource,
          externalId: row.externalId,
          kind: row.kind,
          title: row.title,
          year: row.year,
          seasonNumber: row.seasonNumber,
          status: row.status,
          outcome: row.outcome,
          bestScore: row.bestScore,
          candidates: row.candidates,
          createdAt: row.createdAt.toISOString(),
        })),
      };
    },
  );

  app.get(
    '/me/import/:jobId',
    {
      schema: {
        tags: ['imports'],
        params: z.object({ jobId: z.string().min(1) }),
        response: {
          200: ImportJobStatusSchema,
          401: ApiErrorSchema,
          404: ApiErrorSchema,
          503: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const queue = app.deps.importQueue;
      if (!queue) return reply.status(503).send({ error: 'import queue unavailable' });
      const user = await getSessionUser(app, request);
      if (!user) return reply.status(401).send({ error: 'authentication required' });

      const jobId = request.params.jobId;
      const job = await queue.getJob(jobId);
      if (!job) {
        return {
          jobId,
          state: 'unknown' as const,
          progress: { done: 0, total: 0 },
          result: null,
          failedReason: null,
          errorKind: null,
        };
      }
      // 404, not 403: another viewer's job must be indistinguishable from one that
      // never existed.
      if (jobOwner(job.data) !== user.id) {
        return reply.status(404).send({ error: 'import job not found' });
      }

      const state = normalizeState(await job.getState());
      const progress = readProgress(job.progress);

      return {
        jobId: job.id ?? jobId,
        state,
        progress: { done: progress.done, total: progress.total },
        result: state === 'completed' ? readResult(job.returnvalue) : null,
        failedReason: state === 'failed' ? job.failedReason : null,
        errorKind: state === 'failed' ? progress.errorKind : null,
      };
    },
  );
};
