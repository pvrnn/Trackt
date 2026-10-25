/**
 * Bulk driver: walk MyAnimeList's top-anime ranking and scrape every entry.
 *
 * `topanime.php?limit=N` renders 50 rows per page, so ranks 1..10000 are 200
 * list pages and 10000 detail pages. This walks them in order, reusing
 * `scrape.ts` for the per-page parsing and mapping, and writes one seed file
 * plus a state file it resumes from.
 *
 * Cost at the default politeness: ~1.5 s per request, so roughly 4-5 hours for
 * the full 10000 — MAL detail pages dominate; AniList is batched 20 ids per
 * query and the ids it hands back are cached in the state file.
 *
 * Run: `node scripts/mal-scrape/top-anime.ts --max-rank 100 --dry-run` first.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  type AniListRecord,
  type MalPageType,
  type Payload,
  type ScrapedWork,
  type SeedFile,
  assemblePayload,
  buildWork,
  decodeEntities,
  emptySeed,
  fetchMalPage,
  mergeSeedFiles,
  parseMalPage,
  publishPayload,
  readSeedFile,
  resolveAniList,
  toSeedFile,
} from './scrape.ts';

/* ------------------------------------------------------------------ *
 * The ranking table
 * ------------------------------------------------------------------ */

export interface TopAnimeEntry {
  rank: number;
  malId: number;
  url: string;
  title: string;
  /** MAL's format chip from the information line: `TV`, `Movie`, `ONA`, `Special`, `Music`. */
  format: string | null;
  episodes: number | null;
  /** `1,535,892 members`, digits only. */
  members: number | null;
  score: number | null;
}

/** Rows per ranking page — MAL's `limit` step. */
export const PAGE_SIZE = 50;

/**
 * Refuse to keep hammering a site that is refusing us. MAL sits behind a WAF, and
 * a sustained block would otherwise mark thousands of entries "failed" — which
 * `--retry-failed` would then replay — instead of leaving the cursor where it is.
 */
export const MAX_CONSECUTIVE_FAILURES = 5;

/** MAL formats `mapKind` accepts on an anime page. Anything else is not a work. */
export const DEFAULT_TYPES = ['tv', 'movie', 'ona', 'ova', 'special', 'tv special'];

export function listUrl(limit: number): string {
  return `https://myanimelist.net/topanime.php?limit=${limit}`;
}

/** The `limit` value whose page contains `rank`. */
export function limitForRank(rank: number): number {
  return Math.floor((Math.max(rank, 1) - 1) / PAGE_SIZE) * PAGE_SIZE;
}

function toCount(value: string | undefined): number | null {
  if (!value) return null;
  const digits = value.replace(/[^\d]/g, '');
  return digits ? Number(digits) : null;
}

/**
 * One ranking row:
 *
 * ```html
 * <tr class="ranking-list">
 *   <td class="rank ac"><span class="lightLink top-anime-rank-text rank1">1</span></td>
 *   <td class="title al va-t word-break">
 *     … <h3 …><a href="https://myanimelist.net/anime/52991/…" …>Sousou no Frieren</a></h3>
 *     <div class="information di-ib mt4">TV (28 eps)<br>Sep 2023 - Mar 2024<br>1,535,892 members</div>
 *   </td>
 *   <td class="score ac fs14"><span class="text on score-label score-9">9.24</span></td>
 *   …
 * </tr>
 * ```
 */
