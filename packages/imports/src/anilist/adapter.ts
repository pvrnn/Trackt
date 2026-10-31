import { entryKey } from '../resolve.js';
import type {
  FetchEntriesOptions,
  FetchedEntries,
  ImportEntry,
  ImportKind,
  ImportWarning,
} from '../types.js';
import { createAniListClient } from './client.js';
import { mapAniListEntry } from './map.js';

const LIST_KINDS: ImportKind[] = ['anime', 'manga'];

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

/** Fetch both lists and map them. Reads, never writes. */
export async function fetchAniListEntries(options: FetchEntriesOptions): Promise<FetchedEntries> {
  const client = createAniListClient({
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.baseUrl ? { endpoint: options.baseUrl } : {}),
  });

  const entries: ImportEntry[] = [];
  const entryWarnings = new Map<string, ImportWarning[]>();
  const warnings: ImportWarning[] = [];
  const spacing = options.requestSpacingMs ?? 400;

  for (const [index, kind] of LIST_KINDS.entries()) {
    if (index > 0) await sleep(spacing);
    const rows = await client.fetchList(kind, options.profile);
    for (const raw of rows) {
      const mapped = mapAniListEntry(kind, raw, options.now ? { now: options.now } : {});
      if (!mapped.entry) {
        warnings.push(...mapped.warnings);
        continue;
      }
      entryWarnings.set(entryKey(mapped.entry), mapped.warnings);
      entries.push(mapped.entry);
    }
  }

  return { entries, entryWarnings, warnings };
}
