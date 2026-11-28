import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MediaKindSchema } from '@trackt/shared';
import { z } from 'zod';
import { toError } from './http.js';
import { invalidateTracking } from './media.js';
import { http, useIsAuthed } from './runtime.js';

/**
 * Account imports (the `importer` queue's client half): what this instance can
 * read, a preview job, and the window into one job's progress.
 *
 * The shapes mirror `@trackt/imports`'s `job.ts` rather than importing it: this
 * package ships to both clients, and the pipeline package carries a database
 * driver and an optional browser. They are therefore parsed defensively — a
 * field a newer (or older) instance omits degrades to a zero or a null instead
 * of taking the whole screen down with it.
 */

export const IMPORT_JOB_STATES = [
  'waiting',
  'active',
  'delayed',
  'completed',
  'failed',
  'unknown',
] as const;

export const ImportJobStateSchema = z.enum(IMPORT_JOB_STATES);
export type ImportJobState = z.infer<typeof ImportJobStateSchema>;

export const ImportSourceStatusSchema = z.object({
  id: z.string(),
  label: z.string(),
  kinds: z.array(MediaKindSchema).default([]),
  /** `file`: the viewer uploads an export instead of naming a profile. */
  access: z.enum(['api', 'scrape', 'file']).catch('api'),
  requiresBrowser: z.boolean().default(false),
  available: z.boolean(),
  /** Why it is unavailable — the env var to set. Absent when available. */
  reason: z.string().optional(),
});
export type ImportSourceStatus = z.infer<typeof ImportSourceStatusSchema>;

export const ImportSourcesSchema = z.object({ sources: z.array(ImportSourceStatusSchema) });
export type ImportSources = z.infer<typeof ImportSourcesSchema>;

export const ImportQueuedSchema = z.object({
  jobId: z.string(),
  state: ImportJobStateSchema.catch('unknown'),
  /** The run's `import_run` row; null for a preview, or from an instance that keeps none. */
  runId: z.string().nullable().default(null),
});
export type ImportQueued = z.infer<typeof ImportQueuedSchema>;

const ImportUnmatchedEntrySchema = z.object({ externalId: z.string(), title: z.string() });

export const ImportPlanSummarySchema = z.object({
  source: z.string(),
  profile: z.string(),
  total: z.number().default(0),
  matched: z.number().default(0),
  unmatched: z.number().default(0),
  existing: z.number().default(0),
  pending: z.number().default(0),
  warnings: z.number().default(0),
  matchedByTitle: z.number().default(0),
  /** Unmatched entries kept for the viewer to settle on the matches page. */
  uncertain: z.number().default(0),
});
export type ImportPlanSummary = z.infer<typeof ImportPlanSummarySchema>;

export const ImportReportSchema = z.object({
  source: z.string(),
  profile: z.string(),
  created: z.number().default(0),
  updated: z.number().default(0),
  merged: z.number().default(0),
  skippedExisting: z.number().default(0),
  withProgress: z.number().default(0),
  ratings: z.number().default(0),
  warnings: z.array(z.unknown()).default([]),
  unmatched: z.array(ImportUnmatchedEntrySchema).default([]),
});
export type ImportReport = z.infer<typeof ImportReportSchema>;

export const ImportJobResultSchema = z.object({
  report: ImportReportSchema.nullable().default(null),
  plan: ImportPlanSummarySchema,
  unmatched: z
    .object({
      entries: z.array(ImportUnmatchedEntrySchema).default([]),
      truncated: z.boolean().default(false),
    })
    .default({ entries: [], truncated: false }),
});
export type ImportJobResult = z.infer<typeof ImportJobResultSchema>;

