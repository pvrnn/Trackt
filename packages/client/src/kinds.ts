import type { MediaKind } from '@trackt/shared';

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
