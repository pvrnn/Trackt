import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { media, userMedia, type Db } from '@trackt/db';
import type { MediaKind } from '@trackt/shared';
import { IMPORT_SOURCES, type ImportSourceDefinition } from './sources.js';
import { warning, type ImportEntry, type ImportSource, type ImportWarning } from './types.js';

/**
 * Provider id → local media row. The seeds carry `external_ids.mal` (and
 * `.anilist` on the same rows), and the instances materialize it verbatim, so
 * the join needs no title matching: the id either exists here or it does not.
 *
 * Only a source that declares `titleFallback` may guess, and then only on a
 * unique normalised title + exact year — two rows with the same title and year
 * is not a match, it is a coin flip.
 */

export interface ImportTarget {
  id: string;
  kind: MediaKind;
  title: string;
  /** Episodes/chapters the catalog states; null for whole-work kinds and ongoing works. */
  partCount: number | null;
  /** Which season this row is (ADR-0003); null for whole-work kinds. */
  seasonNumber: number | null;
  /** How the row was found — the fallback is guesses, and a report says how many. */
  matchedBy: 'external-id' | 'title';
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
}

/** Lowercase, accent-stripped, punctuation collapsed — the fallback's only equality. */
function normaliseTitle(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

interface CandidateRow {
  id: string;
  kind: MediaKind;
  title: string;
  synonyms: string[];
  year: number | null;
  seasonNumber: number | null;
  partCount: number | null;
}

function targetFrom(row: CandidateRow, matchedBy: ImportTarget['matchedBy']): ImportTarget {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    partCount: row.partCount,
    seasonNumber: row.seasonNumber,
    matchedBy,
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
      bucket.push(row);
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
    const resolved = await resolveByTitle(db, unmatched, definitionFor, warnings);
    for (const [entryId, target] of resolved) targets.set(entryId, target);
  }

  return { targets, warnings };
}

/**
 * The fallback: normalised title (or synonym) equality plus exact year, and only
 * a unique hit. One query per kind, not per entry.
 */
async function resolveByTitle(
  db: Db,
  unmatched: [string, ImportEntry][],
  definitionFor: (entry: ImportEntry) => ImportSourceDefinition,
  warnings: ImportWarning[],
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
    years.add(entry.year);
    yearsByKind.set(entry.kind, years);
  }

  const rowsByKind = new Map<MediaKind, CandidateRow[]>();
  for (const [kind, years] of yearsByKind) {
    rowsByKind.set(
      kind,
      await db
        .select({
          id: media.id,
          kind: media.kind,
          title: media.title,
          synonyms: media.synonyms,
          year: media.year,
          seasonNumber: media.seasonNumber,
          partCount: media.partCount,
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
        .orderBy(media.id),
    );
  }

  for (const [entryId, entry] of candidates) {
    const wanted = normaliseTitle(entry.title);
    if (!wanted) continue;
    const hits = (rowsByKind.get(entry.kind) ?? []).filter(
      (row) =>
        row.year === entry.year &&
        (entry.seasonNumber === null || row.seasonNumber === entry.seasonNumber) &&
        [row.title, ...row.synonyms].some((title) => normaliseTitle(title) === wanted),
    );
    const [hit] = hits;
    if (!hit) continue;
    if (hits.length > 1) {
      warnings.push(
        warning(
          'ambiguous-title-match',
          { externalId: entry.externalId, title: entry.title },
          `"${entry.title}" (${entry.year}) matches ${hits.length} catalog rows — left unmatched rather than guessed`,
        ),
      );
      continue;
    }
    targets.set(entryId, targetFrom(hit, 'title'));
  }

  return targets;
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
