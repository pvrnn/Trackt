/**
 * `pnpm prune:seeds [-- --apply]`
 *
 * An `--source anilist-all` walk imports the provider's whole namespace, and for
 * manga that is half again as large as what MAL ranks: of 130,011 manga rows,
 * 66,929 carry no MAL id at all (web manga, doujin, self-published) and 21,385
 * are one-shots, most of them with no score. Search then has to compete with
 * 500 new zero-readership works a week.
 *
 * This applies an evidence floor to what the walk already wrote:
 *
 * - a manga row without a MAL id is dropped — the catalogue had no way to reach
 *   it before this source existed, and MAL's absence is a reasonable proxy for
 *   "nobody outside the provider has ever indexed it";
 * - a one-shot is kept only above a provider score, because a one-chapter work
 *   with no score is indistinguishable from spam. Any other manga format keeps
 *   its row: chapter count is not evidence of quality.
 *
 * Anime rows are never touched — the rules are about manga volume. Edges whose
 * endpoint this removes go with it, computed against both seeds together (an
 * edge may point into the other file), so the graph stays closed and publishable.
 */

import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export type SeedRow = {
  id: string;
  kind: string;
  title: string;
  year: number | null;
  externalIds: Record<string, string | number>;
  metadata: Record<string, unknown>;
  [key: string]: unknown;
};

export type SeedRelation = { fromId: string; toId: string; type: string };

export type SeedFile = {
  catalog_media: SeedRow[];
  catalog_media_relation?: SeedRelation[];
  urls?: Record<string, string>;
  report?: { skipped?: unknown[]; warnings?: unknown[]; [key: string]: unknown };
  [key: string]: unknown;
};

export type Policy = {
  /** Manga formats that must name a MAL id to be kept. */
  requireMalId: boolean;
  /** Provider score a one-shot needs; `null` keeps every one-shot. */
  oneShotMinScore: number | null;
};

/** AniList's averageScore is 0–100, and 60 is "above average" on it. */
export const DEFAULT_POLICY: Policy = { requireMalId: true, oneShotMinScore: 60 };

const MANGA_KINDS = new Set(['manga', 'webtoon']);

export function isKept(row: SeedRow, policy: Policy): boolean {
  if (!MANGA_KINDS.has(row.kind)) return true;
  if (policy.requireMalId && !row.externalIds.mal) return false;
  const format = String(row.metadata.format ?? '');
  if (policy.oneShotMinScore === null || format !== 'one shot') return true;
  const score = Number(row.metadata.providerScore ?? 0);
  return Number.isFinite(score) && score >= policy.oneShotMinScore;
}

export type PrunedSeed = { file: string; before: number; after: number; edgesDropped: number };

/**
 * Applies the policy across a set of seeds at once: an edge is only dropped when
 * an endpoint is gone from *every* file, since the seeder resolves endpoints
 * against the whole catalogue.
 */
export function pruneSeeds(
  seeds: { file: string; seed: SeedFile }[],
  policy: Policy,
): { seeds: { file: string; seed: SeedFile }[]; report: PrunedSeed[] } {
  const keptIds = seeds.map(({ seed }) => {
    const kept = new Set<string>();
    for (const row of seed.catalog_media) if (isKept(row, policy)) kept.add(row.id);
    return kept;
  });
  const surviving = new Set<string>();
  for (const kept of keptIds) for (const id of kept) surviving.add(id);

  const report: PrunedSeed[] = [];
  const pruned = seeds.map(({ file, seed }, index) => {
    const kept = keptIds[index]!;
    const rows = seed.catalog_media.filter((row) => kept.has(row.id));
    const edges = seed.catalog_media_relation ?? [];
    // An edge may point into another file, so only a vanishing endpoint in every
    // file counts as a broken edge.
    const keptEdges = edges.filter(
      (edge) => surviving.has(edge.fromId) && surviving.has(edge.toId),
    );
    const dropped = seed.catalog_media.length - rows.length;
    const urls = seed.urls
      ? Object.fromEntries(Object.entries(seed.urls).filter(([id]) => surviving.has(id)))
      : undefined;
    const next: SeedFile = {
      ...seed,
      catalog_media: rows,
      catalog_media_relation: keptEdges,
      ...(urls ? { urls } : {}),
      report: {
        ...seed.report,
        pruned: { policy, removed: dropped, edges: edges.length - keptEdges.length },
      },
    };
    report.push({
      file,
      before: seed.catalog_media.length,
      after: rows.length,
      edgesDropped: edges.length - keptEdges.length,
    });
    return { file, seed: next };
  });

  return { seeds: pruned, report };
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const apply = argv.includes('--apply');
  const policy: Policy = { ...DEFAULT_POLICY };
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === '--one-shot-min-score') {
      policy.oneShotMinScore = Number(argv[++index]);
    } else if (argv[index] === '--keep-unmatched-mal') {
      policy.requireMalId = false;
    }
  }

  const dir = resolve('apps/catalog/seed');
  const files = ['top-anime-anilist.json', 'top-manga-anilist.json'];
  const seeds = [];
  for (const file of files) {
    const path = resolve(dir, file);
    seeds.push({ file: path, seed: JSON.parse(await readFile(path, 'utf8')) as SeedFile });
  }

  const { seeds: pruned, report } = pruneSeeds(seeds, policy);
  for (const entry of report) {
    process.stdout.write(
      `${entry.file.split('/').pop()}: ${entry.before} → ${entry.after} rows ` +
        `(${entry.before - entry.after} removed), ${entry.edgesDropped} edges dropped\n`,
    );
  }
  const removed = report.reduce((sum, entry) => sum + entry.before - entry.after, 0);
  if (!apply) {
    process.stdout.write(`\nDry run — ${removed} rows would go. Re-run with --apply.\n`);
    return 0;
  }
  for (const { file, seed } of pruned) {
    await copyFile(file, `${file}.pre-prune.bak`).catch(() => undefined);
    await writeFile(file, `${JSON.stringify(seed, null, 2)}\n`, 'utf8');
  }
  process.stdout.write(`\nWrote ${pruned.length} seeds; ${removed} rows removed.\n`);
  return 0;
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