export const ImportJobStatusSchema = z.object({
  jobId: z.string(),
  state: ImportJobStateSchema.catch('unknown'),
  progress: z
    .object({ done: z.number().default(0), total: z.number().default(0) })
    .default({ done: 0, total: 0 }),
  /** The worker's summary once the job completes; null while it runs. */
  result: z
    .unknown()
    .nullish()
    .transform((value) => {
      const parsed = ImportJobResultSchema.safeParse(value);
      return parsed.success ? parsed.data : null;
    }),
  failedReason: z.string().nullable().default(null),
  /** The importer's own error kind, so a screen can say why rather than "failed". */
  errorKind: z.string().nullable().default(null),
});
export type ImportJobStatus = z.infer<typeof ImportJobStatusSchema>;

export const IMPORT_RUN_STATES = ['queued', 'running', 'completed', 'failed'] as const;
export type ImportRunState = (typeof IMPORT_RUN_STATES)[number];

/** One import as the instance recorded it; outlives the queue job behind it. */
export const ImportRunSchema = z.object({
  id: z.string(),
  source: z.string(),
  profile: z.string(),
  state: z.enum(IMPORT_RUN_STATES).catch('failed'),
  progress: z
    .object({ done: z.number().default(0), total: z.number().default(0) })
    .default({ done: 0, total: 0 }),
  result: z
    .unknown()
    .nullish()
    .transform((value) => {
      const parsed = ImportJobResultSchema.safeParse(value);
      return parsed.success ? parsed.data : null;
    }),
  errorKind: z.string().nullable().default(null),
  error: z.string().nullable().default(null),
  createdAt: z.string(),
  startedAt: z.string().nullable().default(null),
  finishedAt: z.string().nullable().default(null),
});
export type ImportRun = z.infer<typeof ImportRunSchema>;

export const ImportRunListSchema = z.object({ runs: z.array(ImportRunSchema) });

export const importSourcesKey = ['import:sources'] as const;
export const importRunsKey = ['import:runs'] as const;
/** Every job query, so a wizard can drop the whole family when it starts over. */
export const importJobsKey = ['import:job'] as const;
/**
 * Keyed by launch as well as job: re-running a source reuses its id, and the
 * poller must not read the previous run's terminal answer as the new one's.
 */
export const importJobKey = (jobId: string | null, attempt = 0) =>
  [...importJobsKey, jobId, attempt] as const;

/** How often a live job is re-read; BullMQ reports progress per applied row. */
const POLL_MS = 1_500;

/** A job this client is done with: no further poll would change the answer. */
export function isImportJobTerminal(state: ImportJobState): boolean {
  return state === 'completed' || state === 'failed' || state === 'unknown';
}

/** The four readings a screen branches on, once queue-specific states are folded. */
export type ImportJobPhase = 'queued' | 'running' | 'done' | 'failed' | 'unknown';

export function importJobPhase(state: ImportJobState): ImportJobPhase {
  switch (state) {
    case 'waiting':
    case 'delayed':
      return 'queued';
    case 'active':
      return 'running';
    case 'completed':
      return 'done';
    case 'failed':
      return 'failed';
    case 'unknown':
      return 'unknown';
  }
}

/**
 * A determinate percentage, or null when the job has not reported a total yet.
 * Null is the indeterminate bar: showing 0% for "we do not know" reads as
 * stalled, and showing a number nobody reported is a lie.
 */
export function importProgressPercent(progress: { done: number; total: number }): number | null {
  if (progress.total <= 0) return null;
  const percent = Math.round((progress.done / progress.total) * 100);
  return Math.min(100, Math.max(0, percent));
}

/**
 * What this instance can import. A 404 is not an error: an instance built
 * before these routes has no importers, which is the same screen as one whose
 * operator configured none.
 */
export async function fetchImportSources(): Promise<ImportSources> {
  try {
    const response = await http().get('me/import/sources', { throwHttpErrors: false });
    if (response.status === 404) return { sources: [] };
    if (!response.ok) throw new Error(`import sources responded ${response.status}`);
    return ImportSourcesSchema.parse(await response.json());
  } catch (error) {
    throw await toError(error, 'import sources');
  }
}

