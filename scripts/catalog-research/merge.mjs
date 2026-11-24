/**
 * `node scripts/catalog-research/merge.mjs [--apply]`
 *
 * Folds every valid `results/batch-*.json` into the seeds, in place.
 *
 * Dry run by default: it prints what would change. `--apply` rewrites each
 * touched seed atomically (temp file + rename) after dropping a timestamped
 * `.pre-research-*.bak` beside it, and writes `merge-report.json`.
 *
 * Placement rules learned from `link-adaptations.ts`:
 *   - a relation edge goes into EVERY seed that contains both endpoints, so the
 *     pair survives whichever file is seeded on its own;
 *   - when no single seed holds both (game ↔ movie, for example), the edge goes
 *     into the last-loaded seed, `top-series-tmdb.json`, because `seed-all-cli`
 *     resolves endpoints against the whole database at that point;
 *   - a row can live in two seeds (the AniList seeds each ship the other's
 *     kinds) and the seeder upserts every column, so a metadata edit is written
 *     to every copy — editing one is undone by the other.
 */
import { readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { RELATION_TYPES, validateResult } from './schema.mjs';

const SEED_DIR = resolve('apps/catalog/seed');
const RESEARCH_DIR = resolve(SEED_DIR, 'research');
const CARRIER_SEED = 'top-series-tmdb.json';
const STRONG = new Set(['sequel', 'adaptation', 'spinoff']);

const pairKey = (a, b) => [a, b].sort().join('|');

function setPath(row, path, value) {
  const parts = path.split('.');
  let target = row;
  for (const part of parts.slice(0, -1)) {
    if (target[part] == null || typeof target[part] !== 'object') target[part] = {};
    target = target[part];
  }
  target[parts.at(-1)] = value;
}

function getPath(row, path) {
  return path.split('.').reduce((value, part) => (value == null ? value : value[part]), row);
}

async function main() {
  const apply = process.argv.includes('--apply');
  // `--prune` makes the merge convergent rather than append-only: an edge the
  // pass added but no current result file claims any more (a batch re-answered
  // after the merge) is removed again. The baseline is the earliest
  // `.pre-research-*.bak`, so edges that predate the pass are never touched.
  const prune = process.argv.includes('--prune');
  const claimed = new Set();
  // Two batches can audit the same row and disagree (one files a one-line
  // synopsis, another the full one). Last-writer-wins would make every merge
  // re-apply both, so a text/list field keeps the RICHEST value and a scalar
  // field keeps the first — the loser is reported, never silently dropped.
  const proposals = new Map();
  const manifest = JSON.parse(await readFile(resolve(RESEARCH_DIR, 'manifest.json'), 'utf8'));

  const seeds = new Map();
  const homes = new Map();
  for (const name of manifest.seeds) {
    const data = JSON.parse(await readFile(resolve(SEED_DIR, name), 'utf8'));
    const index = new Map(data.catalog_media.map((row) => [row.id, row]));
    const edges = new Map();
    for (const edge of data.catalog_media_relation ?? []) {
      const key = pairKey(edge.fromId, edge.toId);
      if (!edges.has(key)) edges.set(key, []);
      edges.get(key).push(edge);
    }
    seeds.set(name, { data, index, edges, dirty: false });
    for (const row of data.catalog_media) {
      if (!homes.has(row.id)) homes.set(row.id, new Set());
      homes.get(row.id).add(name);
    }
  }

  const resultFiles = (await readdir(resolve(RESEARCH_DIR, 'results')))
    .filter((name) => name.endsWith('.json'))
    .sort();
  const batchCache = new Map();
  const loadBatch = async (batch) => {
    if (!batchCache.has(batch)) {
      batchCache.set(
        batch,
        JSON.parse(await readFile(resolve(RESEARCH_DIR, 'batches', `${batch}.json`), 'utf8')),
      );
    }
    return batchCache.get(batch);
  };

  const report = {
    appliedAt: apply ? new Date().toISOString() : null,
    results: { accepted: [], rejected: [] },
    links: { added: [], replaced: [], kept: [] },
    edits: [],
    editConflicts: [],
    duplicates: [],
    lowConfidence: [],
    unknownIds: [],
  };

  for (const name of resultFiles) {
    const result = JSON.parse(await readFile(resolve(RESEARCH_DIR, 'results', name), 'utf8'));
    const errors = validateResult(await loadBatch(result.batch), result);
    if (errors.length) {
      report.results.rejected.push({ file: name, errors: errors.slice(0, 10) });
      continue;
    }
    report.results.accepted.push(name);

    for (const verdict of result.verdicts) {
      if (verdict.duplicate) {
        report.duplicates.push({
          batch: result.batch,
          n: verdict.n,
          keepId: verdict.duplicate.keepId,
          dropId: verdict.duplicate.dropId,
          note: verdict.duplicate.note,
          source: verdict.duplicate.source,
        });
      }
      for (const edit of verdict.metadata ?? []) {
        const slot = `${edit.id}|${edit.path}`;
        const size = (value) => (Array.isArray(value) ? value.length : String(value ?? '').length);
        const richer = edit.path === 'description' || Array.isArray(edit.to);
        const previous = proposals.get(slot);
        if (previous) {
          // Same field, two audits. Collect first, apply once: a text/list
          // field keeps the richest value, a scalar keeps the first, and the
          // loser is reported. Applying inline made a merge re-apply both on
          // every run, so the seeds never reached a stable state.
          if (!richer || size(previous.to) >= size(edit.to)) {
            if (JSON.stringify(previous.to) !== JSON.stringify(edit.to)) {
              report.editConflicts.push({
                batch: result.batch,
                id: edit.id,
                path: edit.path,
                kept: previous.to,
                dropped: edit.to,
                source: edit.source,
              });
            }
            continue;
          }
          report.editConflicts.push({
            batch: previous.file.replace(/\.json$/, ''),
            id: edit.id,
            path: edit.path,
            kept: edit.to,
            dropped: previous.to,
            source: edit.source,
          });
        }
        proposals.set(slot, { ...edit, slot, file: name, n: verdict.n });
      }

      if (verdict.verdict !== 'linked') continue;
      const { fromId, toId, type } = verdict.link;
      if (!RELATION_TYPES.includes(type)) continue;
      if (verdict.link.confidence === 'low') {
        // An edge nobody states outright ("launched the same week, same leads")
        // is held back for review rather than published as fact.
        report.lowConfidence.push({
          batch: result.batch,
          n: verdict.n,
          ...verdict.link,
          reason: verdict.reason,
        });
        continue;
      }
      const key = pairKey(fromId, toId);
      claimed.add(`${key}|${type}`);

      const both = [...(homes.get(fromId) ?? [])].filter((seedName) =>
        homes.get(toId)?.has(seedName),
      );
      const targets = both.length ? both : [CARRIER_SEED];
      const existing = [];
      for (const seedName of seeds.keys()) {
        const edge = seeds.get(seedName).edges.get(key);
        if (edge) existing.push({ seedName, edge });
      }
      const strong = existing.find(({ edge }) => edge.some((e) => STRONG.has(e.type)));
      if (strong) {
        report.links.kept.push({
          pair: key,
          existing: strong.edge.map((e) => e.type),
          proposed: type,
          in: strong.seedName,
        });
        continue;
      }
      const weak = existing.flatMap(({ edge }) => edge).filter((e) => e.type === 'related');

      let changed = false;
      for (const seedName of targets) {
        const seed = seeds.get(seedName);
        if (seed.edges.get(key)?.some((e) => e.type === type)) continue;
        seed.data.catalog_media_relation ??= [];
        for (const edge of weak) {
          const at = seed.data.catalog_media_relation.indexOf(edge);
          if (at >= 0) seed.data.catalog_media_relation.splice(at, 1);
        }
        const edge = { fromId, toId, type };
        seed.data.catalog_media_relation.push(edge);
        seed.edges.set(key, [edge]);
        seed.dirty = true;
        changed = true;
        if (weak.length)
          report.links.replaced.push({ pair: key, type, over: 'related', in: seedName });
      }
      if (changed) {
        report.links.added.push({
          pair: key,
          type,
          from: `${verdict.n}:${fromId}`,
          to: toId,
          in: targets,
          batch: result.batch,
        });
      }
    }
  }

  for (const proposal of proposals.values()) {
    const copies = homes.get(proposal.id);
    if (!copies) {
      report.unknownIds.push({ file: proposal.file, id: proposal.id, path: proposal.path });
      continue;
    }
    for (const seedName of copies) {
      const seed = seeds.get(seedName);
      const row = seed.index.get(proposal.id);
      const before = getPath(row, proposal.path);
      if (JSON.stringify(before) === JSON.stringify(proposal.to)) continue;
      setPath(row, proposal.path, proposal.to);
      seed.dirty = true;
      report.edits.push({
        file: proposal.file,
        id: proposal.id,
        slug: proposal.n,
        seed: seedName,
        path: proposal.path,
        from: before === undefined ? null : before,
        to: proposal.to,
        source: proposal.source,
      });
    }
  }

  if (prune) {
    report.links.pruned = [];
    for (const [name, seed] of seeds) {
      const backups = (await readdir(SEED_DIR))
        .filter((file) => file.startsWith(`${name}.pre-research-`) && file.endsWith('.bak'))
        .sort();
      if (!backups.length) {
        report.links.pruned.push({ seed: name, skipped: 'no pre-research backup to diff against' });
        continue;
      }
      const baseline = new Set(
        (
          JSON.parse(await readFile(resolve(SEED_DIR, backups[0]), 'utf8'))
            .catalog_media_relation ?? []
        ).map((edge) => `${pairKey(edge.fromId, edge.toId)}|${edge.type}`),
      );
      const before = seed.data.catalog_media_relation?.length ?? 0;
      seed.data.catalog_media_relation = (seed.data.catalog_media_relation ?? []).filter((edge) => {
        const key = `${pairKey(edge.fromId, edge.toId)}|${edge.type}`;
        return baseline.has(key) || claimed.has(key);
      });
      const removed = before - seed.data.catalog_media_relation.length;
      if (removed) {
        seed.dirty = true;
        report.links.pruned.push({ seed: name, removed });
      }
    }
  }

  const summary = {
    batches: report.results.accepted.length,
    rejectedBatches: report.results.rejected.length,
    linksAdded: report.links.added.length,
    linksReplaced: report.links.replaced.length,
    linksKept: report.links.kept.length,
    linksPruned: (report.links.pruned ?? []).filter((entry) => entry.removed).length,
    metadataEdits: report.edits.length,
    editConflicts: report.editConflicts.length,
    duplicates: report.duplicates.length,
    lowConfidenceHeldBack: report.lowConfidence.length,
    unknownIds: report.unknownIds.length,
    dirtySeeds: [...seeds.entries()].filter(([, seed]) => seed.dirty).map(([name]) => name),
  };
  console.log(JSON.stringify(summary, null, 1));
  // Same-work pairs are the input to a dedup fold, not to the edge merge; keep
  // them in their own file so a later pass can act on them.
  if (report.duplicates.length) {
    await writeFile(
      resolve(RESEARCH_DIR, 'duplicates.json'),
      JSON.stringify(report.duplicates, null, 1),
    );
  }
  if (report.lowConfidence.length) {
    await writeFile(
      resolve(RESEARCH_DIR, 'low-confidence.json'),
      JSON.stringify(report.lowConfidence, null, 1),
    );
  }
  if (report.results.rejected.length) {
    console.error('rejected result files (fix and re-run, nothing from them was applied):');
    for (const rejected of report.results.rejected) {
      console.error(`  ${rejected.file}: ${rejected.errors[0]}`);
    }
  }

  if (!apply) {
    console.log('dry run — pass --apply to rewrite the seeds');
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  for (const [name, seed] of seeds) {
    if (!seed.dirty) continue;
    const path = resolve(SEED_DIR, name);
    const bytes = (await stat(path)).size;
    await writeFile(`${path}.pre-research-${stamp}.bak`, await readFile(path));
    const tmp = `${path}.tmp-${stamp}`;
    await writeFile(tmp, JSON.stringify(seed.data, null, 1));
    await rename(tmp, path);
    console.log(`rewrote ${name} (${bytes} bytes before backup)`);
  }
  // Cumulative, like dedup-log.json: a second (convergent) run must not erase
  // the record of what the first one wrote.
  let history = [];
  try {
    const previous = JSON.parse(await readFile(resolve(RESEARCH_DIR, 'merge-report.json'), 'utf8'));
    history = previous.runs ?? [];
  } catch {
    history = [];
  }
  const run = { ...report, summary, appliedAt: new Date().toISOString() };
  await writeFile(
    resolve(RESEARCH_DIR, 'merge-report.json'),
    JSON.stringify({ runs: [...history, run] }, null, 1),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
