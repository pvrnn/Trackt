import { z } from 'zod';
import { ImportError } from './errors.js';
import { IMPORT_SOURCES } from './sources.js';
import { readTvTimeUpload, tvTimeUploadLabel, type TvTimeFile } from './tvtime/upload.js';
import type { ImportSource } from './types.js';

/**
 * File sources: the viewer uploads an export instead of naming a profile. The
 * API reads the files here, on the request, so a file that is not the export
 * is refused at the door (400) and the job carries only the compact form — a
 * series export is megabytes, and a job crosses Redis.
 */

/** Per file. A TV Time series export runs ~20 KB per show watched. */
export const MAX_IMPORT_FILE_BYTES = 40 * 1024 * 1024;
export const MAX_IMPORT_FILES = 3;

export const ImportFileSchema = z.object({
  name: z.string().trim().max(255),
  content: z.string().min(1).max(MAX_IMPORT_FILE_BYTES),
});
export type ImportFile = z.infer<typeof ImportFileSchema>;

export interface ImportUpload {
  /** What the job carries to the adapter, already validated and compacted. */
  upload: unknown;
  /** A label for the run where a profile name would go: `export 2026-07-07`. */
  profile: string;
}

const READERS: Partial<Record<ImportSource, (files: readonly TvTimeFile[]) => ImportUpload>> = {
  tvtime: (files) => ({ upload: readTvTimeUpload(files), profile: tvTimeUploadLabel(files) }),
};

export function isFileSource(source: ImportSource): boolean {
  return IMPORT_SOURCES[source].access === 'file';
}

/** Throws `ImportError('malformed')` with a message a viewer can act on. */
export function readImportUpload(source: ImportSource, files: readonly ImportFile[]): ImportUpload {
  const reader = READERS[source];
  if (!reader) {
    throw new ImportError(
      `${IMPORT_SOURCES[source].label} imports read a profile, not a file`,
      'malformed',
    );
  }
  return reader(files);
}
