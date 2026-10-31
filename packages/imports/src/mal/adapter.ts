import { entryKey } from '../resolve.js';
import type {
  FetchEntriesOptions,
  FetchedEntries,
  ImportEntry,
  ImportKind,
  ImportWarning,
} from '../types.js';
import { createMalClient } from './client.js';
import { mapMalEntry } from './map.js';

const LIST_KINDS: ImportKind[] = ['anime', 'manga'];

/** Fetch both lists and map them. Reads, never writes. */
export async function fetchMalEntries(options: FetchEntriesOptions): Promise<FetchedEntries> {
  const client = createMalClient({
    clientId: options.credentials.malClientId ?? '',
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
    ...(options.requestSpacingMs !== undefined
      ? { requestSpacingMs: options.requestSpacingMs }
      : {}),
  });

  const entries: ImportEntry[] = [];
  const entryWarnings = new Map<string, ImportWarning[]>();
  const warnings: ImportWarning[] = [];

  for (const kind of LIST_KINDS) {
    const rows = await client.fetchList(kind, options.profile);
    for (const raw of rows) {
      const mapped = mapMalEntry(kind, raw, options.now ? { now: options.now } : {});
      if (!mapped.entry) {
        // A row the mapper refused is not in the plan, so its warning has to
        // travel on its own rather than with the entry's.
        warnings.push(...mapped.warnings);
        continue;
      }
      entryWarnings.set(entryKey(mapped.entry), mapped.warnings);
      entries.push(mapped.entry);
    }
  }

  return { entries, entryWarnings, warnings };
}
