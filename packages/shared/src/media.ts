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
