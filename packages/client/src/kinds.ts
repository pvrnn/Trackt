import type { LogStatus, MediaKind } from '@trackt/shared';

/**
 * Display labels for the media kinds. Filter rows read them plural ("MOVIES"),
 * because a filter names a set; a form field naming one entry reads singular.
 * Both lived copy-pasted in three routes before the history filter row would
 * have made it four.
 */
export const KIND_LABELS: Record<MediaKind, string> = {
  movie: 'MOVIES',
  series: 'SERIES',
  anime: 'ANIME',
  manga: 'MANGA',
  webtoon: 'WEBTOONS',
};

export const KIND_LABELS_SINGULAR: Record<MediaKind, string> = {
  movie: 'MOVIE',
  series: 'SERIES',
  anime: 'ANIME',
  manga: 'MANGA',
  webtoon: 'WEBTOON',
};

/**
 * The log statuses as the design writes them — uppercase, on a pill. Total over
 * `LogStatus` so a status can never fall through to a blank chip, including
 * `planned`, which the history page's server filter excludes but the media
 * page's status menu offers.
 */
export const LOG_STATUS_LABELS: Record<LogStatus, string> = {
  planned: 'PLANNED',
  in_progress: 'IN PROGRESS',
  completed: 'COMPLETED',
  dropped: 'DROPPED',
  paused: 'PAUSED',
};
