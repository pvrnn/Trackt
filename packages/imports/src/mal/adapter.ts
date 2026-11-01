import { ImportError } from '../errors.js';
import { createImportFetcher } from '../http/fetch.js';
import { entryKey } from '../resolve.js';
import {
  warning,
  type FetchedEntries,
  type FetchEntriesOptions,
  type ImportEntry,
  type ImportKind,
  type ImportWarning,
} from '../types.js';
import { createMalClient } from './client.js';
import { mapMalEntry } from './map.js';
import type { MalListRow } from './schemas.js';

const LIST_KINDS: ImportKind[] = ['anime', 'manga'];

function keyOf(kind: ImportKind, externalId: string): string {
  return `${kind}:${externalId}`;
}

/**
 * Both lists plus the profile's favourites, mapped into one entry per work.
 * A favourite is a flag on the row the lists already carry; a favourite with no
 * list row is reported rather than invented, because a favourite in Trackt is a
 * pin on a logged work and the provider never said how far it was seen.
 */
export async function fetchMalEntries(options: FetchEntriesOptions): Promise<FetchedEntries> {
  const local = options.fetcher
    ? null
    : createImportFetcher({
        ...(options.requestSpacingMs !== undefined
          ? { requestSpacingMs: options.requestSpacingMs }
          : {}),
      });
  const fetcher = options.fetcher ?? local!;
  const warnings: ImportWarning[] = [];

  try {
    const client = createMalClient({
      fetcher,
      ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
      ...(options.requestSpacingMs !== undefined
        ? { requestSpacingMs: options.requestSpacingMs }
        : {}),
    });

    const rows: MalListRow[] = [];
    for (const kind of LIST_KINDS) rows.push(...(await client.fetchList(kind, options.profile)));

    // Favourites are their own page, and the one thing the lists do not carry:
    // a page that refuses costs the flags, not the import.
    let favorites: Set<string> | null = null;
    const notListed: { externalId: string; title: string }[] = [];
    try {
      const page = await client.fetchFavorites(options.profile);
      if (page.sections === 0) {
        warnings.push(
          warning(
            'partial-source',
            { externalId: null, title: null },
            'the favourites page carried no Anime or Manga section — no favourites were imported',
          ),
        );
      }
      const listed = new Set(rows.map((row) => keyOf(row.kind, row.externalId)));
      favorites = new Set<string>();
      for (const favorite of page.items) {
        const key = keyOf(favorite.kind, favorite.externalId);
        if (favorites.has(key)) continue;
        favorites.add(key);
        if (!listed.has(key)) {
          notListed.push({ externalId: favorite.externalId, title: favorite.title });
        }
      }
    } catch (error) {
      if (!(error instanceof ImportError)) throw error;
      warnings.push(
        warning(
          'partial-source',
          { externalId: null, title: null },
          `the favourites page could not be read (${error.message}) — no favourites from it`,
        ),
      );
    }

    for (const row of notListed) {
      warnings.push(
        warning(
          'favourite-not-listed',
          row,
          `"${row.title}" is pinned as a favourite but is on neither list — skipped, because an import cannot pin a work it never logged`,
        ),
      );
    }

    const entries: ImportEntry[] = [];
    const entryWarnings = new Map<string, ImportWarning[]>();
    for (const raw of rows) {
      const mapped = mapMalEntry(raw, {
        ...(options.now ? { now: options.now } : {}),
        favourite: favorites?.has(keyOf(raw.kind, raw.externalId)) === true,
      });
      if (!mapped.entry) {
        // A row the mapper refused is not in the plan, so its warning has to
        // travel on its own rather than with the entry's.
        warnings.push(...mapped.warnings);
        continue;
      }
      entryWarnings.set(entryKey(mapped.entry), mapped.warnings);
      entries.push(mapped.entry);
    }

    return { entries, entryWarnings, warnings };
  } finally {
    await local?.dispose();
  }
}
