import type { HistoryEntry } from '@trackt/shared';

/**
 * Layout for the History timeline (`docs/design/Timeline.dc.html`): one
 * horizontal axis of days, every title a bar from start to finish, packed into
 * the first lane where it overlaps nothing. Titles still going are packed first,
 * latest start first, so they hold the lanes nearest the arrow at today. Pure and unit-agnostic — the caller picks the
 * scale and measures labels; the result is plain pixel offsets.
 */

export interface TimelineOptions {
  /** Today as an ISO date; the axis ends here. */
  today: string;
  /** Horizontal scale, pixels per day. */
  pxPerDay: number;
  /** Space before the first month and after today, in pixels. */
  padStart: number;
  padEnd: number;
  /** The width a title's label needs, so the lane packer never overlaps two. */
  labelWidth: (entry: HistoryEntry, single: boolean) => number;
  /** Minimum horizontal space between two items sharing a lane. */
  laneGap?: number;
}

export interface TimelineItem {
  entry: HistoryEntry;
  x: number;
  /** The item's whole footprint: the wider of its bar and its label. */
  width: number;
  barWidth: number;
  lane: number;
  /** Started and finished the same day: drawn as a diamond, no bar. */
  single: boolean;
  /** In progress with no finish: the bar runs to today and ends in a ring. */
  ongoing: boolean;
  /** Inclusive span in days, start to end. */
  days: number;
  start: string;
  end: string;
  /** Logged stretches, as offsets from `x`. */
  segments: { x: number; width: number }[];
}

export interface TimelineTick {
  x: number;
  year: number;
  /** 0-based month. */
  month: number;
}

export interface TimelineLayout {
  width: number;
  lanes: number;
  items: TimelineItem[];
  ticks: TimelineTick[];
  /** One band per calendar year (the arrow's gradient restarts every January). */
  years: { year: number; x: number; width: number }[];
  todayX: number;
  /** The x of 1 January of a year, for jumping the scroll there. */
  xOfYear: (year: number) => number;
}

const DAY_MS = 86_400_000;

export function dayNumber(iso: string): number {
  return (
    Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) /
    DAY_MS
  );
}

function isoOf(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

/** Where an entry's bar ends: its finish, today while it is still going, else its last check-in. */
function endOf(entry: HistoryEntry, start: string, today: string): string {
  if (entry.finishedAt) return entry.finishedAt;
  if (entry.status === 'in_progress') return today;
  const last = entry.sessions.at(-1)?.to;
  return last && last > start ? last : start;
}

export function layoutTimeline(entries: HistoryEntry[], options: TimelineOptions): TimelineLayout {
  const { today, pxPerDay, padStart, padEnd, labelWidth, laneGap = 18 } = options;
  const tToday = dayNumber(today);
  const earliest = entries.reduce((min, entry) => {
    const start = entry.startedAt ?? entry.loggedOn;
    return start < min ? start : min;
  }, today);
  const t0 = dayNumber(`${earliest.slice(0, 7)}-01`);
  const xOf = (day: number) => padStart + (day - t0) * pxPerDay;

  const rows = entries
    .map((entry) => {
      const start = entry.startedAt ?? entry.loggedOn;
      const end = endOf(entry, start, today);
      return { entry, start, end: end < start ? start : end };
    })
    .sort((a, b) => a.start.localeCompare(b.start) || a.entry.id.localeCompare(b.entry.id));

  const items = rows.map(({ entry, start, end }): TimelineItem => {
    const s = dayNumber(start);
    const e = dayNumber(end) + 1;
    const ongoing = entry.finishedAt === null && entry.status === 'in_progress';
    const single = start === end && !ongoing;
    const barWidth = single ? 14 : Math.max((e - s) * pxPerDay, 4);
    const width = Math.max(barWidth + (ongoing ? 8 : 0), labelWidth(entry, single));
    const x = xOf(s);

    // Check-ins outside the dated span (an import stamps every part on the day it
    // ran) would draw past the bar, so they are clipped to it; with nothing left
    // the whole span reads as active.
    const clipped = entry.sessions
      .map((session) => ({
        from: session.from < start ? start : session.from,
        to: session.to > end ? end : session.to,
      }))
      .filter((session) => session.from <= session.to);
    const spans = clipped.length > 0 ? clipped : [{ from: start, to: end }];
    const segments = single
      ? []
      : spans.map((span) => ({
          x: (dayNumber(span.from) - s) * pxPerDay,
          width: (dayNumber(span.to) + 1 - dayNumber(span.from)) * pxPerDay,
        }));

    return {
      entry,
      x,
      width,
      barWidth,
      lane: 0,
      single,
      ongoing,
      days: Math.round(e - s),
      start,
      end,
      segments,
    };
  });

  const lanes: [number, number][][] = [];
  const place = (item: TimelineItem) => {
    const right = item.x + item.width;
    let lane = lanes.findIndex((spans) =>
      spans.every(([a, b]) => right + laneGap <= a || b + laneGap <= item.x),
    );
    if (lane < 0) lane = lanes.push([]) - 1;
    lanes[lane]!.push([item.x, right]);
    item.lane = lane;
  };
  items
    .filter((item) => item.ongoing)
    .sort((a, b) => b.x - a.x)
    .forEach(place);
  items.filter((item) => !item.ongoing).forEach(place);

  const ticks: TimelineTick[] = [];
  const firstYear = Number(isoOf(t0).slice(0, 4));
  const lastYear = Number(today.slice(0, 4));
  for (let year = firstYear; year <= lastYear; year++) {
    for (let month = 0; month < 12; month++) {
      const day = Date.UTC(year, month, 1) / DAY_MS;
      if (day < t0) continue;
      if (day > tToday) break;
      ticks.push({ x: xOf(day), year, month });
    }
  }

  const years: TimelineLayout['years'] = [];
  for (let year = firstYear; year <= lastYear; year++) {
    const a = xOf(Date.UTC(year, 0, 1) / DAY_MS);
    const b = xOf(Date.UTC(year + 1, 0, 1) / DAY_MS);
    years.push({ year, x: a, width: b - a });
  }

  const todayX = xOf(tToday + 1);
  return {
    width: Math.max(todayX + padEnd, ...items.map((item) => item.x + item.width + 12)),
    lanes: Math.max(lanes.length, 1),
    items,
    ticks,
    years,
    todayX,
    xOfYear: (year) => xOf(Date.UTC(year, 0, 1) / DAY_MS),
  };
}