export function useImportSources() {
  const isAuthed = useIsAuthed();
  return useQuery({
    queryKey: importSourcesKey,
    queryFn: fetchImportSources,
    enabled: isAuthed,
    // Operator configuration changes on a deploy, not between two renders.
    staleTime: 5 * 60_000,
  });
}

/** An export file, read as text; a file source (`access: 'file'`) sends these instead of a profile. */
export interface ImportFileInput {
  name: string;
  content: string;
}

export interface StartImportInput {
  source: string;
  profile?: string;
  files?: ImportFileInput[];
  dryRun?: boolean;
  overwrite?: boolean;
}

/**
 * Enqueue an import. One job per (viewer, source) and per kind of run: asking
 * again while one is in flight joins it rather than starting a second scrape,
 * and a preview never swallows the real run it was previewing.
 */
export async function startImport(input: StartImportInput): Promise<ImportQueued> {
  try {
    const json = await http().post('me/import', { json: input }).json();
    return ImportQueuedSchema.parse(json);
  } catch (error) {
    throw await toError(error, 'import start');
  }
}

export function useStartImport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: startImport,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: importRunsKey }),
  });
}

/** The viewer's imports, newest first. An instance without the route reads as none. */
export async function fetchImportRuns(): Promise<ImportRun[]> {
  try {
    const response = await http().get('me/import/runs', { throwHttpErrors: false });
    if (response.status === 404) return [];
    if (!response.ok) throw new Error(`import runs responded ${response.status}`);
    return ImportRunListSchema.parse(await response.json()).runs;
  } catch (error) {
    throw await toError(error, 'import runs');
  }
}

/** Polls while any run is still queued or running. */
export function useImportRuns() {
  const isAuthed = useIsAuthed();
  return useQuery({
    queryKey: importRunsKey,
    queryFn: fetchImportRuns,
    enabled: isAuthed,
    refetchInterval: (query) => {
      if (query.state.status === 'error') return false;
      const live = query.state.data?.some(
        (run) => run.state === 'queued' || run.state === 'running',
      );
      return live ? POLL_MS : false;
    },
  });
}

/**
 * One job's state. Another viewer's job is a 404 by contract; it reads as
 * `unknown` here, because from this client's side a job it cannot see and a job
 * that has been reaped are the same thing: gone.
 */
export async function fetchImportJob(jobId: string): Promise<ImportJobStatus> {
  try {
    const response = await http().get(`me/import/${encodeURIComponent(jobId)}`, {
      throwHttpErrors: false,
    });
    if (response.status === 404) {
      return {
        jobId,
        state: 'unknown',
        progress: { done: 0, total: 0 },
        result: null,
        failedReason: null,
        errorKind: null,
      };
    }
    if (!response.ok) throw new Error(`import job responded ${response.status}`);
    return ImportJobStatusSchema.parse(await response.json());
  } catch (error) {
    throw await toError(error, 'import job');
  }
}

/**
 * Poll a job until it is terminal. `jobId === null` is the idle state — the
 * wizard has not started anything yet — and the query stays disabled rather
 * than fetching a path with "null" in it.
 *
 * `attempt` exists because a job id is stable per (viewer, source): asking the
 * same source again reuses it, and the cache must not answer the new run with
 * the old one's finished state.
 */
export function useImportJob(jobId: string | null, attempt = 0) {
  const isAuthed = useIsAuthed();
  return useQuery({
    queryKey: importJobKey(jobId, attempt),
    queryFn: () => fetchImportJob(jobId as string),
    enabled: isAuthed && jobId !== null,
    refetchInterval: (query) => {
      if (query.state.status === 'error') return false;
      const data = query.state.data;
      return data && isImportJobTerminal(data.state) ? false : POLL_MS;
    },
  });
}

/**
 * The latest run of each source, newest first: what a profile's import card
 * lists. Older runs of a source are history the viewer does not need there.
 */
