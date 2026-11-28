import { z } from 'zod';

/**
 * Netflix's "Download all" on netflix.com/settings/viewed saves one
 * `NetflixViewingHistory.csv` per profile: `Title,Date`, one row per title per
 * day, in the profile's language and the account's date format. It carries no
 * provider id and no year, so the upload is reduced to works here — a season is
 * its episodes, counted — and resolution is by exact title alone.
 */

const DaySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const NetflixMovieSchema = z.object({
  title: z.string().min(1),
  firstWatchedAt: DaySchema,
  lastWatchedAt: DaySchema,
});
export type NetflixMovie = z.infer<typeof NetflixMovieSchema>;

export const NetflixSeasonSchema = z.object({
  show: z.string().min(1),
  number: z.number().int().min(1),
  /** Distinct episodes seen: the history logs a title once per day it was watched. */
  episodes: z.number().int().min(1),
  firstWatchedAt: DaySchema,
  lastWatchedAt: DaySchema,
  /** The rows named no season (a one-season show's usual form); season 1 is assumed. */
  assumed: z.boolean(),
});
export type NetflixSeason = z.infer<typeof NetflixSeasonSchema>;

/** Episodes under a season label with no number ("Final Season"): there is no row to log them on. */
export const NetflixUnplacedSchema = z.object({
  show: z.string().min(1),
  label: z.string().min(1),
  episodes: z.number().int().min(1),
});
export type NetflixUnplaced = z.infer<typeof NetflixUnplacedSchema>;

export const NetflixExportSchema = z.object({
  movies: z.array(NetflixMovieSchema),
  seasons: z.array(NetflixSeasonSchema),
  unplaced: z.array(NetflixUnplacedSchema),
  /** Rows with no title or no readable date. */
  skipped: z.number().int().nonnegative(),
});
export type NetflixExport = z.infer<typeof NetflixExportSchema>;
