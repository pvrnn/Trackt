import { eq } from 'drizzle-orm';
import { importRun, type Db } from '@trackt/db';

/** The fields a worker moves on an `import_run` row as its job progresses. */
export type ImportRunPatch = Partial<
  Pick<
    typeof importRun.$inferInsert,
    'state' | 'done' | 'total' | 'result' | 'errorKind' | 'error' | 'startedAt' | 'finishedAt'
  >
>;

export async function updateImportRun(db: Db, runId: string, patch: ImportRunPatch): Promise<void> {
  await db.update(importRun).set(patch).where(eq(importRun.id, runId));
}
