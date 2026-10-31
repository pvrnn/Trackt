/**
 * Fold TMDB seed rows that duplicate an AniList anime row into that row, then
 * drop them from the TMDB seed. Identity stays with AniList (ADR-0003: an anime
 * row is keyed by its AniList id); the TMDB facts move into `metadata.tmdb` and
 * the ids into `externalIds`, so nothing is lost but nothing shadows AniList's
 * own `format`/`providerScore` either.
 *
 * This is a heuristic: TMDB and AniList share no id, so a pair rests on a title
 * (or synonym) match plus release year, format and episode-count compatibility.
 * A bare title match is not enough on its own — a translated synonym collides
 * with an unrelated work often enough to matter (*Turning Red* ↔ a 2021 short
 * called *Red*) — so a pair also needs one corroborating signal: the same year,
 * matching counts, a matching season, or an overlapping synopsis.
 * Everything that does not clear that bar is reported as skipped, never deleted.
 */

import { readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export type SeedRow = {
  id: string;
  kind: string;
  title: string;
  synonyms: string[];
  year: number | null;
  status: string | null;
  genres: string[];
  partCount: number | null;
  seasonNumber: number | null;
  externalIds: Record<string, string | number>;
  metadata: Record<string, unknown>;
  description: string | null;
  coverUrl: string | null;
  bannerUrl: string | null;
};

export type SeedFile = {
  generatedAt?: string;
  catalog_media: SeedRow[];
  catalog_media_relation?: { fromId: string; toId: string; type: string }[];
  [key: string]: unknown;
};

const SEED_DIR = resolve('apps/catalog/seed');

/** Formats an anime row can carry while still being the same work as a TMDB film. */
const MOVIE_FORMATS = new Set(['movie', 'ova', 'ona', 'special']);
/** …and as a TMDB season. A manga/novel entry is a different work, not a duplicate. */
const SERIES_FORMATS = new Set(['tv', 'ona', 'tv short', 'special', 'ova']);

export function normaliseTitle(value: string): string {
  return (
    value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      // "Chang'an" and "Changan" are the same title; a space there would not be.
      .replace(/['\u2019`]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
  );
}

/**
 * The title without a trailing sequel marker: AniList numbers a follow-up in the
 * title (`Cyberpunk: Edgerunners 2`) where TMDB numbers it as a season
 * (`Cyberpunk: Edgerunners`, season 2), so the two only meet on the stem.
 */
export function titleStem(value: string): string {
  return normaliseTitle(value)
    .replace(/\s+season\s+\d{1,2}$/, '')
    .replace(/\s+s\d{1,2}$/, '')
    .replace(/\s+(\d+)(st|nd|rd|th) season$/, '')
    .replace(/\s+(\d+|ii|iii|iv|vi|vii|viii|ix|x|xi|xii)$/, '')
    .trim();
}

/** The sequel number a title carries, if any: `… 2`, `… S2`, `… 2nd Season` → 2. */
export function sequelNumber(value: string): number | null {
  const normalised = normaliseTitle(value);
  const match =
    /\s(\d{1,2})$/.exec(normalised) ??
    /\s+s(\d{1,2})$/.exec(normalised) ??
    /\s+season\s+(\d{1,2})$/.exec(normalised) ??
    /\s+(\d{1,2})(st|nd|rd|th) season$/.exec(normalised);
  return match ? Number(match[1]) : null;
}

function significantWords(value: string | null | undefined): Set<string> {
  return new Set(
    (value ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .split(' ')
      .filter((word) => word.length > 4),
  );
}

/** Cheap synopsis overlap, used only as evidence for a pair the genres do not already prove. */
export function synopsisOverlap(left: SeedRow, right: SeedRow): number {
  const a = significantWords(left.description);
  const b = significantWords(right.description);
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared++;
  return shared / (a.size + b.size - shared);
}

function yearDelta(left: SeedRow, right: SeedRow): number | null {
  return left.year !== null && right.year !== null ? left.year - right.year : null;
}

/**
 * Could these two rows be the same work? Deliberately conservative: a live-action
 * adaptation of an anime shares its title and year and must not be folded away,
 * so animation, format and episode count all have to line up.
 */
export function isDuplicate(tmdb: SeedRow, anime: SeedRow): boolean {
  if (anime.kind !== 'anime') return false;
  const delta = yearDelta(tmdb, anime);
  if (delta !== null && Math.abs(delta) > 1) return false;
  const format = String(anime.metadata.format ?? '').toLowerCase();

  if (tmdb.kind === 'movie') {
    // A film is only a duplicate of an anime film/short, and only if TMDB tags it animation.
    return tmdb.genres.includes('animation') && MOVIE_FORMATS.has(format);
  }

  if (!SERIES_FORMATS.has(format)) return false;
  const animeEpisodes = anime.partCount;
  const tmdbEpisodes = tmdb.partCount;
  if (animeEpisodes === null || tmdbEpisodes === null) return false;
  // A TMDB season that covers several AniList cours (Soul Land: 264 vs 26) is not
  // the same row, and folding it into one cour would drop the rest.
  if (Math.abs(tmdbEpisodes - animeEpisodes) > Math.max(2, Math.round(animeEpisodes * 0.1))) {
    return false;
  }
  // Animation is the usual proof; a CG series TMDB forgot to tag needs the synopsis to agree.
  return tmdb.genres.includes('animation') || synopsisOverlap(tmdb, anime) >= 0.2;
}

export type ScoredPair = { tmdb: SeedRow; anime: SeedRow; score: number; episodes: number | null };

function score(tmdb: SeedRow, anime: SeedRow): number {
  const delta = yearDelta(tmdb, anime);
  const sameYear = delta === 0 ? 10 : 0;
  // `… 2` against season 2 is the strongest signal a title can give.
  const numbered = sequelNumber(anime.title);
  const seasonMatchesTitle =
    numbered !== null && tmdb.seasonNumber !== null
      ? numbered === tmdb.seasonNumber
        ? 6
        : -20
      : 0;
  const sameEpisodes = tmdb.partCount !== null && tmdb.partCount === anime.partCount ? 5 : 0;
  const sameSeason = tmdb.seasonNumber !== null && tmdb.seasonNumber === anime.seasonNumber ? 2 : 0;
  return (
    sameYear + sameEpisodes + sameSeason + seasonMatchesTitle + synopsisOverlap(tmdb, anime) * 5
  );
}

export type PairingResult = {
  pairs: ScoredPair[];
  /** Candidates that failed a rule, for the log: never deleted, always reported. */
  skipped: { tmdb: SeedRow; candidates: { anime: SeedRow; reason: string }[] }[];
};

/**
 * Pair each TMDB row with at most one anime row, best evidence first, so a show
 * whose several seasons all match the same anime entry yields exactly one pair.
 */
export function pairSeeds(animeRows: SeedRow[], tmdbRows: SeedRow[]): PairingResult {
  const index = new Map<string, SeedRow[]>();
  for (const row of animeRows) {
    if (row.kind !== 'anime') continue;
    // A row that already carries TMDB facts has taken its pair. Pairing it again
    // would let a second season overwrite what the first one merged, so a re-run
    // over deduplicated seeds finds nothing left to do.
    if (row.metadata?.tmdb) continue;
    for (const title of [row.title, ...(row.synonyms ?? [])]) {
      for (const key of new Set([normaliseTitle(title), titleStem(title)])) {
        if (!key) continue;
        const bucket = index.get(key);
        if (bucket) bucket.push(row);
        else index.set(key, [row]);
      }
    }
  }

  const proposals: ScoredPair[] = [];
  const rejected: PairingResult['skipped'] = [];

  for (const tmdb of tmdbRows) {
    const candidates = new Map<string, SeedRow>();
    for (const title of [tmdb.title, ...(tmdb.synonyms ?? [])]) {
      for (const key of new Set([normaliseTitle(title), titleStem(title)])) {
        for (const row of index.get(key) ?? []) candidates.set(row.id, row);
      }
    }
    const viable: ScoredPair[] = [];
    const failed: { anime: SeedRow; reason: string }[] = [];
    for (const anime of candidates.values()) {
      const evidence = isDuplicate(tmdb, anime) ? score(tmdb, anime) : null;
      if (evidence !== null && evidence > 0) {
        viable.push({ tmdb, anime, score: evidence, episodes: anime.partCount });
      } else {
        const delta = yearDelta(tmdb, anime);
        const reason =
          anime.kind !== 'anime'
            ? 'not an anime row'
            : evidence !== null
              ? 'title matches, but nothing corroborates it (year, episodes, season, synopsis)'
              : delta !== null && Math.abs(delta) > 1
                ? `year differs by ${delta}`
                : `format/episodes/evidence: ${String(anime.metadata.format)} ${String(anime.partCount)}eps vs ${String(tmdb.partCount)}`;
        failed.push({ anime, reason });
      }
    }
    if (viable.length) proposals.push(...viable);
    else if (failed.length) rejected.push({ tmdb, candidates: failed });
  }

  // Greedy 1:1 assignment, strongest evidence first.
  proposals.sort((left, right) => right.score - left.score);
  const usedAnime = new Set<string>();
  const usedTmdb = new Set<string>();
  const pairs: ScoredPair[] = [];
  for (const proposal of proposals) {
    if (usedAnime.has(proposal.anime.id) || usedTmdb.has(proposal.tmdb.id)) continue;
    usedAnime.add(proposal.anime.id);
    usedTmdb.add(proposal.tmdb.id);
    pairs.push(proposal);
  }

  return { pairs, skipped: rejected.filter((entry) => !usedTmdb.has(entry.tmdb.id)) };
}

/**
 * The AniList row keeps its identity and its own `format`/`providerScore`; the
 * TMDB facts land under `metadata.tmdb`, and a null image or synopsis is filled
 * rather than replaced.
 */
export function mergeIntoAnime(anime: SeedRow, tmdb: SeedRow): SeedRow {
  return {
    ...anime,
    externalIds: {
      ...anime.externalIds,
      tmdb: tmdb.externalIds.tmdb,
      ...(tmdb.externalIds.imdb && !anime.externalIds.imdb ? { imdb: tmdb.externalIds.imdb } : {}),
      ...(tmdb.externalIds.tvdb && !anime.externalIds.tvdb ? { tvdb: tmdb.externalIds.tvdb } : {}),
    },
    metadata: {
      ...anime.metadata,
      tmdb: {
        id: tmdb.externalIds.tmdb,
        kind: tmdb.kind,
        ...(tmdb.seasonNumber === null ? {} : { seasonNumber: tmdb.seasonNumber }),
        ...(tmdb.externalIds.imdb ? { imdbId: tmdb.externalIds.imdb } : {}),
        ...(tmdb.externalIds.tvdb ? { tvdbId: tmdb.externalIds.tvdb } : {}),
        ...tmdb.metadata,
      },
    },
    coverUrl: anime.coverUrl ?? tmdb.coverUrl,
    bannerUrl: anime.bannerUrl ?? tmdb.bannerUrl,
    description: anime.description ?? tmdb.description,
  };
}

/**
 * Replace every row a merge produced, in every seed that carries it: the AniList
 * seeds overlap (each ships the other kind's rows), so patching only one of them
 * leaves a stale copy that a later seed silently restores.
 */
export function replaceRows(rows: SeedRow[], merged: Map<string, SeedRow>): SeedRow[] {
  return rows.map((row) => merged.get(row.id) ?? row);
}

const readSeed = async (name: string): Promise<SeedFile> =>
  JSON.parse(await readFile(resolve(SEED_DIR, name), 'utf8')) as SeedFile;

const writeSeed = async (name: string, data: SeedFile): Promise<void> => {
  const target = resolve(SEED_DIR, name);
  await writeFile(`${target}.tmp`, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  await rename(`${target}.tmp`, target);
};

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const anime = await readSeed('top-anime-anilist.json');
  const movies = await readSeed('top-movies-tmdb.json');
  const series = await readSeed('top-series-tmdb.json');
  // The AniList seeds are closed graphs: the manga seed carries the anime it
  // adapts. A row merged here must be merged there too, or seeding that file
  // afterwards silently restores the stale copy.
  const manga = await readSeed('top-manga-anilist.json').catch(() => null);

  const tmdbRows = [...movies.catalog_media, ...series.catalog_media];
  const { pairs, skipped } = pairSeeds(anime.catalog_media, tmdbRows);

  const merged = new Map<string, SeedRow>();
  for (const pair of pairs) {
    merged.set(pair.anime.id, mergeIntoAnime(pair.anime, pair.tmdb));
  }

  const removedIds = new Set(pairs.map((pair) => pair.tmdb.id));
  const log = {
    generatedAt: new Date().toISOString(),
    policy:
      'A TMDB row is folded into an AniList anime row on a title/synonym match, release year within one, a compatible format (film ↔ movie/ova/ona/special, series ↔ tv/ona/tv short/special/ova), and episode counts within 10% (or identical); animation is required unless the synopses overlap by ≥0.2. TMDB facts move to metadata.tmdb, ids to externalIds.',
    counts: {
      movieRows: movies.catalog_media.length,
      seriesRows: series.catalog_media.length,
      animeRows: anime.catalog_media.length,
      paired: pairs.length,
      removedMovies: pairs.filter((pair) => pair.tmdb.kind === 'movie').length,
      removedSeries: pairs.filter((pair) => pair.tmdb.kind === 'series').length,
      skipped: skipped.length,
    },
    removed: pairs.map((pair) => ({
      tmdbRow: pair.tmdb,
      mergedInto: {
        id: pair.anime.id,
        title: pair.anime.title,
        anilistId: pair.anime.externalIds.anilist,
      },
      evidence: {
        score: Number(pair.score.toFixed(2)),
        yearDelta: yearDelta(pair.tmdb, pair.anime),
        tmdbEpisodes: pair.tmdb.partCount,
        anilistEpisodes: pair.anime.partCount,
        synopsisOverlap: Number(synopsisOverlap(pair.tmdb, pair.anime).toFixed(2)),
        animated: pair.tmdb.genres.includes('animation'),
      },
    })),
    skipped: skipped.map((entry) => ({
      tmdbRow: entry.tmdb,
      candidates: entry.candidates.map((candidate) => ({
        animeId: candidate.anime.id,
        title: candidate.anime.title,
        anilistId: candidate.anime.externalIds.anilist,
        format: candidate.anime.metadata.format,
        partCount: candidate.anime.partCount,
        reason: candidate.reason,
      })),
    })),
  };

  console.log(log.counts);
  if (!apply) {
    console.log('\nDry run — re-run with --apply to rewrite the seeds.');
    console.log('\n--- pairs ---');
    for (const pair of pairs.sort((a, b) => b.score - a.score)) {
      console.log(
        `${pair.tmdb.kind.padEnd(6)} "${pair.tmdb.title}" ${pair.tmdb.year} (${String(pair.tmdb.partCount ?? pair.tmdb.metadata.runtime ?? '?')}) → "${pair.anime.title}" ${pair.anime.year} (${String(pair.anime.metadata.format)} ${String(pair.anime.partCount)}eps) score=${pair.score.toFixed(2)}`,
      );
    }
    return;
  }

  // Keep the original the first run saw; a second run must not overwrite it.
  const touched = [
    'top-anime-anilist.json',
    'top-movies-tmdb.json',
    'top-series-tmdb.json',
    ...(manga ? ['top-manga-anilist.json'] : []),
  ];
  for (const name of touched) {
    const data = await readFile(resolve(SEED_DIR, name));
    await writeFile(resolve(SEED_DIR, `${name}.pre-dedup.bak`), data, { flag: 'wx' }).catch(
      (error: { code?: string }) => {
        if (error.code !== 'EEXIST') throw error;
      },
    );
  }

  anime.catalog_media = replaceRows(anime.catalog_media, merged);
  if (manga) manga.catalog_media = replaceRows(manga.catalog_media, merged);
  movies.catalog_media = movies.catalog_media.filter((row) => !removedIds.has(row.id));
  series.catalog_media = series.catalog_media.filter((row) => !removedIds.has(row.id));
  for (const file of [anime, manga, movies, series]) {
    if (file) file.deduplicated = { ...log.counts, log: 'dedup-log.json' };
  }

  await writeSeed('top-anime-anilist.json', anime);
  if (manga) await writeSeed('top-manga-anilist.json', manga);
  await writeSeed('top-movies-tmdb.json', movies);
  await writeSeed('top-series-tmdb.json', series);
  // Cumulative: a re-run appends its own pass so the removals it made earlier are
  // still auditable after the seeds have moved on.
  const logPath = resolve(SEED_DIR, 'dedup-log.json');
  const previousText = await readFile(logPath, 'utf8').catch(() => null);
  const previous = previousText
    ? (JSON.parse(previousText) as { runs?: unknown[]; counts?: unknown })
    : null;
  await writeFile(
    logPath,
    `${JSON.stringify(
      {
        ...log,
        runs: [...(previous?.runs ?? (previous ? [previous] : [])), log],
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  console.log(
    `\nRewrote ${touched.length} seeds; ${pairs.length} rows removed, logged to dedup-log.json`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
