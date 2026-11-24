/**
 * `node scripts/catalog-research/apply-patch.mjs [--patch <file>] [--seeds <dir>] [--apply]`
 *
 * Replays `research-patch.json` onto a (re)built seed set. The patch is keyed by
 * canonical media id — the UUIDv5 derived from the provider id — so it survives
 * a re-scrape: titles, counts and artwork can all change while the id stays put.
 *
 * It is a three-way merge, not a blind overwrite. For each edit it compares the
 * seed's current value against the value the research pass saw BEFORE it
 * corrected the row:
 *
 *   current == to          already applied, nothing to do
 *   current == from        untouched since the pass → write `to`
 *   from is empty, current empty   a fill-in edit (null → text) → write `to`
 *   anything else          the new scrape changed this field → KEEP the scrape,
 *                          report a conflict. A fresh scrape is newer evidence
 *                          than a one-off audit, so it wins by default.
 *
 * Edges are added unless the pair already carries an equal or stronger claim
 * (`sequel`/`adaptation`/`spinoff` beat `related`); conflicting strong claims
 * are reported rather than overwritten. Dry run unless `--apply`.
 */
import { readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const SEEDS = [
  'top-anime-anilist.json',
  'top-manga-anilist.json',
  'top-games-igdb.json',
  'top-movies-tmdb.json',
  'top-series-tmdb.json',
];
const CARRIER = 'top-series-tmdb.json';
const STRONG = new Set(['sequel', 'adaptation', 'spinoff']);
const pairKey = (a, b) => [a, b].sort().join('|');

const getPath = (row, path) =>
  path.split('.').reduce((value, part) => (value == null ? value : value[part]), row);
function setPath(row, path, value) {
  const parts = path.split('.');
  let target = row;
  for (const part of parts.slice(0, -1)) {
    if (target[part] == null || typeof target[part] !== 'object') target[part] = {};
    target = target[part];
  }
  target[parts.at(-1)] = value;
}
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const isEmpty = (value) => value == null || value === '' || (Array.isArray(value) && !value.length);
const argValue = (argv, flag) => {
  const at = argv.indexOf(flag);
  return at >= 0 ? argv[at + 1] : undefined;
};

async function main() {
  const argv = process.argv.slice(2);
  const apply = argv.includes('--apply');
  const seedDir = resolve(argValue(argv, '--seeds') ?? 'apps/catalog/seed');
  const patchPath = resolve(
    argValue(argv, '--patch') ?? 'scripts/catalog-research/research-patch.json',
  );
  const patch = JSON.parse(await readFile(patchPath, 'utf8'));

  const seeds = new Map();
  for (const name of SEEDS) {
    let data;
    try {
      data = JSON.parse(await readFile(resolve(seedDir, name), 'utf8'));
    } catch {
      continue;
    }
    seeds.set(name, {
      data,
      index: new Map(data.catalog_media.map((row) => [row.id, row])),
      dirty: false,
    });
  }
  const homes = new Map();
  for (const [name, seed] of seeds) {
    for (const row of seed.data.catalog_media) {
      if (!homes.has(row.id)) homes.set(row.id, []);
      homes.get(row.id).push(name);
    }
  }
  const edgesOf = (key) => {
    const found = [];
    for (const [name, seed] of seeds) {
      for (const edge of seed.data.catalog_media_relation ?? []) {
        if (pairKey(edge.fromId, edge.toId) === key) found.push({ name, seed, edge });
      }
    }
    return found;
  };

  const report = {
    patch: patchPath,
    generatedAt: patch.generatedAt,
    edits: { applied: [], already: 0, conflicts: [], missingRow: [] },
    edges: { applied: [], already: 0, replaced: [], conflicts: [], missingEndpoint: [] },
    seeds: [...seeds.keys()],
  };

  for (const edit of patch.edits) {
    const copies = homes.get(edit.id);
    if (!copies) {
      report.edits.missingRow.push({ id: edit.id, path: edit.path, to: edit.to });
      continue;
    }
    // The AniList seeds ship each other's rows from different scrape snapshots,
    // so one copy can hold the pre-pass value while its twin holds another. The
    // edit is legitimate if ANY copy still shows what the pass corrected; the
    // write then goes to every copy, which is what keeps the seeds agreeing.
    const values = copies.map((name) => getPath(seeds.get(name).index.get(edit.id), edit.path));
    if (values.every((value) => same(value, edit.to))) {
      report.edits.already++;
      continue;
    }
    const acceptable = (value) => same(value, edit.from) || (isEmpty(edit.from) && isEmpty(value));
    if (!values.some(acceptable)) {
      report.edits.conflicts.push({
        id: edit.id,
        path: edit.path,
        seedValue: values.length === 1 ? values[0] : values,
        patch: edit.to,
        source: edit.source,
      });
      continue;
    }
    const current = values.find(acceptable);
    for (const name of copies) {
      const seed = seeds.get(name);
      setPath(seed.index.get(edit.id), edit.path, edit.to);
      seed.dirty = true;
    }
    report.edits.applied.push({ id: edit.id, path: edit.path, from: current, to: edit.to });
  }

  for (const edge of patch.edges) {
    const known = homes.has(edge.fromId) && homes.has(edge.toId);
    if (!known) {
      report.edges.missingEndpoint.push({
        fromId: edge.fromId,
        toId: edge.toId,
        type: edge.type,
      });
      continue;
    }
    const key = pairKey(edge.fromId, edge.toId);
    const existing = edgesOf(key);
    if (existing.some(({ edge: found }) => found.type === edge.type)) {
      report.edges.already++;
      continue;
    }
    const strong = existing.filter(({ edge: found }) => STRONG.has(found.type));
    if (strong.length && !STRONG.has(edge.type)) {
      report.edges.already++;
      continue;
    }
    if (strong.length) {
      report.edges.conflicts.push({
        pair: key,
        existing: strong.map((s) => s.edge.type),
        patch: edge.type,
      });
      continue;
    }
    const both = homes.get(edge.fromId).filter((name) => homes.get(edge.toId).includes(name));
    const targets = both.length ? both : [CARRIER];
    for (const { seed, edge: found } of existing) {
      const data = seed.data.catalog_media_relation;
      const at = data.indexOf(found);
      if (at >= 0) {
        data.splice(at, 1);
        seed.dirty = true;
        if (found.type === 'related') report.edges.replaced.push({ pair: key, over: found.type });
      }
    }
    for (const name of targets) {
      const seed = seeds.get(name);
      if (!seed) continue;
      seed.data.catalog_media_relation ??= [];
      seed.data.catalog_media_relation.push({
        fromId: edge.fromId,
        toId: edge.toId,
        type: edge.type,
      });
      seed.dirty = true;
    }
    report.edges.applied.push({ pair: key, type: edge.type, in: targets });
  }

  const summary = {
    patchEdits: patch.edits.length,
    editsApplied: report.edits.applied.length,
    editsAlready: report.edits.already,
    editConflicts: report.edits.conflicts.length,
    editsMissingRow: report.edits.missingRow.length,
    patchEdges: patch.edges.length,
    edgesApplied: report.edges.applied.length,
    edgesAlready: report.edges.already,
    edgeConflicts: report.edges.conflicts.length,
    edgesMissingEndpoint: report.edges.missingEndpoint.length,
    dirtySeeds: [...seeds].filter(([, seed]) => seed.dirty).map(([name]) => name),
  };
  console.log(JSON.stringify(summary, null, 1));

  if (report.edits.conflicts.length) {
    console.log('\nfields the rebuilt seed disagrees with (kept the seed, review these):');
    for (const conflict of report.edits.conflicts.slice(0, 10)) {
      console.log(
        `  ${conflict.id} ${conflict.path}: seed=${JSON.stringify(conflict.seedValue)?.slice(0, 60)} patch=${JSON.stringify(conflict.patch)?.slice(0, 60)}`,
      );
    }
  }
  if (report.edges.missingEndpoint.length) {
    console.log(
      `\n${report.edges.missingEndpoint.length} edge(s) name a row the rebuild no longer carries; skipped.`,
    );
  }
  if (!apply) {
    console.log('\ndry run — pass --apply to rewrite the seeds');
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  for (const [name, seed] of seeds) {
    if (!seed.dirty) continue;
    const path = resolve(seedDir, name);
    await writeFile(`${path}.pre-patch-${stamp}.bak`, await readFile(path));
    const tmp = `${path}.tmp-${stamp}`;
    await writeFile(tmp, JSON.stringify(seed.data, null, 1));
    await rename(tmp, path);
    console.log(`rewrote ${name}`);
  }
  await writeFile(
    `${patchPath}.report-${stamp}.json`,
    JSON.stringify({ ...report, summary }, null, 1),
  );
  console.log(`report: ${patchPath}.report-${stamp}.json`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
