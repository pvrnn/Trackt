/**
 * `node scripts/catalog-research/status.mjs`
 *
 * Progress across the research pass: which batches are answered, how many pairs
 * were linked by type, how many metadata edits are pending. Reads only the
 * result files; validates nothing beyond their shape, so it is safe to run while
 * agents are still writing.
 */
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const RESEARCH_DIR = resolve('apps/catalog/seed/research');

async function main() {
  const manifest = JSON.parse(await readFile(resolve(RESEARCH_DIR, 'manifest.json'), 'utf8'));
  const files = (await readdir(resolve(RESEARCH_DIR, 'results'))).filter((n) =>
    n.endsWith('.json'),
  );
  const totals = { answered: 0, linked: 0, rejected: 0, edits: 0, batches: 0 };
  const byType = {};
  const rows = [];

  for (const file of files.sort()) {
    let result;
    try {
      result = JSON.parse(await readFile(resolve(RESEARCH_DIR, 'results', file), 'utf8'));
    } catch {
      rows.push({ batch: file.replace('.json', ''), state: 'unparseable' });
      continue;
    }
    const verdicts = result.verdicts ?? [];
    const linked = verdicts.filter((v) => v.verdict === 'linked');
    const edits = verdicts.reduce((sum, v) => sum + (v.metadata?.length ?? 0), 0);
    for (const verdict of linked)
      byType[verdict.link?.type] = (byType[verdict.link?.type] ?? 0) + 1;
    totals.batches++;
    totals.answered += verdicts.length;
    totals.linked += linked.length;
    totals.rejected += verdicts.length - linked.length;
    totals.edits += edits;
    rows.push({
      batch: result.batch ?? file.replace('.json', ''),
      answered: verdicts.length,
      linked: linked.length,
      rejected: verdicts.length - linked.length,
      edits,
    });
  }

  console.table(rows.slice(-15));
  console.log({
    ...totals,
    candidates: manifest.candidates,
    batchesTotal: manifest.batches,
    batchesPending: manifest.batches - totals.batches,
    coverage: `${((totals.answered / manifest.candidates) * 100).toFixed(1)}%`,
    byType,
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
