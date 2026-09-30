import type { MediaKind, NewsTopic } from '@trackt/shared';

/** Sentence case for Discord, where the web design's uppercase pills would shout. */
export const KIND_LABELS: Record<MediaKind, string> = {
  movie: 'Movies',
  series: 'Series',
  anime: 'Anime',
  manga: 'Manga',
  webtoon: 'Webtoons',
};

export const TOPIC_LABELS: Record<NewsTopic, string> = {
  announcement: 'Announcement',
  renewal: 'Renewal',
  cancellation: 'Cancellation',
  release_date: 'Release date',
  trailer: 'Trailer',
  casting: 'Casting',
  adaptation: 'Adaptation',
  award: 'Award',
  general: 'News',
};

export function kindsLabel(kinds: readonly MediaKind[]): string {
  return kinds.length === 0 ? 'All media types' : kinds.map((kind) => KIND_LABELS[kind]).join(', ');
}
