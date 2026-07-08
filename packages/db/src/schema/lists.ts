import {
  boolean,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { mediaKindEnum, visibilityEnum } from './enums.js';
import { users } from './auth.js';
import { media } from './media.js';

/**
 * Pinned profile blocks: favourite movies / series / anime / manga / webtoons,
 * ordered à la Letterboxd top-4 (PRD §3.4).
 */
export const favorite = pgTable(
  'favorite',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    mediaId: uuid('media_id')
      .notNull()
      .references(() => media.id, { onDelete: 'cascade' }),
    kind: mediaKindEnum('kind').notNull(),
    position: integer('position').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.mediaId] }),
    index('favorite_user_kind_idx').on(t.userId, t.kind, t.position),
  ],
);

/** Custom lists, ranked or unranked, optionally collaborative (PRD §3.4). */
export const list = pgTable(
  'list',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description'),
    isRanked: boolean('is_ranked').notNull().default(false),
    isCollaborative: boolean('is_collaborative').notNull().default(false),
    visibility: visibilityEnum('visibility').notNull().default('public'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index('list_owner_idx').on(t.ownerId)],
);

export const listItem = pgTable(
  'list_item',
  {
    listId: uuid('list_id')
      .notNull()
      .references(() => list.id, { onDelete: 'cascade' }),
    mediaId: uuid('media_id')
      .notNull()
      .references(() => media.id, { onDelete: 'cascade' }),
    position: integer('position').notNull().default(0),
    addedBy: uuid('added_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.listId, t.mediaId] }),
    index('list_item_media_idx').on(t.mediaId),
  ],
);
