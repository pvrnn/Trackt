import { z } from 'zod';

/** Media types Trackt can track. Webtoons rely on user-created entries (PRD §3.5). */
export const MEDIA_KINDS = ['movie', 'series', 'anime', 'manga', 'webtoon'] as const;
export const MediaKindSchema = z.enum(MEDIA_KINDS);
export type MediaKind = z.infer<typeof MediaKindSchema>;

/** Publication/airing status of a work. */
export const MEDIA_STATUSES = ['announced', 'airing', 'publishing', 'ended', 'cancelled'] as const;
export const MediaStatusSchema = z.enum(MEDIA_STATUSES);
export type MediaStatus = z.infer<typeof MediaStatusSchema>;

/** Where a catalog entry came from: an upstream metadata provider or a user. */
export const MEDIA_SOURCES = ['provider', 'user'] as const;
export const MediaSourceSchema = z.enum(MEDIA_SOURCES);
export type MediaSource = z.infer<typeof MediaSourceSchema>;

/** Moderation state for user-created entries (usable immediately, verified later). */
export const MODERATION_STATUSES = ['verified', 'unverified', 'rejected'] as const;
export const ModerationStatusSchema = z.enum(MODERATION_STATUSES);
export type ModerationStatus = z.infer<typeof ModerationStatusSchema>;

/** A user's tracking status for a work. */
export const LOG_STATUSES = ['planned', 'in_progress', 'completed', 'dropped', 'paused'] as const;
export const LogStatusSchema = z.enum(LOG_STATUSES);
export type LogStatus = z.infer<typeof LogStatusSchema>;

/** Structural parts of a work: seasons/episodes for video, volumes/chapters for print. */
export const PART_KINDS = ['season', 'episode', 'volume', 'chapter'] as const;
export const PartKindSchema = z.enum(PART_KINDS);
export type PartKind = z.infer<typeof PartKindSchema>;

/** The part kind check-ins create per media kind; null = not checkable (movies). */
export const PART_KIND_BY_MEDIA: Record<
  MediaKind,
  Extract<PartKind, 'episode' | 'chapter'> | null
> = {
  movie: null,
  series: 'episode',
  anime: 'episode',
  manga: 'chapter',
  webtoon: 'chapter',
};

/** Whether a kind is watched or read — the user-facing verb for tracking it. */
export type TrackingVerb = 'watch' | 'read';

/**
 * The verb each media kind is tracked with. Exhaustive over MediaKind on
 * purpose: a newly added kind must pick a side here rather than fall through a
 * default and silently render "Watched" on a comic.
 */
export const TRACKING_VERB_BY_MEDIA: Record<MediaKind, TrackingVerb> = {
  movie: 'watch',
  series: 'watch',
  anime: 'watch',
  manga: 'read',
  webtoon: 'read',
};

const TRACKING_VERB_FORMS: Record<TrackingVerb, Record<'present' | 'past', string>> = {
  watch: { present: 'Watch', past: 'Watched' },
  read: { present: 'Read', past: 'Read' },
};

/**
 * The word a check-in reads as for a kind: 'Watch'/'Watched' for video,
 * 'Read' for print (its past tense is spelt the same). Returned capitalised;
 * callers case it for their surface — `.toUpperCase()` on buttons,
 * `.toLowerCase()` mid-sentence.
 */
export function trackingVerbLabel(kind: MediaKind, tense: 'present' | 'past' = 'past'): string {
  return TRACKING_VERB_FORMS[TRACKING_VERB_BY_MEDIA[kind]][tense];
}

/**
 * How one work relates to another (ADR-0004). An edge is always stored in the
 * FORWARD direction: `A →sequel→ B` means B is A's sequel, `A →adaptation→ B`
 * means B adapts A, `A →spinoff→ B` means B spins off A. `related` is symmetric
 * and publishers emit it once. Reading an edge backwards never produces one of
 * these values — it produces a label (see MEDIA_RELATION_LABELS).
 */
export const MEDIA_RELATION_TYPES = ['sequel', 'adaptation', 'spinoff', 'related'] as const;
export const MediaRelationTypeSchema = z.enum(MEDIA_RELATION_TYPES);
export type MediaRelationType = z.infer<typeof MediaRelationTypeSchema>;

/** Which way an edge was traversed to reach the work being displayed. */
export const RELATION_DIRECTIONS = ['forward', 'reverse'] as const;
export const RelationDirectionSchema = z.enum(RELATION_DIRECTIONS);
export type RelationDirection = z.infer<typeof RelationDirectionSchema>;

/**
 * The vocabulary a relation *renders* under: the four stored types plus the
 * three reverse readings. Deliberately a separate type from
 * MEDIA_RELATION_TYPES, which constrains database columns — `prequel` must
 * never reach one. Listed in display order; consumers group sections by it.
 */
export const MEDIA_RELATION_LABELS = [
  'prequel',
  'sequel',
  'source',
  'adaptation',
  'spinoff',
  'parent',
  'related',
] as const;
export const MediaRelationLabelSchema = z.enum(MEDIA_RELATION_LABELS);
export type MediaRelationLabel = z.infer<typeof MediaRelationLabelSchema>;

/** How a stored type reads when the edge is traversed backwards. */
export const REVERSE_RELATION_LABEL: Record<MediaRelationType, MediaRelationLabel> = {
  sequel: 'prequel',
  adaptation: 'source',
  spinoff: 'parent',
  related: 'related',
};

/**
 * The label an edge renders under, given the direction it was traversed. The
 * `forward` branch returning `type` unchanged is what makes every stored type a
 * valid label — the compiler enforces that superset relationship here, so it
 * needs no runtime assertion.
 */
export function relationLabel(
  type: MediaRelationType,
  direction: RelationDirection,
): MediaRelationLabel {
  return direction === 'forward' ? type : REVERSE_RELATION_LABEL[type];
}

/** Privacy levels, applied per profile section / list (PRD §3.4). */
export const VISIBILITIES = ['public', 'followers', 'private'] as const;
export const VisibilitySchema = z.enum(VISIBILITIES);
export type Visibility = z.infer<typeof VisibilitySchema>;

/** Per-instance roles (PRD §7). */
export const USER_ROLES = ['user', 'moderator', 'admin'] as const;
export const UserRoleSchema = z.enum(USER_ROLES);
export type UserRole = z.infer<typeof UserRoleSchema>;

/**
 * External provider IDs stored per media, e.g. {"tmdb": 123, "anilist": 456}.
 * Enables dedup, cross-import, and provider switching (PRD §4).
 */
export const ExternalIdsSchema = z.record(z.string(), z.union([z.string(), z.number()]));
export type ExternalIds = z.infer<typeof ExternalIdsSchema>;