export function parseTopAnimeRow(row: string): TopAnimeEntry | null {
  const rank = /top-anime-rank-text[^"]*">(\d+)</.exec(row);
  const link = /<h3[^>]*>\s*<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(row);
  if (!rank || !link) return null;
  const identity = /\/(anime|manga)\/(\d+)/.exec(link[1]!);
  if (!identity) return null;

  const information = /<div class="information[^"]*">([\s\S]*?)<\/div>/.exec(row)?.[1] ?? '';
  const firstLine = information.split(/<br\s*\/?>/i)[0] ?? '';
  const format = /^\s*([A-Za-z ]+?)\s*(?:\(|$)/.exec(firstLine.replace(/<[^>]+>/g, ''))?.[1];
  const episodes = /\((\d+)\s*eps?\)/i.exec(firstLine);
  const members = /([\d,]+)\s*members/i.exec(information);
  const score = /score-label[^"]*">([\d.]+)</.exec(row);

  return {
    rank: Number(rank[1]),
    malId: Number(identity[2]),
    url: link[1]!,
    title: decodeEntities(link[2]!.replace(/<[^>]+>/g, ''))
      .replace(/\s+/g, ' ')
      .trim(),
    format: format ? format.trim() : null,
    episodes: episodes ? Number(episodes[1]) : null,
    members: members ? toCount(members[1]) : null,
    score: score ? Number(score[1]) : null,
  };
}

export function parseTopAnimePage(html: string): TopAnimeEntry[] {
  const entries: TopAnimeEntry[] = [];
  for (const [, row = ''] of html.matchAll(/<tr class="ranking-list"[^>]*>([\s\S]*?)<\/tr>/g)) {
    const entry = parseTopAnimeRow(row);
    if (entry) entries.push(entry);
  }
  return entries;
}

/* ------------------------------------------------------------------ *
 * Identity cache — survives a restart
 * ------------------------------------------------------------------ */

/**
 * `(malType, malId) → AniList record`, remembering ids across runs in the state
 * file. Relation targets are looked up far more often than they are scraped
 * (each work pulls in a handful), so re-querying them after a restart would
 * dwarf the pagination cost.
 *
 * A record restored from the state file carries only its id — enough to derive
 * a canonical id for a relation target, not enough to enrich a row. `ensure`
 * therefore re-queries a cached id when the caller needs the full record.
 */
export class IdentityCache {
  private readonly records = new Map<string, AniListRecord>();
  /** Ids AniList does not carry. Without this they are re-queried on every page. */
  private readonly missing = new Set<string>();
  private readonly full = new Set<string>();
  private readonly resolver: typeof resolveAniList;

  constructor(
    restored: Record<string, number> = {},
    options: { missing?: string[]; resolver?: typeof resolveAniList } = {},
  ) {
    this.resolver = options.resolver ?? resolveAniList;
    for (const [key, id] of Object.entries(restored)) {
      this.records.set(key, { id, idMal: null, title: {} });
    }
    for (const key of options.missing ?? []) this.missing.add(key);
  }

  static key(malType: MalPageType, malId: number): string {
    return `${malType}:${malId}`;
  }

  get(malType: MalPageType, malId: number): AniListRecord | undefined {
    return this.records.get(IdentityCache.key(malType, malId));
  }

  toJSON(): Record<string, number> {
    return Object.fromEntries([...this.records].map(([key, record]) => [key, record.id]));
  }

  toMissingJSON(): string[] {
    return [...this.missing];
  }

  /** True when this id has already been asked for and refused. */
  isMissing(malType: MalPageType, malId: number): boolean {
    return this.missing.has(IdentityCache.key(malType, malId));
  }

  /**
   * Resolve anything missing. `needsFull` marks the keys whose fields (genres,
   * counts, synonyms) will be used, so an id-only cached record is refreshed.
   */
  async ensure(
    refs: { malType: MalPageType; malId: number }[],
    options: { needsFull?: Set<string>; delayMs?: number; onWarn?: (message: string) => void } = {},
  ): Promise<void> {
    const needsFull = options.needsFull ?? new Set<string>();
    const missing = [
      ...new Map(
        refs
          .filter((ref) => {
            const key = IdentityCache.key(ref.malType, ref.malId);
            if (this.missing.has(key)) return false;
            return !this.records.has(key) || (needsFull.has(key) && !this.full.has(key));
          })
          .map((ref) => [IdentityCache.key(ref.malType, ref.malId), ref]),
      ).values(),
    ];
    if (missing.length === 0) return;
    const resolved = await this.resolver(missing, {
      delayMs: options.delayMs,
      onWarn: options.onWarn,
    });
    for (const [key, record] of resolved) {
      this.records.set(key, record);
      this.full.add(key);
    }
    for (const ref of missing) {
      const key = IdentityCache.key(ref.malType, ref.malId);
      if (!this.records.has(key)) this.missing.add(key);
    }
  }
}

/* ------------------------------------------------------------------ *
 * Resume state
 * ------------------------------------------------------------------ */

export interface RunState {
  /** The `limit` of the next ranking page to read. Pages before it are done. */
  nextLimit: number;
  /** MAL ids already scraped, so a resumed run never refetches them. */
  done: number[];
  /** MAL ids that failed, with why. `--retry-failed` replays exactly these. */
  failed: Record<string, string>;
  /** MAL ids deliberately not catalogued (a `Music` entry, a novel). Not errors. */
  skipped: Record<string, string>;
  /** `(malType:malId) → AniList id`, so relation targets resolve without a query. */
  resolved: Record<string, number>;
  /** Ids AniList refused; asking again every page is what made early pages slow. */
  missing: string[];
}

export function emptyState(): RunState {
  return { nextLimit: 0, done: [], failed: {}, skipped: {}, resolved: {}, missing: [] };
}

export function parseState(raw: string): RunState {
  const parsed = JSON.parse(raw) as Partial<RunState>;
  const records = (value: unknown): Record<string, string> =>
    value && typeof value === 'object' ? (value as Record<string, string>) : {};
  return {
    nextLimit: typeof parsed.nextLimit === 'number' ? parsed.nextLimit : 0,
    done: Array.isArray(parsed.done) ? parsed.done.filter((id) => Number.isInteger(id)) : [],
    failed: records(parsed.failed),
    skipped: records(parsed.skipped),
    resolved:
      parsed.resolved && typeof parsed.resolved === 'object'
        ? (parsed.resolved as Record<string, number>)
        : {},
    missing: Array.isArray(parsed.missing)
      ? parsed.missing.filter((key) => typeof key === 'string')
      : [],
  };
}

/* ------------------------------------------------------------------ *
 * CLI
 * ------------------------------------------------------------------ */

const HELP = `Walk MyAnimeList's top-anime ranking and scrape every entry into one seed file.

Usage:
  node scripts/mal-scrape/top-anime.ts [options]

Range:
  --max-rank <n>         stop after this rank (default 10000)
  --from-rank <n>        start at this rank (default 1)
  --types <list>         MAL formats to keep, comma-separated
                         (default ${DEFAULT_TYPES.join(',')})

Output:
  --out <file>           seed file (default apps/catalog/seed/top-anime.json)
  --state <file>         resume state (default <out>.state.json)
  --dry-run              list what would be scraped, write nothing
  --no-anilist           skip AniList (dry-run only: ids would be unknown)
  --publish              POST the accumulated seed when the walk finishes
  --catalog-url <url>    default $CATALOG_URL
  --token <token>        default $CATALOG_ADMIN_TOKEN

Resuming (always on):
  --restart              ignore the state file, start over from --from-rank
  --retry-failed         replay entries that errored, keeping finished ones

Politeness:
  --delay <ms>           wait between MAL requests (default 1500)
  --user-agent <ua>      override the identifying User-Agent

  --help                 this text
`;

export interface TopOptions {
  maxRank: number;
  fromRank: number;
  types: Set<string>;
  out: string;
  statePath: string;
  dryRun: boolean;
  anilist: boolean;
  publish: boolean;
  catalogUrl?: string;
  token?: string;
  restart: boolean;
  retryFailed: boolean;
  delayMs: number;
  userAgent?: string;
  help: boolean;
}

export function parseTopArgs(argv: string[]): TopOptions {
  const options: TopOptions = {
    maxRank: 10000,
    fromRank: 1,
    types: new Set(DEFAULT_TYPES),
    out: 'apps/catalog/seed/top-anime.json',
    statePath: '',
    dryRun: false,
    anilist: true,
    publish: false,
    restart: false,
    retryFailed: false,
    delayMs: 1500,
    help: false,
  };
  const flags = new Set([
    '--dry-run',
    '--no-anilist',
    '--publish',
    '--restart',
    '--retry-failed',
    '--help',
  ]);
  const valued: Record<string, (value: string) => void> = {
    '--max-rank': (value) => (options.maxRank = Number(value)),
    '--from-rank': (value) => (options.fromRank = Number(value)),
    '--types': (value) =>
      (options.types = new Set(
        value
          .toLowerCase()
          .split(',')
          .map((type) => type.trim()),
      )),
    '--out': (value) => (options.out = value),
    '--state': (value) => (options.statePath = value),
    '--catalog-url': (value) => (options.catalogUrl = value),
    '--token': (value) => (options.token = value),
    '--delay': (value) => (options.delayMs = Number(value)),
    '--user-agent': (value) => (options.userAgent = value),
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (flags.has(arg)) {
      if (arg === '--dry-run') options.dryRun = true;
      if (arg === '--no-anilist') options.anilist = false;
      if (arg === '--publish') options.publish = true;
      if (arg === '--restart') options.restart = true;
      if (arg === '--retry-failed') options.retryFailed = true;
      if (arg === '--help') options.help = true;
      continue;
    }
    const setter = valued[arg];
    if (!setter) throw new Error(`unknown option ${arg}`);
    const value = argv[++index];
    if (value === undefined) throw new Error(`${arg} needs a value`);
    setter(value);
  }

  if (!Number.isInteger(options.maxRank) || options.maxRank < 1) {
    throw new Error('--max-rank must be a positive integer');
  }
  if (!Number.isInteger(options.fromRank) || options.fromRank < 1) {
    throw new Error('--from-rank must be a positive integer');
  }
  if (options.fromRank > options.maxRank) throw new Error('--from-rank is past --max-rank');
  if (!Number.isFinite(options.delayMs) || options.delayMs < 0) {
    throw new Error('--delay must be a non-negative number of milliseconds');
  }
  if (!options.statePath) options.statePath = `${options.out}.state.json`;
  return options;
}

/* ------------------------------------------------------------------ *
 * The walk
 * ------------------------------------------------------------------ */

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function clock(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h${String(minutes % 60).padStart(2, '0')}m`;
  if (minutes > 0) return `${minutes}m${String(seconds % 60).padStart(2, '0')}s`;
  return `${seconds}s`;
}

export interface WalkResult {
  seed: SeedFile;
  state: RunState;
  scraped: number;
  failed: number;
  filtered: number;
  pages: number;
  /** Set in dry-run mode: what the walk would have fetched. */
  planned: TopAnimeEntry[];
}

export interface WalkDeps {
  fetchHtml?: (url: string, delayMs: number) => Promise<string>;
  readSeed?: (path: string) => Promise<SeedFile | null>;
  readState?: (path: string) => Promise<RunState | null>;
  writeSeed?: (path: string, seed: SeedFile) => Promise<void>;
  writeState?: (path: string, state: RunState) => Promise<void>;
  log?: (message: string) => void;
  now?: () => number;
  resolveAniList?: typeof resolveAniList;
}

/**
 * The loop itself. Everything it touches on disk and over the network is a
 * dependency, so the whole walk is testable against a fake list and fake pages.
 */
export async function walkRanking(options: TopOptions, deps: WalkDeps = {}): Promise<WalkResult> {
  const fetchHtml = deps.fetchHtml ?? ((url, delayMs) => fetchMalPage(url, { delayMs }));
  const readSeed = deps.readSeed ?? readSeedFile;
  const readState =
    deps.readState ??
    (async (path: string) => {
      try {
        return parseState(await readFile(path, 'utf8'));
      } catch {
        return null;
      }
    });
  const writeSeed =
    deps.writeSeed ??
    ((path, seed) => writeFile(path, `${JSON.stringify(seed, null, 2)}\n`, 'utf8'));
  const writeState =
    deps.writeState ??
    ((path, state) => writeFile(path, `${JSON.stringify(state, null, 2)}\n`, 'utf8'));
  const log = deps.log ?? ((message: string) => process.stderr.write(`${message}\n`));
  const now = deps.now ?? (() => Date.now());

  let state: RunState;
  if (options.restart) {
    state = emptyState();
  } else {
    state = (await readState(options.statePath)) ?? emptyState();
    if (options.retryFailed) {
      // The walk only moves forward, so replaying a failure means scanning from
      // the first page again; `done` is what keeps the finished entries cheap.
      state = { ...state, nextLimit: 0, failed: {} };
    }
  }
  const done = new Set(state.done);
  const cache = new IdentityCache(state.resolved, {
    missing: state.missing,
    resolver: deps.resolveAniList,
  });
  let seed = options.dryRun ? emptySeed() : ((await readSeed(options.out)) ?? emptySeed());

  const startLimit = Math.max(limitForRank(options.fromRank), state.nextLimit);
  const startedAt = now();
  const planned: TopAnimeEntry[] = [];
  let scraped = 0;
  let failed = 0;
  let filtered = 0;
  let pages = 0;

  for (let limit = startLimit; limit < options.maxRank; limit += PAGE_SIZE) {
    const entries = parseTopAnimePage(await fetchHtml(listUrl(limit), options.delayMs)).filter(
      (entry) => entry.rank >= options.fromRank && entry.rank <= options.maxRank,
    );
    if (entries.length === 0) {
      log(`${listUrl(limit)}: no rows — the ranking ends here`);
      break;
    }
    pages++;
    const wanted = entries.filter((entry) => {
      const keep = !entry.format || options.types.has(entry.format.toLowerCase());
      if (!keep) filtered++;
      return keep;
    });

    if (options.dryRun) {
      for (const entry of wanted) {
        planned.push(entry);
        process.stdout.write(
          `${entry.rank}\t${entry.malId}\t${entry.format ?? '?'}\t${entry.episodes ?? '?'}\t${entry.title}\n`,
        );
      }
      scraped += wanted.length;
      continue;
    }

    const works: ScrapedWork[] = [];
    let pageScraped = 0;
    let pageFailed = 0;
    let consecutiveFailures = 0;
    for (const entry of wanted) {
      if (done.has(entry.malId) || entry.malId in state.failed || entry.malId in state.skipped) {
        continue;
      }
      if (options.delayMs > 0) await sleep(options.delayMs);
      try {
        const page = parseMalPage(await fetchHtml(entry.url, options.delayMs), entry.url);
        const built = buildWork(page);
        if ('skipped' in built) {
          state.skipped[String(entry.malId)] = built.skipped;
          filtered++;
          continue;
        }
        works.push(built);
        done.add(entry.malId);
        pageScraped++;
        consecutiveFailures = 0;
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        state.failed[String(entry.malId)] = reason;
        pageFailed++;
        consecutiveFailures++;
        log(`  rank ${entry.rank} (${entry.malId}) failed: ${reason}`);
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          await writeState(options.statePath, { ...state, done: [...done] });
          throw new Error(
            `${consecutiveFailures} consecutive failures — stopping at rank ${entry.rank}. ` +
              `The cursor is unchanged past page ${limit}: resume later with the same command.`,
          );
        }
      }
    }

    if (options.anilist && works.length > 0) {
      const workKeys = new Set(
        works.map((work) => IdentityCache.key(work.page.malType, work.page.malId)),
      );
      await cache.ensure(
        [
          ...works.map((work) => ({ malType: work.page.malType, malId: work.page.malId })),
          ...works.flatMap((work) =>
            work.relations.map((relation) => ({
              malType: relation.target.malType,
              malId: relation.target.malId,
            })),
          ),
        ],
        {
          needsFull: workKeys,
          delayMs: options.delayMs,
          onWarn: (message) => log(`  anilist: ${message}`),
        },
      );
    }

    if (works.length > 0) {
      const records = new Map<string, AniListRecord>();
      const remember = (malType: MalPageType, malId: number) => {
        const record = cache.get(malType, malId);
        if (record) records.set(IdentityCache.key(malType, malId), record);
      };
      for (const work of works) {
        remember(work.page.malType, work.page.malId);
        for (const relation of work.relations)
          remember(relation.target.malType, relation.target.malId);
      }
      seed = mergeSeedFiles(seed, toSeedFile(assemblePayload(works, { anilist: records })));
      await writeSeed(options.out, seed);
    }

    // The cursor may only move past a page this run covered end to end: a slice
    // (`--max-rank 3`, `--from-rank 900`) must not mark the rest of its page done,
    // or a later full run would resume after it and never see those rows.
    if (limit + 1 >= options.fromRank && limit + PAGE_SIZE <= options.maxRank) {
      state.nextLimit = limit + PAGE_SIZE;
    }
    state.done = [...done];
    state.resolved = cache.toJSON();
    state.missing = cache.toMissingJSON();
    await writeState(options.statePath, state);
    scraped += pageScraped;
    failed += pageFailed;

    log(
      `page ${pages} (ranks ${entries[0]!.rank}-${entries.at(-1)!.rank}): ` +
        `${pageScraped} scraped, ${pageFailed} failed | ` +
        `seed ${seed.catalog_media.length} media / ${seed.catalog_media_relation.length} edges | ` +
        `${clock(now() - startedAt)}`,
    );
  }

  return { seed, state, scraped, failed, filtered, pages, planned };
}

/** The seed file's shape, widened to the publish contract (provenance filled by the walk). */
export function seedToPayload(seed: SeedFile): Payload {
  return {
    generatedAt: seed.generatedAt,
    sources: seed.report.sources,
    media: seed.catalog_media.map((row) => ({ ...row })),
    relations: seed.catalog_media_relation.map((edge) => ({ ...edge })),
    skipped: seed.report.skipped,
    warnings: seed.report.warnings,
  };
}

export async function run(argv: string[]): Promise<number> {
  const options = parseTopArgs(argv);
  if (options.help) {
    process.stdout.write(HELP);
    return 0;
  }
  if (!options.anilist && !options.dryRun) {
    throw new Error(
      '--no-anilist cannot write a seed file: without AniList there is no canonical id',
    );
  }
  if (!options.dryRun) {
    await mkdir(dirname(options.out), { recursive: true });
    await mkdir(dirname(options.statePath), { recursive: true });
  }

  const startedAt = Date.now();
  const result = await walkRanking(options);
  if (options.dryRun) {
    process.stderr.write(
      `\n${result.planned.length} entries across ${result.pages} pages would be scraped ` +
        `(${result.filtered} filtered by --types); nothing was written\n`,
    );
    return 0;
  }

  process.stderr.write(
    `\nwalked ${result.pages} pages: ${result.scraped} scraped, ${result.failed} failed, ` +
      `${result.filtered} filtered in ${clock(Date.now() - startedAt)}\n` +
      `seed: ${options.out} (${result.seed.catalog_media.length} media, ` +
      `${result.seed.catalog_media_relation.length} relations)\n` +
      `state: ${options.statePath}\n`,
  );
  const failures = Object.keys(result.state.failed).length;
  if (failures > 0) {
    process.stderr.write(
      `${failures} entries failed — see ${options.statePath}, then rerun with --retry-failed\n`,
    );
  }
  if (!options.publish) return 0;

  const catalogUrl = options.catalogUrl ?? process.env.CATALOG_URL;
  const token = options.token ?? process.env.CATALOG_ADMIN_TOKEN;
  if (!catalogUrl || !token) {
    throw new Error(
      '--publish needs --catalog-url ($CATALOG_URL) and --token ($CATALOG_ADMIN_TOKEN)',
    );
  }
  // Publishing is idempotent, so the whole accumulated file is re-sent as one
  // batch: a partial previous publish is simply completed.
  const published = await publishPayload(seedToPayload(result.seed), {
    catalogUrl,
    token,
    onProgress: (message) => process.stderr.write(`${message}\n`),
  });
  process.stderr.write(
    `published ${published.media.length} media, ${published.relations.length} relations, ${published.failures.length} failures\n`,
  );
  for (const failure of published.failures) process.stderr.write(`failure: ${failure}\n`);
  return published.failures.length > 0 ? 1 : 0;
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  run(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
