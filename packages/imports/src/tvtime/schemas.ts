import { z } from 'zod';

/**
 * TV Time has no public API and no export of its own; what people have is the
 * export of the "TV Time Out" tool (Refract): two JSON files (`tvtime-movies-*`,
 * `tvtime-series-*`) and an HTML summary that embeds a lossier copy of the same
 * data as two `var SHOWS = […]` / `var MOVIES = […]` script literals.
 *
 * The raw shapes are read leniently — every field nullish — because a row the
 * mapper cannot use is a warning, not a reason to refuse the whole file.
 */

const TvTimeIdsSchema = z
  .object({
    tvdb: z.number().int().nullish(),
    imdb: z.string().nullish(),
  })
  .nullish();

export const TvTimeJsonMovieSchema = z.object({
  id: TvTimeIdsSchema,
  uuid: z.string().nullish(),
  title: z.string().nullish(),
  year: z.number().int().nullish(),
  watched_at: z.string().nullish(),
  is_watched: z.boolean().nullish(),
  is_favorite: z.boolean().nullish(),
  rewatch_count: z.number().int().nullish(),
});
export type TvTimeJsonMovie = z.infer<typeof TvTimeJsonMovieSchema>;

const TvTimeJsonEpisodeSchema = z.object({
  number: z.number().int(),
  special: z.boolean().nullish(),
  is_watched: z.boolean().nullish(),
  watched_at: z.string().nullish(),
  rewatch_count: z.number().int().nullish(),
});

const TvTimeJsonSeasonSchema = z.object({
  number: z.number().int(),
  is_specials: z.boolean().nullish(),
  episodes: z.array(TvTimeJsonEpisodeSchema).nullish(),
});

export const TvTimeJsonShowSchema = z.object({
  id: TvTimeIdsSchema,
  uuid: z.string().nullish(),
  title: z.string().nullish(),
  status: z.string().nullish(),
  is_favorite: z.boolean().nullish(),
  seasons: z.array(TvTimeJsonSeasonSchema).nullish(),
});
export type TvTimeJsonShow = z.infer<typeof TvTimeJsonShowSchema>;

export const TvTimeHtmlMovieSchema = z.object({
  title: z.string().nullish(),
  tvdbId: z.number().int().nullish(),
  imdbId: z.string().nullish(),
  uuid: z.string().nullish(),
  year: z.number().int().nullish(),
  isWatched: z.boolean().nullish(),
  isFavorite: z.boolean().nullish(),
  watchedAt: z.string().nullish(),
  rewatchCount: z.number().int().nullish(),
});
export type TvTimeHtmlMovie = z.infer<typeof TvTimeHtmlMovieSchema>;

export const TvTimeHtmlShowSchema = z.object({
  title: z.string().nullish(),
  tvdbId: z.number().int().nullish(),
  imdbId: z.string().nullish(),
  status: z.string().nullish(),
  isFavorite: z.boolean().nullish(),
  /** Regular episodes watched / listed, across every season. */
  watched: z.number().int().nullish(),
  total: z.number().int().nullish(),
  /** The only per-season fact the summary keeps: which regular episodes are unseen. */
  unwatchedRegularEps: z
    .array(z.object({ season: z.number().int(), episode: z.number().int() }))
    .nullish(),
});
export type TvTimeHtmlShow = z.infer<typeof TvTimeHtmlShowSchema>;

/**
 * The compact form an upload is reduced to before it is queued: the series JSON
 * is megabytes of episode names, and a job crosses Redis. Episodes collapse to
 * what a season log needs — how far, whether finished, and when.
 */
export const TvTimeSeasonSchema = z.object({
  number: z.number().int().min(1),
  /** Regular episodes the export lists; null when it does not say (the HTML summary). */
  episodes: z.number().int().nonnegative().nullable(),
  /** The highest episode number known to be seen; 0 when none is. */
  position: z.number().int().nonnegative(),
  /** Every regular episode the export lists is seen. */
  complete: z.boolean(),
  /** UTC days (`YYYY-MM-DD`) of the first and last watch, when the export dates them. */
  firstWatchedAt: z.string().nullable(),
  lastWatchedAt: z.string().nullable(),
  rewatches: z.number().int().nonnegative(),
});
export type TvTimeSeason = z.infer<typeof TvTimeSeasonSchema>;

export const TvTimeShowSchema = z.object({
  tvdb: z.number().int().nullable(),
  imdb: z.string().nullable(),
  title: z.string().nullable(),
  /** TV Time's own word: `up_to_date`, `continuing`, `stopped`, `not_started_yet`, `watch_later`. */
  status: z.string().nullable(),
  favourite: z.boolean(),
  /** Regular episodes seen across the show, so a show whose seasons could not be placed is reported. */
  watchedEpisodes: z.number().int().nonnegative(),
  seasons: z.array(TvTimeSeasonSchema),
});
export type TvTimeShow = z.infer<typeof TvTimeShowSchema>;

export const TvTimeMovieSchema = z.object({
  tvdb: z.number().int().nullable(),
  imdb: z.string().nullable(),
  uuid: z.string().nullable(),
  title: z.string().nullable(),
  year: z.number().int().nullable(),
  watched: z.boolean(),
  watchedAt: z.string().nullable(),
  favourite: z.boolean(),
  rewatches: z.number().int().nonnegative(),
});
export type TvTimeMovie = z.infer<typeof TvTimeMovieSchema>;

export const TvTimeExportSchema = z.object({
  /** Which file the shows came from: the HTML summary keeps no dates and no per-season counts. */
  showsFrom: z.enum(['json', 'html']).nullable(),
  /** Null when the upload carried no movie list (as opposed to an empty one). */
  movies: z.array(TvTimeMovieSchema).nullable(),
  shows: z.array(TvTimeShowSchema).nullable(),
});
export type TvTimeExport = z.infer<typeof TvTimeExportSchema>;
