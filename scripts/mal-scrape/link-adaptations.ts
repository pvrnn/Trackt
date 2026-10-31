/**
 * `pnpm link:adaptations [-- --apply]`
 *
 * The AniList seeds are closed graphs: each ships the other kind's rows it
 * relates to. When the anime seed and the manga seed overlap by title + year but
 * no edge joins them, the same work shows up twice in search as two unrelated
 * rows. This derives the missing edge, and only claims what AniList's own
 * relation data supports:
 *
 * - `ADAPTATION` for this exact pair → `adaptation`, print → screen, the same
 *   direction rule `planAdaptation` applies when it builds the seeds.
 * - `ALTERNATIVE`, `SUMMARY`, `OTHER`, `CHARACTER`, or no declared relation at
 *   all → `related`. Anything stronger would assert a source direction the
 *   provider never stated (`Citrus` anime ↔ `Citrus+`, the sequel manga).
 *
 * A pair the script cannot justify is reported, never linked.
 */

import { readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export type SeedRow = {
  id: string;
  kind: string;
  title: string;
  year: number | null;
  externalIds: Record<string, string | number>;
};

export type SeedRelation = { fromId: string; toId: string; type: string };

export type SeedFile = {
  catalog_media: SeedRow[];
  catalog_media_relation: SeedRelation[];
  [key: string]: unknown;
};

/** AniList's relation enum → the stored type. Anything unlisted is only `related`. */
export const RELATION_TYPE_BY_ANILIST: Record<string, 'adaptation' | 'related'> = {
  ADAPTATION: 'adaptation',
  ALTERNATIVE: 'related',
  SUMMARY: 'related',
  OTHER: 'related',
  // Normally a character compilation, which the importer skips — but a pair
  // matched on identical title and year is the work itself, not a compilation.
  CHARACTER: 'related',
};

export function normaliseTitle(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['\u2019`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const SEED_DIR = resolve('apps/catalog/seed');

/** AniList rows that are a slot, not a work: pairing them asserts nothing. */
const PLACEHOLDER_TITLE = /^(title to be announced|untitled|tba)$/;

export type Pair = { anime: SeedRow; manga: SeedRow };

/** Anime/manga rows that share a title and year but no edge. */
export function unlinkedPairs(rows: SeedRow[], edges: SeedRelation[]): Pair[] {
  const linked = new Set(edges.map((edge) => `${edge.fromId}|${edge.toId}`));
  const joined = (left: string, right: string): boolean =>
    linked.has(`${left}|${right}`) || linked.has(`${right}|${left}`);

  const buckets = new Map<string, SeedRow[]>();
  for (const row of rows) {
    const title = normaliseTitle(row.title);
    // A title that normalises to nothing ("&", "○") would put every such row in
    // one bucket and pair unrelated works; a placeholder identifies no work either.
    if (!title || PLACEHOLDER_TITLE.test(title)) continue;
    const key = `${title}|${row.year ?? ''}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(row);
    else buckets.set(key, [row]);
  }

  const pairs: Pair[] = [];
  for (const bucket of buckets.values()) {
    const animes = bucket.filter((row) => row.kind === 'anime');
    const mangas = bucket.filter((row) => row.kind === 'manga');
    for (const anime of animes) {
      for (const manga of mangas) {
        if (!joined(anime.id, manga.id)) pairs.push({ anime, manga });
      }
    }
  }
  return pairs;
}

/**
 * What AniList says about the pair: the relation to this exact manga, and — when
 * it names a different manga instead (`Citrus` anime → `Citrus`, not `Citrus+`) —
 * that entry, so the log can say why the edge is only `related`.
 */
export type Declared = { type?: string; otherManga?: { id: number; relationType: string } };

/**
 * The edge to add for a pair. Direction follows the catalog's rule: an
 * `adaptation` always runs print → screen, so the manga page reads "adaptation"
 * and the anime page reads "source"; `related` is symmetric, stored anime → manga.
 */
export function edgeFor(pair: Pair, declared: Declared): { edge: SeedRelation; basis: string } {
  const kind = declared.type ? RELATION_TYPE_BY_ANILIST[declared.type] : 'related';
  if (kind === 'adaptation') {
    return {
      edge: { fromId: pair.manga.id, toId: pair.anime.id, type: 'adaptation' },
      basis: `AniList ${declared.type}`,
    };
  }
  return {
    edge: { fromId: pair.anime.id, toId: pair.manga.id, type: 'related' },
    basis: declared.type
      ? `AniList ${declared.type}`
      : declared.otherManga
        ? `AniList relates it to manga ${declared.otherManga.id} (${declared.otherManga.relationType}) instead`
        : 'same title and year, no relation declared',
  };
}

/** Add the edges a seed file does not already carry. */
/**
 * Add the edges a seed file does not already carry.
 *
 * `requireEndpoints` keeps a file self-contained: an edge is only added when
 * both rows are in it. The file loaded LAST does not need that — the seeder
 * resolves endpoints against the whole database, so an edge to a row the earlier
 * seed inserted is accepted, which is the only way to join a pair whose two rows
 * are split across the two seeds.
 */
export function withEdges(
  file: SeedFile,
  edges: SeedRelation[],
  options: { requireEndpoints?: boolean } = {},
): SeedFile {
  const requireEndpoints = options.requireEndpoints ?? true;
  const has = new Set(
    file.catalog_media_relation.map((edge) => `${edge.fromId}|${edge.toId}|${edge.type}`),
  );
  const ids = new Set(file.catalog_media.map((row) => row.id));
  const added = edges.filter(
    (edge) =>
      (!requireEndpoints || (ids.has(edge.fromId) && ids.has(edge.toId))) &&
      !has.has(`${edge.fromId}|${edge.toId}|${edge.type}`),
  );
  if (!added.length) return file;
  return {
    ...file,
    catalog_media_relation: [...file.catalog_media_relation, ...added],
  };
}

type AniListMedia = {
  id: number;
  relations?: {
    edges?: { relationType: string; node: { id: number; type?: string } }[];
  };
};

/** What AniList declares between each anime and the manga it was paired with. */
export async function declaredRelations(
  animeIds: number[],
  mangaIdByAnimeId: Map<number, number>,
): Promise<Map<number, Declared>> {
  const query = `query($ids:[Int]){Page(perPage:50){media(id_in:$ids,type:ANIME){id
    relations{edges{relationType node{id type}}}}}}`;
  const response = await fetch('https://graphql.anilist.co', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: { ids: animeIds } }),
  });
  if (!response.ok) throw new Error(`AniList ${response.status}`);
  const body = (await response.json()) as { data?: { Page?: { media?: AniListMedia[] } } };
  const declared = new Map<number, Declared>();
  for (const media of body.data?.Page?.media ?? []) {
    const wanted = mangaIdByAnimeId.get(media.id);
    const edges = media.relations?.edges ?? [];
    const exact = edges.find((edge) => edge.node.id === wanted);
    const otherManga = edges.find((edge) => edge.node.type === 'MANGA' && edge.node.id !== wanted);
    declared.set(media.id, {
      ...(exact ? { type: exact.relationType } : {}),
      ...(otherManga
        ? { otherManga: { id: otherManga.node.id, relationType: otherManga.relationType } }
        : {}),
    });
  }
  return declared;
}

const readSeed = async (name: string): Promise<SeedFile> =>
  JSON.parse(await readFile(resolve(SEED_DIR, name), 'utf8')) as SeedFile;

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const names = ['top-anime-anilist.json', 'top-manga-anilist.json'];
  const files = new Map<string, SeedFile>();
  for (const name of names) files.set(name, await readSeed(name));

  const rows = new Map<string, SeedRow>();
  for (const file of files.values()) {
    for (const row of file.catalog_media) rows.set(row.id, row);
  }
  const edges = [...files.values()].flatMap((file) => file.catalog_media_relation);
  const pairs = unlinkedPairs([...rows.values()], edges);

  const declared = await declaredRelations(
    pairs.map((pair) => Number(pair.anime.externalIds.anilist)),
    new Map(
      pairs.map((pair) => [
        Number(pair.anime.externalIds.anilist),
        Number(pair.manga.externalIds.anilist),
      ]),
    ),
  );

  const added: { pair: Pair; edge: SeedRelation; basis: string }[] = [];
  for (const pair of pairs) {
    const decision = edgeFor(pair, declared.get(Number(pair.anime.externalIds.anilist)) ?? {});
    added.push({ pair, edge: decision.edge, basis: decision.basis });
  }

  console.log(`${pairs.length} unlinked same-title pairs; ${added.length} edges to add`);
  for (const entry of added) {
    console.log(
      `  ${entry.edge.type.padEnd(10)} ${entry.pair.manga.title} (manga ${entry.pair.manga.externalIds.anilist}) ↔ ${entry.pair.anime.title} (anime ${entry.pair.anime.externalIds.anilist}) — ${entry.basis}`,
    );
  }

  if (!apply) {
    console.log('\nDry run — re-run with --apply to write the seeds.');
    return;
  }

  const log = {
    generatedAt: new Date().toISOString(),
    policy:
      'Same normalised title and year across the two AniList seeds, with no edge between the rows: AniList ADAPTATION → adaptation (manga → anime), anything else (or nothing declared) → related (anime → manga).',
    counts: { pairs: pairs.length, added: added.length },
    added: added.map((entry) => ({
      edge: entry.edge,
      basis: entry.basis,
      anime: {
        id: entry.pair.anime.id,
        anilist: entry.pair.anime.externalIds.anilist,
        title: entry.pair.anime.title,
      },
      manga: {
        id: entry.pair.manga.id,
        anilist: entry.pair.manga.externalIds.anilist,
        title: entry.pair.manga.title,
      },
    })),
  };

  // The manga seed is loaded second, so it can carry every edge; the anime seed
  // only the pairs it closes on its own.
  const LAST = 'top-manga-anilist.json';
  for (const [name, file] of files) {
    const original = await readFile(resolve(SEED_DIR, name));
    await writeFile(resolve(SEED_DIR, `${name}.pre-link.bak`), original, { flag: 'wx' }).catch(
      (error: { code?: string }) => {
        if (error.code !== 'EEXIST') throw error;
      },
    );
    const next = withEdges(
      file,
      added.map((entry) => entry.edge),
      { requireEndpoints: name !== LAST },
    );
    await writeFile(`${resolve(SEED_DIR, name)}.tmp`, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    await rename(`${resolve(SEED_DIR, name)}.tmp`, resolve(SEED_DIR, name));
  }
  await writeFile(
    resolve(SEED_DIR, 'adaptation-links.json'),
    `${JSON.stringify(log, null, 2)}\n`,
    'utf8',
  );
  console.log(`\nWrote ${added.length} edges; logged to adaptation-links.json`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
