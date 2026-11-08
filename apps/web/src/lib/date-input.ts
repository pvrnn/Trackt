/**
 * Typed date input for the web date picker. Accepts the formats people
 * actually type — `2026-11-08`, `08/11/2026`, `8 nov 2026`, `nov 8, 2026` —
 * and answers an ISO day, so nothing downstream ever parses text again.
 *
 * Months are read in the UI locale (`format.locale`), and a name may be typed
 * in full or abbreviated; an abbreviation shared by two months ("jui" in
 * French) is refused rather than guessed.
 */

export interface IsoDay {
  year: number;
  /** 0–11, like `Date`. */
  month: number;
  day: number;
}

const pad = (value: number) => String(value).padStart(2, '0');

export function isoOf(year: number, month: number, day: number): string {
  return `${year}-${pad(month + 1)}-${pad(day)}`;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function readIso(value: string): IsoDay | null {
  const match = ISO_DATE.exec(value);
  if (!match) return null;
  const [, year, month, day] = match;
  return { year: Number(year), month: Number(month) - 1, day: Number(day) };
}

/** The trigger's copy: `08 NOV 2026`, locale month, UTC so it cannot shift a day. */
export function formatIsoDate(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
    .format(new Date(`${iso}T00:00:00Z`))
    .toLocaleUpperCase(locale);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/** Rejects 31 February and month overflow instead of letting `Date` roll them over. */
function makeDay(year: number, month: number, day: number): IsoDay | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (month < 0 || month > 11 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month || date.getUTCDate() !== day) {
    return null;
  }
  return { year, month, day };
}

/** 26 → 2026, 99 → 1999: the same pivot a MAL import applies to dates. */
function fullYear(value: number): number {
  if (value >= 100) return value;
  return value < 70 ? 2000 + value : 1900 + value;
}

const normalise = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z]/g, '');

function monthFromNameIn(name: string, locale: string): number | null {
  const key = normalise(name);
  if (key.length < 3) return null;
  const matches = new Set<number>();
  for (let month = 0; month < 12; month += 1) {
    for (const style of ['long', 'short'] as const) {
      const candidate = normalise(
        new Intl.DateTimeFormat(locale, { month: style, timeZone: 'UTC' }).format(
          new Date(Date.UTC(2024, month, 1)),
        ),
      );
      if (candidate.startsWith(key) || key.startsWith(candidate)) matches.add(month);
    }
  }
  return matches.size === 1 ? [...matches][0]! : null;
}

/** English names stay accepted in a French UI: the catalog and most of the web are English. */
function monthFromName(name: string, locale: string): number | null {
  return monthFromNameIn(name, locale) ?? monthFromNameIn(name, 'en-GB');
}

export function parseDateInput(value: string, locale: string): IsoDay | null {
  const text = value.trim();
  if (text === '') return null;

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (iso) return makeDay(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));

  // Both app locales are day-first (en-GB, fr-FR), which is also what the
  // trigger prints, so "03/04" is 3 April here, never 4 March.
  const numeric = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(text);
  if (numeric) {
    return makeDay(fullYear(Number(numeric[3])), Number(numeric[2]) - 1, Number(numeric[1]));
  }

  const dayFirst = /^(\d{1,2})\s+([\p{L}.]{3,})\s+(\d{2}|\d{4})$/u.exec(text);
  if (dayFirst) {
    const month = monthFromName(dayFirst[2]!, locale);
    return month === null
      ? null
      : makeDay(fullYear(Number(dayFirst[3])), month, Number(dayFirst[1]));
  }

  const monthFirst = /^([\p{L}.]{3,})\.?\s+(\d{1,2}),?\s+(\d{2}|\d{4})$/u.exec(text);
  if (monthFirst) {
    const month = monthFromName(monthFirst[1]!, locale);
    return month === null
      ? null
      : makeDay(fullYear(Number(monthFirst[3])), month, Number(monthFirst[2]));
  }

  return null;
}

const FIELD_WIDTHS = [2, 2, 4];

function groupDigits(digits: string): string {
  const capped = digits.slice(0, 8);
  if (capped.length <= 2) return capped;
  if (capped.length <= 4) return `${capped.slice(0, 2)}/${capped.slice(2)}`;
  return `${capped.slice(0, 2)}/${capped.slice(2, 4)}/${capped.slice(4)}`;
}

/**
 * Auto-separates a hand-typed date as it is typed: `12012024` → `12/01/2024`.
 * A `/` typed after a single digit closes that field with a leading zero
 * (`1/2/2024` → `01/02/2024`), and a field that overflows its width falls back
 * to the digit stream, so continuing past `12/01` yields `12/01/2`.
 *
 * Anything that is not digits and slashes — a month name, an ISO string — is
 * returned untouched, because those formats carry their own shape.
 */
export function maskDateInput(raw: string): string {
  if (!/^[\d/]*$/.test(raw)) return raw;
  const digits = raw.replace(/\//g, '');
  if (digits === '') return '';
  if (!raw.includes('/')) return groupDigits(digits);

  const segments = raw.split('/');
  const overflow =
    segments.length > 3 ||
    segments.some((segment, index) => segment.length > (FIELD_WIDTHS[index] ?? 4));
  if (overflow) return groupDigits(digits);

  return segments
    .map((segment, index) =>
      index < 2 && index < segments.length - 1 && segment.length === 1 ? `0${segment}` : segment,
    )
    .join('/');
}

/** Index just after the `count`th digit of `masked`, for restoring the caret. */
export function caretAfterDigits(masked: string, count: number): number {
  if (count <= 0) return 0;
  let seen = 0;
  for (let index = 0; index < masked.length; index += 1) {
    if (masked[index]! >= '0' && masked[index]! <= '9') {
      seen += 1;
      if (seen === count) return index + 1;
    }
  }
  return masked.length;
}
