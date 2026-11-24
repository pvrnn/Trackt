/**
 * `node scripts/catalog-research/check.mjs <result.json> [<batch.json>]`
 *
 * Validates one research result file against its batch. Run it before handing a
 * batch back: the merge pass refuses a file this rejects, and a partial answer
 * (not every candidate covered) counts as a rejection of the whole file.
 *
 * The batch is inferred from the result's `batch` field when omitted.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { validateResult } from './schema.mjs';

const RESEARCH_DIR = resolve('apps/catalog/seed/research');

async function main() {
  const [resultPath, batchPath] = process.argv.slice(2);
  if (!resultPath) {
    console.error('usage: check.mjs <result.json> [<batch.json>]');
    process.exit(2);
  }
  const result = JSON.parse(await readFile(resolve(resultPath), 'utf8'));
  const batchFile = batchPath ?? resolve(RESEARCH_DIR, 'batches', `${result.batch}.json`);
  const batch = JSON.parse(await readFile(resolve(batchFile), 'utf8'));

  const errors = validateResult(batch, result);
  const linked = (result.verdicts ?? []).filter((v) => v.verdict === 'linked').length;
  const edits = (result.verdicts ?? []).reduce((sum, v) => sum + (v.metadata?.length ?? 0), 0);
  if (errors.length) {
    console.error(`${errors.length} problem(s) in ${resultPath}`);
    for (const error of errors.slice(0, 40)) console.error(`  - ${error}`);
    process.exit(1);
  }
  console.log(
    `ok: ${result.batch} — ${result.verdicts.length}/${batch.length} answered, ` +
      `${linked} linked, ${result.verdicts.length - linked} rejected, ${edits} metadata edit(s)`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
