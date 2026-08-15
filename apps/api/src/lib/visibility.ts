import { sql, type SQL } from 'drizzle-orm';
import type { ModerationStatus } from '@trackt/shared';

/**
 * Who may see a media row: everyone sees `verified`, nobody sees anything else.
 *
 * There is no viewer term any more. Entry creation moved to the central
 * catalog's publish path (ADR-0001), so an instance no longer mints rows of its
 * own and nothing here produces `unverified`/`rejected` — catalog rows
 * materialize `verified` on first sight (ADR-0002). The status check stays
 * rather than collapsing to `deleted_at`, because instances that ran the old
 * user-entry flow still hold rows in the other two states and those must remain
 * hidden, not become visible the day this shipped.
 *
 * Soft-deleted rows (`deleted_at` set) are invisible to everyone — pulled from
 * circulation while user logs/progress stay intact.
 */
export function canViewMedia(row: {
  moderation: ModerationStatus;
  deletedAt: Date | null;
}): boolean {
  return row.deletedAt === null && row.moderation === 'verified';
}

/**
 * The same rule as a SQL fragment, for raw queries over `media`. `alias` must
 * be a literal from our code (e.g. `sql.raw('m.')`) — the SQL type keeps user
 * input out of it.
 */
export function visibleMediaSql(alias: SQL = sql.raw('')): SQL {
  return sql`(${alias}deleted_at IS NULL AND ${alias}moderation = 'verified')`;
}
