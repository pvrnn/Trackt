import { useTranslation } from 'react-i18next';
import {
  TRACKING_VERB_BY_MEDIA,
  type ActivityEntry,
  type ListSummary,
  type LogStatus,
  type MediaKind,
  type NewsTopic,
} from '@trackt/shared';

/**
 * The copy tables `packages/client` used to finish for web. They map to catalog
 * keys rather than English strings, so a new kind/status/topic cannot fall
 * through to a blank label, the same guarantee the `Record<…, string>`
 * constants gave, now inside the app that owns a catalog.
 */
const KIND_PLURAL = {
  movie: 'kind.plural.movie',
  game: 'kind.plural.game',
  series: 'kind.plural.series',
  anime: 'kind.plural.anime',
  manga: 'kind.plural.manga',
  webtoon: 'kind.plural.webtoon',
} as const satisfies Record<MediaKind, string>;

const KIND_SINGULAR = {
  movie: 'kind.singular.movie',
  game: 'kind.singular.game',
  series: 'kind.singular.series',
  anime: 'kind.singular.anime',
  manga: 'kind.singular.manga',
  webtoon: 'kind.singular.webtoon',
} as const satisfies Record<MediaKind, string>;

const STATUS = {
  planned: 'status.planned',
  in_progress: 'status.in_progress',
  completed: 'status.completed',
  dropped: 'status.dropped',
  paused: 'status.paused',
} as const satisfies Record<LogStatus, string>;

const TOPIC = {
  announcement: 'newsTopic.announcement',
  renewal: 'newsTopic.renewal',
  cancellation: 'newsTopic.cancellation',
  release_date: 'newsTopic.release_date',
  trailer: 'newsTopic.trailer',
  casting: 'newsTopic.casting',
  adaptation: 'newsTopic.adaptation',
  award: 'newsTopic.award',
  general: 'newsTopic.general',
} as const satisfies Record<NewsTopic, string>;

const VISIBILITY = {
  public: 'visibility.public',
  followers: 'visibility.followers',
  private: 'visibility.private',
} as const satisfies Record<ListSummary['visibility'], string>;

/** The activity row's verb, in the past tense the feed reads in. */
function activityKey(entry: ActivityEntry) {
  switch (entry.verb) {
    case 'checked_in':
      switch (TRACKING_VERB_BY_MEDIA[entry.kind]) {
        case 'watch':
          return 'activity.watched' as const;
        case 'read':
          return 'activity.read' as const;
        case 'play':
          return 'activity.played' as const;
      }
    case 'rated':
      return 'activity.rated' as const;
    case 'status':
      return 'activity.marked' as const;
  }
}

export function useLabels() {
  const { t } = useTranslation();
  return {
    kind: (kind: MediaKind) => t(KIND_PLURAL[kind]),
    kindSingular: (kind: MediaKind) => t(KIND_SINGULAR[kind]),
    status: (status: LogStatus) => t(STATUS[status]),
    topic: (topic: NewsTopic) => t(TOPIC[topic]),
    visibility: (visibility: ListSummary['visibility']) => t(VISIBILITY[visibility]),
    activity: (entry: ActivityEntry) => t(activityKey(entry)),
    /** The media kind's localized action verb. */
    trackingVerb: (kind: MediaKind, tense: 'present' | 'past' = 'past') => {
      const verb = TRACKING_VERB_BY_MEDIA[kind];
      if (verb === 'watch') return t(tense === 'present' ? 'verb.watch' : 'verb.watched');
      if (verb === 'read') return t(tense === 'present' ? 'verb.read' : 'verb.readPast');
      return t(tense === 'present' ? 'verb.play' : 'verb.played');
    },
  };
}
