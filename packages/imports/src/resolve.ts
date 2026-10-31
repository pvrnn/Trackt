import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { media, userMedia, type Db } from '@trackt/db';
import type { MediaKind } from '@trackt/shared';
import {
  MAX_YEAR_GAP,
  chooseMatch,
  countriesOf,
  rankMatches,
  type MatchCandidate,
} from './match.js';
import { IMPORT_SOURCES, type ImportSourceDefinition } from './sources.js';
import { uncertainFrom, type UncertainMatch } from './uncertain.js';
import { warning, type ImportEntry, type ImportSource, type ImportWarning } from './types.js';

/**
 * Provider id → local media row. The seeds carry `external_ids.mal` (and
 * `.anilist` on the same rows), and the instances materialize it verbatim, so
 * the join needs no title matching: the id either exists here or it does not.
 *
 * Only a source that declares `titleFallback` may guess, and then only through
 * `chooseMatch`: a scored title (and country, when both sides state one) above
 * the threshold, on an exact year, and only if no second row scores within the
 * tie margin. The score is carried onto the target so the report can say how
 * close the call was.
 */

export interface ImportTarget {
  id: string;
  kind: MediaKind;
  title: string;
  /** Episodes/chapters the catalog states; null for whole-work kinds and ongoing works. */
  partCount: number | null;
  /** Which season this row is (ADR-0003); null for whole-work kinds. */
  seasonNumber: number | null;
  /** How the row was found — `title` is a guess, `catalog` came from the central catalog. */
  matchedBy: 'external-id' | 'title' | 'catalog';
  /** 0–1 when the row was guessed, null when a provider id pinned it exactly. */
  matchScore: number | null;
}

/**
 * The plan's key. The season is part of it because one provider show yields one
 * entry per season while the catalog files one row per season.
 */
export function entryKey(entry: ImportEntry): string {
  const base = `${entry.source}:${entry.kind}:${entry.externalId}`;
  return entry.seasonNumber === null ? base : `${base}:${entry.seasonNumber}`;
}

export interface ResolveResult {
  targets: Map<string, ImportTarget>;
  warnings: ImportWarning[];
  /**
   * For an entry the score could not settle: the local shortlist, so a report
   * says "79%, The Prey" and a picker has something to show.
   */
  uncertain: Map<string, UncertainMatch>;
}

interface CandidateRow extends MatchCandidate {
  id: string;
  kind: MediaKind;
  synonyms: string[];
  year: number | null;
  seasonNumber: number | null;
  partCount: number | null;
}

function targetFrom(
  row: CandidateRow,
  matchedBy: ImportTarget['matchedBy'],
  matchScore: number | null = null,
): ImportTarget {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    partCount: row.partCount,
    seasonNumber: row.seasonNumber,
    matchedBy,
    matchScore,
  };
}

/**
 * Resolve the entries' provider ids against the instance's `media` rows.
 *
 * Rows the viewer cannot see are not resolvable on purpose — the same
 * `deleted_at IS NULL AND moderation = 'verified'` rule as `canViewMedia`: a
 * work pulled from circulation must not silently collect the import's progress,
 * and an old unverified user-entry row must not become the target of one.
 */
export async function resolveImportEntries(
  db: Db,
  entries: ImportEntry[],
  definitions: Record<ImportSource, ImportSourceDefinition> = IMPORT_SOURCES,
): Promise<ResolveResult> {
  const targets = new Map<string, ImportTarget>();
  const warnings: ImportWarning[] = [];
  const uncertain = new Map<string, UncertainMatch>();
  const pending = new Map<string, ImportEntry>();

  const definitionFor = (entry: ImportEntry): ImportSourceDefinition => definitions[entry.source];

  // Every (join key, value) pair the batch asks for, grouped so the database is
  // asked once per key rather than once per entry.
  const idsByKey = new Map<string, Set<string>>();
  for (const entry of entries) {
    pending.set(entryKey(entry), entry);
    for (const key of definitionFor(entry).joinKeys) {
      const value = entry.externalIds[key];
      if (value === undefined || value === null || value === '') continue;
      const ids = idsByKey.get(key) ?? new Set<string>();
      ids.add(String(value));
      idsByKey.set(key, ids);
    }
  }

  /** Provider id per join key → the rows carrying it, in a stable order. */
  const rowsByKey = new Map<string, Map<string, CandidateRow[]>>();

  for (const [key, ids] of idsByKey) {
    const externalId = sql<string>`${media.externalIds}->>${key}`;
    const rows = await db
      .select({
        id: media.id,
        kind: media.kind,
        title: media.title,
        synonyms: media.synonyms,
        year: media.year,
        seasonNumber: media.seasonNumber,
        partCount: media.partCount,
        externalId,
        // The TMDB importer's metadata carries ISO-3166 codes; a source that
        // states a country is only a tie-breaker, so an absent one is normal.
        originCountry: sql<unknown>`${media.metadata}->'originCountry'`,
      })
      .from(media)
      .where(
        and(
          isNull(media.deletedAt),
          eq(media.moderation, 'verified'),
          inArray(externalId, [...ids]),
        ),
      )
      .orderBy(media.id);

    const byId = new Map<string, CandidateRow[]>();
    for (const row of rows) {
      const bucket = byId.get(row.externalId) ?? [];
      bucket.push({ ...row, originCountry: countriesOf(row.originCountry) });
      byId.set(row.externalId, bucket);
    }
    rowsByKey.set(key, byId);
  }

  for (const [entryId, entry] of pending) {
    for (const key of definitionFor(entry).joinKeys) {
      const value = entry.externalIds[key];
      if (value === undefined || value === null || value === '') continue;
      const candidates = (rowsByKey.get(key)?.get(String(value)) ?? []).filter(
        (row) =>
          row.kind === entry.kind &&
          (entry.seasonNumber === null || row.seasonNumber === entry.seasonNumber),
      );
      const [first, ...rest] = candidates;
      if (!first) continue;
      if (rest.length > 0) {
        warnings.push(
          warning(
            'duplicate-external-id',
            { externalId: entry.externalId, title: entry.title },
            `${key} ${value} matches both "${first.title}" and "${rest[0]!.title}" — using the first`,
          ),
        );
      }
      targets.set(entryId, targetFrom(first, 'external-id'));
      break;
    }
  }

  const unmatched = [...pending].filter(([entryId]) => !targets.has(entryId));
  if (unmatched.length > 0) {
    const resolved = await resolveByTitle(db, unmatched, definitionFor, warnings, uncertain);
    for (const [entryId, target] of resolved) targets.set(entryId, target);
  }

  return { targets, warnings, uncertain };
}

