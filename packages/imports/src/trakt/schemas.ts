import { z } from 'zod';

/**
 * Trakt API v2 (`https://api.trakt.tv`) shapes, parsed permissively like the
 * other clients: Trakt adds fields without a version bump, and one unreadable
 * row must not take the whole import down — the mapper reads what it recognises
 * and warns about the rest.
 *
 * Every id is nullish: Trakt omits `tmdb`/`imdb` for works it has no mapping
 * for, and a missing id is a missing join, not a malformed row.
 */

export const TraktIdsSchema = z.object({
  trakt: z.number().int().nullish(),
  slug: z.string().nullish(),
  imdb: z.string().nullish(),
  tmdb: z.number().int().nullish(),
  tvdb: z.number().int().nullish(),
});

export const TraktMovieSchema = z.object({
  title: z.string().nullish(),
  year: z.number().int().nullish(),
  ids: TraktIdsSchema.nullish(),
});

export const TraktShowSchema = z.object({
  title: z.string().nullish(),
  year: z.number().int().nullish(),
  aired_episodes: z.number().int().nullish(),
  ids: TraktIdsSchema.nullish(),
});

/** One episode of `watched/shows`, which states plays but not the season total. */
export const TraktWatchedEpisodeSchema = z.object({
  number: z.number().int(),
  plays: z.number().int().nullish(),
  last_watched_at: z.string().nullish(),
});

export const TraktWatchedSeasonSchema = z.object({
  number: z.number().int(),
  episodes: z.array(TraktWatchedEpisodeSchema).nullish(),
});

export const TraktWatchedMovieSchema = z.object({
  plays: z.number().int().nullish(),
  last_watched_at: z.string().nullish(),
  last_updated_at: z.string().nullish(),
  movie: TraktMovieSchema.nullish(),
});

export const TraktWatchedShowSchema = z.object({
  plays: z.number().int().nullish(),
  last_watched_at: z.string().nullish(),
  show: TraktShowSchema.nullish(),
  seasons: z.array(TraktWatchedSeasonSchema).nullish(),
});

/**
 * `progress/watched` is the only endpoint that states how much of a season is
 * out (`aired`) and how much of it is done (`completed`) — `watched/shows` has
 * neither, so completion cannot be derived from the watched list alone.
 */
export const TraktProgressEpisodeSchema = z.object({
  number: z.number().int(),
  completed: z.boolean().nullish(),
  last_watched_at: z.string().nullish(),
});

export const TraktProgressSeasonSchema = z.object({
  number: z.number().int(),
  title: z.string().nullish(),
  aired: z.number().int().nullish(),
  completed: z.number().int().nullish(),
  episodes: z.array(TraktProgressEpisodeSchema).nullish(),
});

export const TraktShowProgressSchema = z.object({
  aired: z.number().int().nullish(),
  completed: z.number().int().nullish(),
  last_watched_at: z.string().nullish(),
  reset_at: z.string().nullish(),
  seasons: z.array(TraktProgressSeasonSchema).nullish(),
});

export const TraktRatingSchema = z.object({
  rated_at: z.string().nullish(),
  /** 1–10, which is already Trackt's scale. */
  rating: z.number().nullish(),
  type: z.string().nullish(),
  movie: TraktMovieSchema.nullish(),
  show: TraktShowSchema.nullish(),
});

export const TraktWatchlistItemSchema = z.object({
  rank: z.number().int().nullish(),
  listed_at: z.string().nullish(),
  notes: z.string().nullish(),
  type: z.string().nullish(),
  movie: TraktMovieSchema.nullish(),
  show: TraktShowSchema.nullish(),
});

export type TraktIds = z.infer<typeof TraktIdsSchema>;
export type TraktMovie = z.infer<typeof TraktMovieSchema>;
export type TraktShow = z.infer<typeof TraktShowSchema>;
export type TraktWatchedEpisode = z.infer<typeof TraktWatchedEpisodeSchema>;
export type TraktProgressEpisode = z.infer<typeof TraktProgressEpisodeSchema>;
export type TraktWatchedSeason = z.infer<typeof TraktWatchedSeasonSchema>;
export type TraktWatchedMovie = z.infer<typeof TraktWatchedMovieSchema>;
export type TraktWatchedShow = z.infer<typeof TraktWatchedShowSchema>;
export type TraktProgressSeason = z.infer<typeof TraktProgressSeasonSchema>;
export type TraktShowProgress = z.infer<typeof TraktShowProgressSchema>;
export type TraktRating = z.infer<typeof TraktRatingSchema>;
export type TraktWatchlistItem = z.infer<typeof TraktWatchlistItemSchema>;
