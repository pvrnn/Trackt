/**
 * `node scripts/catalog-research/prepare-batches.mjs`
 *
 * Candidate generation for the cross-kind research pass.
 *
 * The five seeds are independently closed graphs: AniList ships anime↔manga
 * edges, and nothing links a film to the game it adapts or a show to the manga
 * it came from. This finds every pair of works of DIFFERENT kinds that share a
 * normalised title (or synonym) and has no edge yet, scores the evidence, and
 * writes 100-candidate batches for the research agents.
 *
 * Score:
 *   exact title  = 40, matched through a synonym = 15
 *   same year    = 40, year ±1 = 20, no year on one side = 0, otherwise -gap
 *   sharing an external id = -30 (that is a duplicate, not a relation)
 *
 * Batches are ordered by score, so `batch-001` is the strongest evidence.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const SEED_DIR = resolve('apps/catalog/seed');
const OUT_DIR = resolve('apps/catalog/seed/research');
const BATCH_SIZE = 100;

const SEEDS = [
  'top-anime-anilist.json',
  'top-manga-anilist.json',
  'top-games-igdb.json',
  'top-movies-tmdb.json',
  'top-series-tmdb.json',
];

export function normaliseTitle(value) {
  return (value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['\u2019`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Mirrors packages/shared/src/slug.ts so an agent can name a work the way the web page does. */
export function mediaSlug(title, year) {
  const base = (title ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['\u2019]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const stem = base || 'media';
  return year == null ? stem : `${stem}-${year}`;
}

async function main() {
  const rows = new Map();
  const home = new Map();
  const edges = [];
  for (const name of SEEDS) {
    const file = JSON.parse(await readFile(resolve(SEED_DIR, name), 'utf8'));
    for (const row of file.catalog_media) {
      if (!rows.has(row.id)) rows.set(row.id, row);
      home.set(row.id, name);
    }
    for (const edge of file.catalog_media_relation ?? []) edges.push(edge);
  }
  const edged = new Set(edges.map((edge) => [edge.fromId, edge.toId].sort().join('|')));

  const index = new Map();
  for (const row of rows.values()) {
    const titles = new Set(
      [row.title, ...(row.synonyms ?? [])].map(normaliseTitle).filter(Boolean),
    );
    for (const title of titles) {
      // A one- or two-character token ("x", "1", "ai") is a normaliser artefact,
      // not a title: one pass produced 56 candidates on the bare token "x".
      if (title.length < 3 || /^\d+$/.test(title)) continue;
      if (!index.has(title)) index.set(title, []);
      index.get(title).push({ row, viaSynonym: title !== normaliseTitle(row.title) });
    }
  }

  const seen = new Set();
  const candidates = [];
  for (const [title, group] of index) {
    if (group.length < 2 || group.length > 40) continue;
    for (const a of group) {
      for (const b of group) {
        if (a.row.id >= b.row.id) continue;
        if (a.row.kind === b.row.kind) continue;
        const pairKey = [a.row.id, b.row.id].sort().join('|');
        if (edged.has(pairKey) || seen.has(pairKey)) continue;
        seen.add(pairKey);

        const gap =
          a.row.year != null && b.row.year != null ? Math.abs(a.row.year - b.row.year) : null;
        const exactTitle =
          normaliseTitle(a.row.title) === normaliseTitle(b.row.title) &&
          title === normaliseTitle(a.row.title);
        let score = exactTitle ? 40 : 15;
        if (gap === 0) score += 40;
        else if (gap === 1) score += 20;
        else if (gap != null) score -= Math.min(gap, 20);
        const shared = Object.keys(a.row.externalIds ?? {}).filter(
          (key) => key in (b.row.externalIds ?? {}),
        );
        if (shared.length) score -= 30;

        candidates.push({ score, gap, pairKey, title, a: a.row, b: b.row });
      }
    }
  }
  candidates.sort((x, y) => y.score - x.score);

  const slim = (row) => ({
    id: row.id,
    slug: mediaSlug(row.title, row.year),
    seed: home.get(row.id),
    kind: row.kind,
    title: row.title,
    synonyms: row.synonyms ?? [],
    year: row.year,
    status: row.status,
    genres: row.genres ?? [],
    partCount: row.partCount,
    seasonNumber: row.seasonNumber,
    externalIds: row.externalIds ?? {},
    metadata: row.metadata ?? {},
    description: (row.description ?? '').slice(0, 600),
  });

  const out = candidates.map((candidate, i) => ({
    n: i + 1,
    score: candidate.score,
    yearGap: candidate.gap,
    matchedOn: candidate.title,
    pairKey: candidate.pairKey,
    left: slim(candidate.a),
    right: slim(candidate.b),
  }));

  await mkdir(resolve(OUT_DIR, 'batches'), { recursive: true });
  await mkdir(resolve(OUT_DIR, 'results'), { recursive: true });
  for (let offset = 0; offset < out.length; offset += BATCH_SIZE) {
    const name = `batch-${String(offset / BATCH_SIZE + 1).padStart(3, '0')}.json`;
    await writeFile(
      resolve(OUT_DIR, 'batches', name),
      JSON.stringify(out.slice(offset, offset + BATCH_SIZE), null, 1),
    );
  }

  const byBand = { '80+': 0, '60-79': 0, '40-59': 0, sub40: 0 };
  for (const candidate of out) {
    if (candidate.score >= 80) byBand['80+']++;
    else if (candidate.score >= 60) byBand['60-79']++;
    else if (candidate.score >= 40) byBand['40-59']++;
    else byBand.sub40++;
  }
  const byKinds = {};
  for (const candidate of out) {
    const key = [candidate.left.kind, candidate.right.kind].sort().join('-');
    byKinds[key] = (byKinds[key] ?? 0) + 1;
  }
  const batches = Math.ceil(out.length / BATCH_SIZE);
  const manifest = {
    generatedAt: new Date().toISOString(),
    seeds: SEEDS,
    uniqueRows: rows.size,
    existingEdges: edges.length,
    candidates: out.length,
    batches,
    batchSize: BATCH_SIZE,
    byBand,
    byKinds,
  };
  await writeFile(resolve(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 1));
  console.log(JSON.stringify(manifest, null, 1));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
