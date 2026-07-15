/** Unique-violation SQLSTATE (duplicate key). */
const UNIQUE_VIOLATION = '23505';

/**
 * True when `error` is (or wraps) a Postgres unique violation. Drizzle wraps
 * the driver error, so the SQLSTATE may live anywhere on the cause chain.
 */
export function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { code, cause } = error as { code?: unknown; cause?: unknown };
  return code === UNIQUE_VIOLATION || isUniqueViolation(cause);
}
