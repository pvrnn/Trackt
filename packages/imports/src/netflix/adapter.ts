import { ImportError } from '../errors.js';
import { entryKey } from '../resolve.js';
import { normaliseTitle } from '../titles.js';
import {
  warning,
  type FetchedEntries,
  type FetchEntriesOptions,
  type ImportEntry,
  type ImportWarning,
} from '../types.js';
import { mapNetflixMovie, mapNetflixSeason } from './map.js';
import { NetflixExportSchema } from './schemas.js';

const NO_ROW = { externalId: null, title: null };

/** Netflix → entries, from the viewing history the API reduced to works (`upload.ts`). */
export async function fetchNetflixEntries(options: FetchEntriesOptions): Promise<FetchedEntries> {
  const parsed = NetflixExportSchema.safeParse(options.upload);
  if (!parsed.success) {
    throw new ImportError(
      'no Netflix viewing history is attached to this import — upload NetflixViewingHistory.csv',
      'malformed',
    );
  }
  const upload = parsed.data;
  const mapOptions = options.now ? { now: options.now } : {};

  const entries: ImportEntry[] = [];
  const entryWarnings = new Map<string, ImportWarning[]>();
  const warnings: ImportWarning[] = [];
  const push = ({
    entry,
    warnings: rowWarnings,
  }: {
    entry: ImportEntry;
    warnings: ImportWarning[];
  }) => {
    entryWarnings.set(entryKey(entry), rowWarnings);
    entries.push(entry);
  };

  for (const movie of upload.movies) push(mapNetflixMovie(movie, mapOptions));

  const numbered = new Set(
    upload.seasons.filter((season) => !season.assumed).map((season) => normaliseTitle(season.show)),
  );
  for (const season of upload.seasons) {
    const mapped = mapNetflixSeason(season, mapOptions);
    // A show whose other rows name their season is not obviously a one-season show.
    if (season.assumed && numbered.has(normaliseTitle(season.show))) {
      mapped.warnings.push(
        warning(
          'partial-source',
          { externalId: mapped.entry.externalId, title: season.show },
          `${season.episodes} episodes of "${season.show}" name no season — logged as season 1`,
        ),
      );
    }
    push(mapped);
  }

  for (const { show, label, episodes } of upload.unplaced) {
    warnings.push(
      warning(
        'partial-source',
        { externalId: normaliseTitle(show), title: show },
        `${episodes} episodes of "${show}: ${label}" name no season number — not imported`,
      ),
    );
  }
  if (upload.skipped > 0) {
    warnings.push(
      warning(
        'malformed-row',
        NO_ROW,
        `${upload.skipped} history rows have no title or no readable date — skipped`,
      ),
    );
  }

  return { entries, entryWarnings, warnings };
}