/**
 * The fallback: a scored title match, corroborated by the year and (when both
 * sides state one) the country, and only when no second row comes within the
 * tie margin. Candidates are every row of the entry's kind within ±2 years;
 * the year itself is scored, so a one-year disagreement still matches.
 * One query per kind, not per entry.
 */
async function resolveByTitle(
  db: Db,
  unmatched: [string, ImportEntry][],
  definitionFor: (entry: ImportEntry) => ImportSourceDefinition,
  warnings: ImportWarning[],
  uncertain: Map<string, UncertainMatch>,
): Promise<Map<string, ImportTarget>> {
  const targets = new Map<string, ImportTarget>();
  const candidates = unmatched.filter(
    ([, entry]) => definitionFor(entry).titleFallback && entry.year !== null,
  );
  if (candidates.length === 0) return targets;

  const yearsByKind = new Map<MediaKind, Set<number>>();
  for (const [, entry] of candidates) {
    if (entry.year === null) continue;
    const years = yearsByKind.get(entry.kind) ?? new Set<number>();
    // A provider dates a film by its own release, so the same work can sit one
    // or two years away; the score, not the query, decides what that means.
    for (let delta = -MAX_YEAR_GAP; delta <= MAX_YEAR_GAP; delta++) years.add(entry.year + delta);
    yearsByKind.set(entry.kind, years);
  }

  const rowsByKind = new Map<MediaKind, CandidateRow[]>();
  for (const [kind, years] of yearsByKind) {
    const rows = await db
      .select({
        id: media.id,
        kind: media.kind,
        title: media.title,
        synonyms: media.synonyms,
        year: media.year,
        seasonNumber: media.seasonNumber,
        partCount: media.partCount,
        originCountry: sql<unknown>`${media.metadata}->'originCountry'`,
      })
      .from(media)
      .where(
        and(
          eq(media.kind, kind),
          inArray(media.year, [...years]),
          isNull(media.deletedAt),
          eq(media.moderation, 'verified'),
        ),
      )
      .orderBy(media.id);
    rowsByKind.set(
      kind,
      rows.map((row) => ({ ...row, originCountry: countriesOf(row.originCountry) })),
    );
  }

  for (const [entryId, entry] of candidates) {
    const subject = {
      title: entry.title,
      year: entry.year,
      originCountry: entry.originCountry,
    };
    const nearYear = (rowsByKind.get(entry.kind) ?? []).filter(
      (row) =>
        row.year !== null &&
        Math.abs(row.year - entry.year!) <= MAX_YEAR_GAP &&
        (entry.seasonNumber === null || row.seasonNumber === entry.seasonNumber),
    );
    const ranked = rankMatches(subject, nearYear);
    const decided = chooseMatch(subject, nearYear);
    if (!decided) {
      // Not close enough to match — but close enough that "which row?" is a
      // question worth keeping, and the shortlist is what a picker renders.
      const shortlist = uncertainFrom(ranked, 'local', false);
      if (shortlist) uncertain.set(entryId, shortlist);
      continue;
    }
    if (decided.ambiguous) {
      const [first, second] = decided.ranked;
      const shortlist = uncertainFrom(ranked, 'local', true);
      if (shortlist) uncertain.set(entryId, shortlist);
      warnings.push(
        warning(
          'ambiguous-title-match',
          { externalId: entry.externalId, title: entry.title },
          `"${entry.title}" (${entry.year}) matches "${first!.candidate.title}" and "${second!.candidate.title}" alike (${percent(first!.score.score)} vs ${percent(second!.score.score)}) — left unmatched rather than guessed`,
        ),
      );
      continue;
    }

    const { candidate, score } = decided.best;
    targets.set(entryId, targetFrom(candidate, 'title', score.score));
    // An identical normalised title is the rule the importer always had; only an
    // approximated one is news, and it is the row a person should eyeball.
    if (score.title < 1) {
      warnings.push(
        warning(
          'fuzzy-title-match',
          { externalId: entry.externalId, title: entry.title },
          `"${entry.title}" (${entry.year}) matched "${candidate.title}" at ${percent(score.score)} on title — worth a glance`,
        ),
      );
    }
  }

  return targets;
}

/** `0.87` → `87%`, for a warning a person reads. */
function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/** Local media ids among `mediaIds` the viewer already has a log row for. */
export async function findLoggedMediaIds(
  db: Db,
  userId: string,
  mediaIds: string[],
): Promise<Set<string>> {
  if (mediaIds.length === 0) return new Set();
  const rows = await db
    .select({ mediaId: userMedia.mediaId })
    .from(userMedia)
    .where(and(eq(userMedia.userId, userId), inArray(userMedia.mediaId, mediaIds)));
  return new Set(rows.map((row) => row.mediaId));
}
