import { ImportError } from '../errors.js';
import { entryKey } from '../resolve.js';
import {
  warning,
  type FetchedEntries,
  type FetchEntriesOptions,
  type ImportEntry,
  type ImportWarning,
} from '../types.js';
import { mapTvTimeMovie, mapTvTimeShow } from './map.js';
import { TvTimeExportSchema } from './schemas.js';

const NO_ROW = { externalId: null, title: null };

/**
 * TV Time → entries, from an upload rather than a profile: TV Time has no
 * public API, so the API reduces the export to its compact form (`upload.ts`)
 * and the job carries that. Nothing here touches the network.
 */
export async function fetchTvTimeEntries(options: FetchEntriesOptions): Promise<FetchedEntries> {
  const parsed = TvTimeExportSchema.safeParse(options.upload);
  if (!parsed.success) {
    throw new ImportError(
      'no TV Time export is attached to this import — upload the two JSON files or the HTML summary',
      'malformed',
    );
  }
  const upload = parsed.data;
  const mapOptions = options.now ? { now: options.now } : {};

  const entries: ImportEntry[] = [];
  const entryWarnings = new Map<string, ImportWarning[]>();
  const warnings: ImportWarning[] = [];
  const push = (entry: ImportEntry, rowWarnings: ImportWarning[]) => {
    entryWarnings.set(entryKey(entry), rowWarnings);
    entries.push(entry);
  };

  if (upload.movies === null) {
    warnings.push(
      warning('partial-source', NO_ROW, 'the upload carries no movie list — movies not imported'),
    );
  }
  for (const movie of upload.movies ?? []) {
    const mapped = mapTvTimeMovie(movie, mapOptions);
    if (mapped.entry) push(mapped.entry, mapped.warnings);
    else warnings.push(...mapped.warnings);
  }

  if (upload.shows === null) {
    warnings.push(
      warning('partial-source', NO_ROW, 'the upload carries no show list — shows not imported'),
    );
  } else if (upload.showsFrom === 'html') {
    warnings.push(
      warning(
        'partial-source',
        NO_ROW,
        'shows came from the HTML summary, which keeps no watch dates and no per-season counts — ' +
          'seasons after the last unseen episode are not imported; upload the series JSON for the full history',
      ),
    );
  }
  for (const show of upload.shows ?? []) {
    const mapped = mapTvTimeShow(show, mapOptions);
    for (const { entry, warnings: rowWarnings } of mapped.entries) push(entry, rowWarnings);
    warnings.push(...mapped.warnings);
  }

  return { entries, entryWarnings, warnings };
}
