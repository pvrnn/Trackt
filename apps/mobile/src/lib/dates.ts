/**
 * ISO date (what the API stores) ↔ the local `Date` the platform pickers speak.
 * The obvious versions are both wrong by a day: `new Date(iso)` parses as UTC
 * midnight, and `toISOString().slice(0, 10)` re-encodes a local date as UTC.
 *
 * No `react-native` imports, so the off-by-one stays unit-testable in the node
 * vitest project.
 */

/** '2026-02-11' → local noon, far enough from either midnight to survive any offset. */
export function isoToDate(iso: string): Date {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1, 12);
}

/** A local `Date` from a picker → '2026-02-11', read off its local fields. */
export function dateToIso(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}
