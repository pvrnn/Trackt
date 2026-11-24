import { index, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './auth.js';

/**
 * One row per trophy a user holds. `trophy_id` is an id from `TROPHIES` in
 * `@trackt/shared`; `unlocked_at` is when the target was first reached in the
 * user's data (an imported completion keeps its own date), not when the
 * evaluator noticed. Rows are only ever inserted: a trophy is not taken back.
 */
export const userTrophy = pgTable(
  'user_trophy',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    trophyId: text('trophy_id').notNull(),
    unlockedAt: timestamp('unlocked_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.trophyId] }),
    index('user_trophy_trophy_idx').on(t.trophyId, t.unlockedAt),
    index('user_trophy_unlocked_idx').on(t.unlockedAt),
  ],
);
