/**
 * Parse a watch party's start: `now`, a delay (`in 45m`, `2h`, `1h30m`), a
 * time of day (`20:30`, the next one to come), or a date and time
 * (`2026-10-02 20:30`). Wall-clock forms are read in `timeZone`, since Discord
 * never tells a bot the user's own.
 */

const DELAY = /^(?:in\s+)?(?:(\d+)\s*h)?\s*(?:(\d+)\s*m(?:in)?)?$/i;
const TIME = /^(\d{1,2}):(\d{2})$/;
const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})$/;

export function isTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

interface WallTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function wallTimeIn(date: Date, timeZone: string): WallTime & { second: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    })
      .formatToParts(date)
      .map((part) => [part.type, Number(part.value)]),
  );
  return {
    year: parts.year!,
    month: parts.month!,
    day: parts.day!,
    hour: parts.hour!,
    minute: parts.minute!,
    second: parts.second!,
  };
}

/** How far `timeZone` is ahead of UTC at `date`, in ms. */
function offsetMs(date: Date, timeZone: string): number {
  const wall = wallTimeIn(date, timeZone);
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/**
 * The instant a wall-clock time names in `timeZone`. Corrected once for the
 * offset at the result, which is what lands times near a DST change right; a
 * time skipped by spring-forward comes out an hour later, as clocks read it.
 */
export function zonedTimeToUtc(wall: WallTime, timeZone: string): Date {
  const naive = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
  const first = naive - offsetMs(new Date(naive), timeZone);
  return new Date(naive - offsetMs(new Date(first), timeZone));
}

export type StartTime = { ok: true; at: Date } | { ok: false; error: string };

export function parseStartTime(input: string, timeZone: string, now: Date): StartTime {
  const text = input.trim();
  if (/^now$/i.test(text)) return { ok: true, at: now };

  const delay = DELAY.exec(text);
  if (delay && (delay[1] || delay[2])) {
    const minutes = Number(delay[1] ?? 0) * 60 + Number(delay[2] ?? 0);
    return { ok: true, at: new Date(now.getTime() + minutes * 60_000) };
  }

  const time = TIME.exec(text);
  if (time) {
    const hour = Number(time[1]);
    const minute = Number(time[2]);
    if (hour > 23 || minute > 59) return { ok: false, error: `${text} is not a time of day.` };
    const today = wallTimeIn(now, timeZone);
    let at = zonedTimeToUtc({ ...today, hour, minute }, timeZone);
    if (at.getTime() <= now.getTime()) {
      const tomorrow = new Date(Date.UTC(today.year, today.month - 1, today.day + 1));
      at = zonedTimeToUtc(
        {
          year: tomorrow.getUTCFullYear(),
          month: tomorrow.getUTCMonth() + 1,
          day: tomorrow.getUTCDate(),
          hour,
          minute,
        },
        timeZone,
      );
    }
    return { ok: true, at };
  }

  const dateTime = DATE_TIME.exec(text);
  if (dateTime) {
    const [year, month, day, hour, minute] = dateTime.slice(1).map(Number) as [
      number,
      number,
      number,
      number,
      number,
    ];
    const probe = new Date(Date.UTC(year, month - 1, day));
    if (
      month < 1 ||
      probe.getUTCMonth() !== month - 1 ||
      probe.getUTCDate() !== day ||
      hour > 23 ||
      minute > 59
    ) {
      return { ok: false, error: `${text} is not a date and time.` };
    }
    const at = zonedTimeToUtc({ year, month, day, hour, minute }, timeZone);
    if (at.getTime() < now.getTime() - 60_000) {
      return { ok: false, error: 'That time has already passed.' };
    }
    return { ok: true, at };
  }

  return {
    ok: false,
    error: 'Use `now`, a delay like `in 45m` or `2h`, a time like `20:30`, or `2026-10-02 20:30`.',
  };
}
