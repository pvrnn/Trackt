import { pgEnum } from 'drizzle-orm/pg-core';
import {
  LOG_STATUSES,
  MEDIA_KINDS,
  MEDIA_SOURCES,
  MEDIA_STATUSES,
  MODERATION_STATUSES,
  PART_KINDS,
  RATING_TARGETS,
  USER_ROLES,
  VISIBILITIES,
} from '@trackt/shared';

export const mediaKindEnum = pgEnum('media_kind', MEDIA_KINDS);
export const mediaStatusEnum = pgEnum('media_status', MEDIA_STATUSES);
export const mediaSourceEnum = pgEnum('media_source', MEDIA_SOURCES);
export const moderationStatusEnum = pgEnum('moderation_status', MODERATION_STATUSES);
export const logStatusEnum = pgEnum('log_status', LOG_STATUSES);
export const partKindEnum = pgEnum('part_kind', PART_KINDS);
export const targetTypeEnum = pgEnum('target_type', RATING_TARGETS);
export const visibilityEnum = pgEnum('visibility', VISIBILITIES);
export const userRoleEnum = pgEnum('user_role', USER_ROLES);
export const reportStatusEnum = pgEnum('report_status', ['open', 'resolved', 'dismissed']);
