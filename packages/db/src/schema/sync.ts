import { bigint, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * Cursors for background sync jobs. One row per stream; the catalog sync job
 * (ADR-0001) stores its `seq` cursor under the key 'catalog', persisted after
 * every applied page so an interrupted sync resumes instead of restarting.
 */
export const syncState = pgTable('sync_state', {
  key: text('key').primaryKey(),
  /** Last change-stream sequence applied locally (catalog `seq` is a bigint). */
  cursor: bigint('cursor', { mode: 'number' }).notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