export function latestRunPerSource(runs: readonly ImportRun[]): ImportRun[] {
  const seen = new Set<string>();
  const latest: ImportRun[] = [];
  for (const run of [...runs].sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
    if (seen.has(run.source)) continue;
    seen.add(run.source);
    latest.push(run);
  }
  return latest;
}

export const ImportMatchCandidateSchema = z.object({
  id: z.string(),
  title: z.string(),
  year: z.number().nullable().default(null),
  score: z.number().default(0),
  kind: MediaKindSchema.nullable().catch(null).default(null),
  slug: z.string().nullable().default(null),
  coverUrl: z.string().nullable().default(null),
  seasonNumber: z.number().nullable().default(null),
  inLog: z.boolean().default(false),
});
export type ImportMatchCandidate = z.infer<typeof ImportMatchCandidateSchema>;

/** A title an import could not decide on, and the works it might be. */
export const ImportMatchSchema = z.object({
  id: z.string(),
  source: z.string(),
  externalId: z.string(),
  kind: MediaKindSchema.catch('movie'),
  /** As the source wrote it — often in the viewer's language, not the catalog's. */
  title: z.string(),
  year: z.number().nullable().default(null),
  seasonNumber: z.number().nullable().default(null),
  status: z.string(),
  progress: z.number().default(0),
  startedAt: z.string().nullable().default(null),
  finishedAt: z.string().nullable().default(null),
  /** `tie`: several works answer to the name; `below-threshold`: one came close. */
  outcome: z.enum(['tie', 'below-threshold']).catch('below-threshold'),
  bestScore: z.number().default(0),
  candidates: z.array(ImportMatchCandidateSchema).default([]),
  createdAt: z.string(),
});
export type ImportMatch = z.infer<typeof ImportMatchSchema>;

export const ImportMatchListSchema = z.object({ matches: z.array(ImportMatchSchema) });

export const importMatchesKey = ['import:matches'] as const;

/** The viewer's open matches, closest call first. An instance without the route has none. */
export async function fetchImportMatches(): Promise<ImportMatch[]> {
  try {
    const response = await http().get('me/import/uncertain', { throwHttpErrors: false });
    if (response.status === 404) return [];
    if (!response.ok) throw new Error(`import matches responded ${response.status}`);
    return ImportMatchListSchema.parse(await response.json()).matches;
  } catch (error) {
    throw await toError(error, 'import matches');
  }
}

export function useImportMatches() {
  const isAuthed = useIsAuthed();
  return useQuery({ queryKey: importMatchesKey, queryFn: fetchImportMatches, enabled: isAuthed });
}

export type ResolveImportMatchInput =
  { id: string; action: 'pick'; mediaId: string } | { id: string; action: 'skip' };

export const ResolveImportMatchResultSchema = z.object({
  outcome: z.enum(['created', 'updated', 'merged', 'skipped']).catch('skipped'),
  mediaId: z.string().nullable().default(null),
});
export type ResolveImportMatchResult = z.infer<typeof ResolveImportMatchResultSchema>;

/** Answer one match: log the picked work from the import's entry, or skip the question. */
export async function resolveImportMatch(
  input: ResolveImportMatchInput,
): Promise<ResolveImportMatchResult> {
  const { id, ...body } = input;
  try {
    const json = await http()
      .post(`me/import/uncertain/${encodeURIComponent(id)}`, { json: body })
      .json();
    return ResolveImportMatchResultSchema.parse(json);
  } catch (error) {
    throw await toError(error, 'import match');
  }
}

/**
 * The list is not refetched on success: the page folds an answered row in
 * place, and a refetch would pull it out from under its UNDO. What a pick wrote
 * is tracking data, so those views are invalidated.
 */
export function useResolveImportMatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: resolveImportMatch,
    onSuccess: (_result, input) => {
      if (input.action === 'pick') void invalidateTracking(queryClient);
    },
  });
}
