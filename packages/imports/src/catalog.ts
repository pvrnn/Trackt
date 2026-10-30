import { buildProviderMediaRow, insertNewProviderMedia, type Db } from '@trackt/db';
import { fetchCatalogSearch, type CatalogSearchHit } from '@trackt/shared';
import { entryKey, type ImportTarget } from './resolve.js';
import { normaliseTitle } from './titles.js';
import { warning, type ImportEntry, type ImportWarning } from './types.js';

/**
 * The central catalog as a source of *rows*, not of lists.
 *
 * An instance only carries the works it has served (ADR-0002): a search
 * materializes a hit once and never syncs again, so a profile is routinely full
 * of titles the instance has simply never seen — 2 500 of them for a film
 * library. The instance's own resolution sees none of those; the catalog does.
 *
 * So after local resolution, each still-unmatched entry asks the catalog the one
 * question the instance cannot answer — "do you carry this work?" — and, on a
 * real run, materializes the hit exactly as federated search would. The same
 * strictness applies: normalised title (or synonym) equality plus an exact year,
 * a unique hit, and nothing invented. A dry run asks the same question and
 * writes nothing.
 *
 * The catalog is a rate-limited service (300 requests a minute per IP), and a
 * film library is thousands of lookups, so the walk is serialised by default and
 * a 429 is waited out rather than turned into "not in catalog" — the one failure
 * mode that would quietly lie about what the catalog holds.
 */

export interface CatalogLookupOptions {
  /** `CATALOG_URL`; unset means no central catalog, so no lookup. */
  catalogUrl: string;
  /** Injected transport, so tests need no network. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Lookups in flight at once. Above 2 the rate limit starts to bite. */
  concurrency?: number;
  /** Pause between two lookups, per runner: 300/min is the catalog's own ceiling. */
  spacingMs?: number;
  /** Retries on a 429 before the entry is given up on. */
  maxAttempts?: number;
  /** Hard cap on searches for one run — a runaway guard, not a budget. */
  maxLookups?: number;
  /** A dry run reports what it would pull and inserts nothing. */
  materialize: boolean;
}

export interface CatalogLookupResult {
  /** Entries the catalog carries, as plan targets. */
  targets: Map<string, ImportTarget>;
  warnings: ImportWarning[];
  /** Entries asked about. */
  looked: number;
  /** Entries whose lookup failed (rate limit, outage, malformed answer). */
  failed: number;
  /** Hits that were (or would be) inserted — one per entry that found a home. */
  found: number;
}

export interface CatalogMatch {
  entry: ImportEntry;
  hit: CatalogSearchHit;
}

const DEFAULTS = {
  timeoutMs: 3000,
  concurrency: 1,
  spacingMs: 250,
  maxAttempts: 4,
  maxLookups: 20_000,
} as const;

/** Only works the catalog can file the same way the instance does. */
function isEligible(entry: ImportEntry): boolean {
  return entry.year !== null && normaliseTitle(entry.title).length > 0;
}

function hitMatches(entry: ImportEntry, hit: CatalogSearchHit): boolean {
  if (hit.kind !== entry.kind) return false;
  if (entry.seasonNumber !== null && hit.seasonNumber !== entry.seasonNumber) return false;
  if (hit.year !== entry.year) return false;
  const wanted = normaliseTitle(entry.title);
  return [hit.title, ...hit.synonyms].some((title) => normaliseTitle(title) === wanted);
}

/** `fetchCatalogSearch` throws with the status in its message; 429 is the one worth retrying. */
function isRateLimited(error: unknown): boolean {
  return error instanceof Error && /\b429\b/.test(error.message);
}

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

/** Run `worker` over `items` with at most `limit` in flight. */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const index = next++;
      const item = items[index];
      if (item === undefined) return;
      results[index] = await worker(item, index);
    }
  });
  await Promise.all(runners);
  return results;
}

export interface CatalogSearchOutcome {
  matches: CatalogMatch[];
  warnings: ImportWarning[];
  looked: number;
  failed: number;
}

