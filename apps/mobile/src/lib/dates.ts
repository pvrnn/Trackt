/**
 * The two conversions between an ISO date (`2026-02-11`, what the API stores)
 * and the local `Date` the platform date pickers speak.
 *
 * Both exist because the obvious versions are wrong by a day. `new Date(iso)`
 * parses as UTC midnight, which in any timezone west of UTC is the previous
 * evening — so a log started on the 11th opens the picker on the 10th. And
 * `date.toISOString().slice(0, 10)` re-encodes a local date as UTC, so a date
 * picked in the evening east of UTC saves as the next day.
 *
 * Kept free of `react-native` imports so they are unit-testable in the node
 * vitest project, which is where the off-by-one this guards against belongs.
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
