/**
 * `node scripts/catalog-research/siblings.mjs [--apply]`
 *
 * One-time migration of the first batches onto the sibling rule.
 *
 * The brief originally told agents to REJECT two works that both adapt one
 * third work ("siblings": the Death Note manga's anime and its 2016 film). That
 * was too strict: neither adapts the other, so `adaptation` is wrong, but they
 * are the same story twice and `related` states exactly that — and it is the
 * edge that lets a reader cross from the manga to the film. The brief now says
 * `related`, confidence medium. This rewrites the already-answered batches so
 * the whole pass follows one rule.
 *
 * Only rejections whose reason names the shared source are converted, and only
 * when the verdict carries evidence (a link with no evidence is not publishable).
 * Homonyms, same-work duplicates and "unrelated" verdicts are left alone.
 */
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const RESEARCH_DIR = resolve('apps/catalog/seed/research');
const SIBLING =
  /sibling|both adapt|two adaptations|same source|adaptation of the same|both are adaptations|shared source|adapts the same/i;
const NOT_SIBLING = /homonym|unrelated|same work|duplicate|unverified/i;

async function main() {
  const apply = process.argv.includes('--apply');
  const files = (await readdir(resolve(RESEARCH_DIR, 'results'))).filter((n) =>
    n.endsWith('.json'),
  );
  let converted = 0;
  let skipped = 0;
  const samples = [];

  for (const file of files.sort()) {
    const path = resolve(RESEARCH_DIR, 'results', file);
    const result = JSON.parse(await readFile(path, 'utf8'));
    const batch = JSON.parse(
      await readFile(resolve(RESEARCH_DIR, 'batches', `${result.batch}.json`), 'utf8'),
    );
    const byNumber = new Map(batch.map((candidate) => [candidate.n, candidate]));
    let dirty = false;

    for (const verdict of result.verdicts) {
      if (verdict.verdict !== 'rejected') continue;
      const reason = verdict.reason ?? '';
      if (!SIBLING.test(reason) || NOT_SIBLING.test(reason)) continue;
      if (!verdict.evidence?.length) {
        skipped++;
        continue;
      }
      const candidate = byNumber.get(verdict.n);
      if (!candidate) continue;
      verdict.verdict = 'linked';
      verdict.converted = 'sibling';
      verdict.reason = `Both adapt one source (${reason.replace(/^siblings?[:,]?\s*/i, '').slice(0, 220)})`;
      verdict.link = {
        fromId: candidate.left.id,
        toId: candidate.right.id,
        type: 'related',
        confidence: 'medium',
        source: verdict.evidence[0],
      };
      converted++;
      dirty = true;
      if (samples.length < 12) {
        samples.push(
          `${result.batch} n=${verdict.n} ${candidate.left.slug} <-> ${candidate.right.slug}`,
        );
      }
    }

    if (dirty && apply) {
      await writeFile(`${path}.pre-siblings.bak`, await readFile(path));
      await writeFile(path, JSON.stringify(result, null, 1));
    }
  }

  console.log({ files: files.length, converted, skippedNoEvidence: skipped, applied: apply });
  for (const sample of samples) console.log(`  ${sample}`);
  if (!apply) console.log('dry run — pass --apply to rewrite the result files');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