/**
 * Ask the catalog about each entry and keep the unique title+year answers. No
 * database, no writes — which is what makes a preview a preview.
 */
export async function findCatalogMatches(
  entries: ImportEntry[],
  options: Omit<CatalogLookupOptions, 'materialize'>,
): Promise<CatalogSearchOutcome> {
  const {
    catalogUrl,
    fetchImpl = fetch,
    timeoutMs = DEFAULTS.timeoutMs,
    concurrency = DEFAULTS.concurrency,
    spacingMs = DEFAULTS.spacingMs,
    maxAttempts = DEFAULTS.maxAttempts,
    maxLookups = DEFAULTS.maxLookups,
  } = options;

  const warnings: ImportWarning[] = [];
  const eligible = entries.filter(isEligible);
  const candidates = eligible.slice(0, maxLookups);
  if (eligible.length > candidates.length) {
    warnings.push(
      warning(
        'partial-source',
        { externalId: null, title: null },
        `only the first ${maxLookups} unmatched rows were looked up in the central catalog`,
      ),
    );
  }

  let failed = 0;
  const answers = await mapLimit(candidates, concurrency, async (entry) => {
    for (let attempt = 1; ; attempt++) {
      await sleep(spacingMs);
      try {
        const { results } = await fetchCatalogSearch(catalogUrl, entry.title, {
          kind: entry.kind,
          limit: 10,
          timeoutMs,
          fetchImpl,
        });
        return results.filter((hit) => hitMatches(entry, hit));
      } catch (error) {
        if (isRateLimited(error) && attempt < maxAttempts) {
          await sleep(1000 * attempt * attempt);
          continue;
        }
        failed += 1;
        return [] as CatalogSearchHit[];
      }
    }
  });

  const matches: CatalogMatch[] = [];
  for (const [index, hits] of answers.entries()) {
    const entry = candidates[index]!;
    const [hit] = hits;
    if (!hit) continue;
    if (hits.length > 1) {
      warnings.push(
        warning(
          'ambiguous-title-match',
          { externalId: entry.externalId, title: entry.title },
          `the catalog carries ${hits.length} works titled "${entry.title}" (${entry.year}) — left unmatched rather than guessed`,
        ),
      );
      continue;
    }
    matches.push({ entry, hit });
  }

  if (failed > 0) {
    warnings.push(
      warning(
        'partial-source',
        { externalId: null, title: null },
        `${failed} of ${candidates.length} catalog lookups failed (rate limit or outage) — those rows stay unmatched, so re-run rather than trusting "not in catalog"`,
      ),
    );
  }

  return { matches, warnings, looked: candidates.length, failed };
}

export async function lookupCatalog(
  db: Db,
  entries: ImportEntry[],
  options: CatalogLookupOptions,
): Promise<CatalogLookupResult> {
  const { matches, warnings, looked, failed } = await findCatalogMatches(entries, options);
  const targets = new Map<string, ImportTarget>();

  if (matches.length === 0) return { targets, warnings, looked, failed, found: 0 };

  if (!options.materialize) {
    // A preview must not write, but it must still say what the run would bring in.
    for (const { entry, hit } of matches) targets.set(entryKey(entry), targetFrom(hit, hit.id));
    return { targets, warnings, looked, failed, found: targets.size };
  }

  const persisted = await insertNewProviderMedia(
    db,
    matches.map(({ hit }) => buildProviderMediaRow(hit)),
  );
  const byId = new Map(persisted.map((row) => [row.id, row]));

  for (const { entry, hit } of matches) {
    // A row the instance already carried under another slug comes back by id;
    // one missing from the answer was skipped by the insert, so it is not ours.
    const row = byId.get(hit.id);
    if (!row) continue;
    targets.set(entryKey(entry), targetFrom(hit, row.id));
  }

  return { targets, warnings, looked, failed, found: targets.size };
}

function targetFrom(hit: CatalogSearchHit, id: string): ImportTarget {
  return {
    id,
    kind: hit.kind,
    title: hit.title,
    partCount: hit.partCount,
    seasonNumber: hit.seasonNumber,
    matchedBy: 'catalog',
  };
}
