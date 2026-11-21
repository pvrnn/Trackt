import { Link } from '@tanstack/react-router';
import clsx from 'clsx';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MEDIA_KINDS, type HistoryEntry, type MediaKind } from '@trackt/shared';
import { coverGradient, layoutTimeline, todayIso, type TimelineItem } from '@trackt/client';
import { kindDotClass } from '../ui/KindDot';
import { useFormat } from '../../lib/format';
import { useLabels } from '../../lib/labels';

/**
 * The History timeline (`docs/design/Timeline.dc.html`): one arrow of time you
 * scroll sideways, every kind on it, colour saying which. Lanes alternate above
 * and below the arrow so the bar is always the part nearest it. `mini` is the
 * Profile's embed: no header or key, every lane above the arrow, a fixed scale.
 */

const ZOOMS = [
  { pxPerDay: 3, key: 'history.timeline.zoom.years' },
  { pxPerDay: 6, key: 'history.timeline.zoom.months' },
  { pxPerDay: 12, key: 'history.timeline.zoom.weeks' },
] as const;

const FULL = { lane: 72, bar: 14, gap: 8, band: 38, shaft: 8, headL: 24, headH: 15, dot: 18 };
const MINI = { lane: 36, bar: 10, gap: 4, band: 28, shaft: 5, headL: 16, headH: 10, dot: 13 };
const MINI_PX_PER_DAY = 3.4;
const PAD_START = 48;
const PAD_END = 110;

/** The prism's three stops, for colouring the arrow head where the shaft ends. */
const PRISM = [
  [217, 164, 65],
  [217, 107, 176],
  [139, 92, 246],
] as const;

function prismAt(fraction: number): string {
  const f = Math.min(1, Math.max(0, fraction));
  const seg = f < 0.5 ? 0 : 1;
  const u = seg === 0 ? f / 0.5 : (f - 0.5) / 0.5;
  const from = PRISM[seg]!;
  const to = PRISM[seg + 1]!;
  return `rgb(${from.map((value, i) => Math.round(value + (to[i]! - value) * u)).join(',')})`;
}

const kindColor = (kind: MediaKind) => `var(--color-kind-${kind})`;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export interface HistoryTimelineProps {
  entries: HistoryEntry[];
  /** The year picked above: the timeline scrolls there rather than filtering to it. */
  jumpYear?: number | 'all';
  mini?: boolean;
}

export function HistoryTimeline({ entries, jumpYear = 'all', mini = false }: HistoryTimelineProps) {
  const { t } = useTranslation();
  const labels = useLabels();
  const format = useFormat();
  const [zoom, setZoom] = useState(1);
  const scroller = useRef<HTMLDivElement>(null);
  const today = todayIso();
  const pxPerDay = mini ? MINI_PX_PER_DAY : ZOOMS[zoom]!.pxPerDay;
  const {
    lane: LANE,
    bar: BAR,
    gap: GAP,
    band: BAND,
    shaft: SHAFT,
    headL: HEAD_L,
    headH: HEAD_H,
    dot: TODAY_DOT,
  } = mini ? MINI : FULL;

  const dateFormat = useMemo(
    () =>
      new Intl.DateTimeFormat(format.locale, {
        day: '2-digit',
        month: 'short',
        year: '2-digit',
        timeZone: 'UTC',
      }),
    [format.locale],
  );
  const monthFormat = useMemo(
    () => new Intl.DateTimeFormat(format.locale, { month: 'short', timeZone: 'UTC' }),
    [format.locale],
  );
  const short = (iso: string) =>
    dateFormat
      .format(new Date(`${iso}T00:00:00Z`))
      .replace(/\./g, '')
      .toLocaleUpperCase(format.locale);

  const tagOf = (entry: HistoryEntry): string | null =>
    entry.status === 'paused' || entry.status === 'dropped'
      ? labels.status(entry.status).toLocaleUpperCase(format.locale)
      : entry.score !== null
        ? format.score(entry.score)
        : null;

  const metaOf = (item: Pick<TimelineItem, 'single' | 'start' | 'end' | 'ongoing' | 'days'>) =>
    item.single
      ? short(item.start)
      : `${short(item.start)} → ${item.ongoing ? t('history.timeline.todayMark') : short(item.end)} · ${t('history.timeline.days', { count: item.days })}`;

  const layout = layoutTimeline(entries, {
    today,
    pxPerDay,
    padStart: PAD_START,
    padEnd: PAD_END,
    // An estimate from character counts, as the design does: measuring every
    // label in the DOM before layout would cost a second render for nothing.
    labelWidth: (entry, single) => {
      const tag = tagOf(entry);
      const titleChars = entry.title.length + (tag ? tag.length + 1 : 0);
      if (mini) return titleChars * 6.4 + 14;
      const metaChars = single ? 9 : 30;
      return 30 + 9 + Math.max(titleChars * 7.3, metaChars * 6.4) + 12;
    },
  });

  const above = mini ? layout.lanes : Math.ceil(layout.lanes / 2);
  const below = mini ? 0 : Math.floor(layout.lanes / 2);
  const axisY = above * LANE + 6;
  const height = axisY + BAND + below * LANE + (below ? 4 : 0);
  const tipDay = (layout.width - HEAD_L - layout.xOfYear(Number(today.slice(0, 4)))) / pxPerDay;
  const daysInYear =
    (layout.xOfYear(Number(today.slice(0, 4)) + 1) - layout.xOfYear(Number(today.slice(0, 4)))) /
    pxPerDay;
  const tipColor = prismAt(tipDay / daysInYear);

  // Opening, zooming and picking the current year all land on today; another
  // year lands on its 1 January.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const currentYear = Number(today.slice(0, 4));
    el.scrollLeft =
      jumpYear === 'all' || jumpYear >= currentYear
        ? el.scrollWidth
        : Math.max(0, layout.xOfYear(jumpYear) - 24);
    // Only the year and the zoom move the view; the parent mounts this once
    // every page is in, so the axis origin no longer shifts under it.
  }, [jumpYear, zoom]);

  const step = (direction: 1 | -1) => {
    const el = scroller.current;
    if (!el) return;
    el.scrollBy({
      left: direction * el.clientWidth * 0.75,
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    });
  };
  const toToday = () => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTo({ left: el.scrollWidth, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  };

  const iconButton =
    'flex size-[38px] cursor-pointer items-center justify-center rounded-full text-[17px] ring-1 ring-white/18 ring-inset transition hover:ring-pink';

  return (
    <div
      className={clsx(
        'relative flex min-w-0 flex-col bg-white/4 ring-1 ring-glass-border backdrop-blur-[16px] ring-inset',
        mini ? 'rounded-card-sm' : 'rounded-[18px]',
      )}
    >
      {!mini && (
        <div className="flex flex-wrap items-center gap-x-[18px] gap-y-2.5 px-[18px] py-3.5 shadow-[inset_0_-1px_0_rgba(255,255,255,0.09)]">
          {MEDIA_KINDS.map((kind) => (
            <span
              key={kind}
              className="flex items-center gap-1.5 font-label text-[11px] font-bold tracking-[0.1em] text-muted uppercase"
            >
              <span aria-hidden className={clsx('size-2 rounded-full', kindDotClass[kind])} />
              {labels.kind(kind)}
            </span>
          ))}
          <span className="flex-1" />
          <div
            role="group"
            aria-label={t('history.timeline.zoomAria')}
            className="flex items-center gap-1 rounded-full p-[3px] ring-1 ring-white/14 ring-inset"
          >
            <button
              type="button"
              aria-label={t('history.timeline.zoomOut')}
              disabled={zoom === 0}
              onClick={() => setZoom((z) => Math.max(0, z - 1))}
              className="flex size-8 cursor-pointer items-center justify-center rounded-full text-base text-fg transition hover:bg-white/8 disabled:cursor-default disabled:text-faint disabled:hover:bg-transparent"
            >
              −
            </button>
            <span className="min-w-[74px] text-center font-label text-[10px] font-bold tracking-[0.1em] text-muted">
              {t(ZOOMS[zoom]!.key)}
            </span>
            <button
              type="button"
              aria-label={t('history.timeline.zoomIn')}
              disabled={zoom === ZOOMS.length - 1}
              onClick={() => setZoom((z) => Math.min(ZOOMS.length - 1, z + 1))}
              className="flex size-8 cursor-pointer items-center justify-center rounded-full text-base text-fg transition hover:bg-white/8 disabled:cursor-default disabled:text-faint disabled:hover:bg-transparent"
            >
              +
            </button>
          </div>
          <div role="group" aria-label={t('history.timeline.moveAria')} className="flex gap-1">
            <button
              type="button"
              aria-label={t('history.timeline.earlier')}
              onClick={() => step(-1)}
              className={iconButton}
            >
              ‹
            </button>
            <button
              type="button"
              aria-label={t('history.timeline.later')}
              onClick={() => step(1)}
              className={iconButton}
            >
              ›
            </button>
          </div>
          <button
            type="button"
            onClick={toToday}
            className="h-[38px] cursor-pointer rounded-full px-4 font-label text-[11px] font-bold tracking-label text-[#e58cc4] ring-1 ring-pink/55 transition ring-inset hover:bg-pink/14"
          >
            {t('history.timeline.toToday')}
          </button>
        </div>
      )}

      <div
        ref={scroller}
        tabIndex={0}
        role="region"
        aria-label={t('history.timeline.region')}
        className={clsx(
          'overflow-x-auto overflow-y-hidden focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-pink',
          mini ? 'py-3' : 'py-[18px]',
        )}
      >
        <div className="relative" style={{ width: layout.width, height }}>
          {layout.ticks.map((tick) => {
            const january = tick.month === 0;
            const label = january
              ? String(tick.year)
              : pxPerDay >= 5 || tick.month % 3 === 0
                ? monthFormat
                    .format(new Date(Date.UTC(tick.year, tick.month, 1)))
                    .replace(/\./g, '')
                    .toLocaleUpperCase(format.locale)
                : '';
            return (
              <span key={`${tick.year}-${tick.month}`} aria-hidden>
                <span
                  className={clsx(
                    'absolute top-0 bottom-0 w-px',
                    january ? 'bg-white/20' : 'bg-white/6',
                  )}
                  style={{ left: tick.x }}
                />
                <span
                  className={clsx(
                    'absolute pl-1.5 font-label text-[10px] font-bold tracking-[0.1em] whitespace-nowrap',
                    january ? 'text-fg' : 'text-dim',
                  )}
                  style={{ left: tick.x, top: axisY + (mini ? 10 : 13) }}
                >
                  {label}
                </span>
              </span>
            );
          })}

          {/* The shaft is one prism per calendar year: gold in January, violet by December. */}
          <span
            aria-hidden
            className="absolute left-0 overflow-hidden"
            style={{ top: axisY - SHAFT / 2, width: layout.width - HEAD_L, height: SHAFT }}
          >
            {layout.years.map((year) => (
              <span
                key={year.year}
                className="absolute top-0 bottom-0 bg-prism"
                style={{ left: year.x, width: year.width }}
              />
            ))}
          </span>
          <span
            aria-hidden
            className="absolute size-0"
            style={{
              left: layout.width - HEAD_L - 1,
              top: axisY - HEAD_H,
              borderLeft: `${HEAD_L}px solid ${tipColor}`,
              borderTop: `${HEAD_H}px solid transparent`,
              borderBottom: `${HEAD_H}px solid transparent`,
            }}
          />
          <span
            aria-hidden
            className="absolute rounded-full bg-ink shadow-[inset_0_0_0_3px_#f0edf4]"
            style={{
              left: layout.todayX,
              top: axisY - TODAY_DOT / 2,
              width: TODAY_DOT,
              height: TODAY_DOT,
              marginLeft: -TODAY_DOT / 2,
            }}
          />
          <span
            aria-hidden
            className="absolute ml-3 font-label text-[10px] font-bold tracking-[0.1em] whitespace-nowrap text-fg"
            style={{ left: layout.todayX, top: axisY + (mini ? 10 : 13) }}
          >
            {t('history.timeline.todayMark')}
          </span>

          {layout.items.map((item) => {
            const up = mini || item.lane % 2 === 0;
            const level = mini ? item.lane : Math.floor(item.lane / 2);
            const { entry } = item;
            const tag = tagOf(entry);
            const meta = metaOf(item);
            const color = kindColor(entry.kind);
            return (
              <Link
                key={entry.id}
                to="/media/$slug"
                params={{ slug: entry.slug }}
                title={`${entry.title} · ${meta}`}
                className="group absolute flex justify-end text-fg transition-[filter] hover:z-[2] hover:text-fg hover:brightness-125 focus-visible:z-[2] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pink motion-reduce:transition-none"
                style={{
                  left: item.x,
                  width: item.width,
                  height: LANE - 8,
                  gap: GAP,
                  top: up ? axisY - 10 - (level + 1) * LANE + 8 : axisY + BAND + level * LANE,
                  flexDirection: up ? 'column' : 'column-reverse',
                }}
              >
                <span className="sticky left-3 flex max-w-full items-center gap-[9px] self-start pr-2">
                  {!mini && (
                    <span
                      aria-hidden
                      className="h-11 w-[30px] shrink-0 rounded-[5px] bg-cover bg-center ring-1 ring-white/16 ring-inset"
                      style={
                        entry.coverUrl
                          ? { backgroundImage: `url(${entry.coverUrl})` }
                          : { background: coverGradient(entry.kind, entry.title) }
                      }
                    />
                  )}
                  <span className="flex min-w-0 flex-col gap-[3px]">
                    <span
                      className={clsx(
                        mini ? 'text-[11px]' : 'text-[13px]',
                        'leading-[1.2] font-semibold whitespace-nowrap underline-offset-[3px] group-hover:underline',
                      )}
                    >
                      {entry.title}{' '}
                      {tag && (
                        <span
                          className={clsx(
                            'font-label text-[10px] font-bold tracking-[0.06em]',
                            entry.status === 'paused'
                              ? 'text-gold'
                              : entry.status === 'dropped'
                                ? 'text-dim'
                                : 'text-[#e58cc4]',
                          )}
                        >
                          {tag}
                        </span>
                      )}
                    </span>
                    {!mini && (
                      <span className="font-label text-[10px] font-medium tracking-[0.06em] whitespace-nowrap text-muted">
                        {meta}
                      </span>
                    )}
                  </span>
                </span>
                <span aria-hidden className="relative w-full shrink-0" style={{ height: BAR }}>
                  {!item.single && (
                    <span
                      className="absolute top-1/2 left-0 -mt-px h-0.5"
                      style={{
                        width: item.barWidth,
                        background: `repeating-linear-gradient(90deg, ${color} 0 5px, transparent 5px 10px)`,
                      }}
                    />
                  )}
                  {item.segments.map((segment) => (
                    <span
                      key={segment.x}
                      className={clsx(
                        'absolute top-0 bottom-0 min-w-1 rounded',
                        entry.status === 'dropped' && 'opacity-50',
                      )}
                      style={{ left: segment.x, width: segment.width, background: color }}
                    />
                  ))}
                  {item.single && (
                    <span
                      className="absolute top-1/2 left-px rotate-45 rounded-[2px]"
                      style={{
                        width: BAR - 1,
                        height: BAR - 1,
                        marginTop: -(BAR - 1) / 2,
                        background: color,
                      }}
                    />
                  )}
                  {item.ongoing && (
                    <span
                      className="absolute top-1/2 -mt-1.5 -ml-1.5 size-3 rounded-full bg-[#17131d]"
                      style={{ left: item.barWidth, boxShadow: `inset 0 0 0 3px ${color}` }}
                    />
                  )}
                </span>
              </Link>
            );
          })}
        </div>
      </div>

      {mini && (
        <div className="absolute top-2 right-2 flex gap-1">
          {([-1, 1] as const).map((direction) => (
            <button
              key={direction}
              type="button"
              aria-label={t(direction < 0 ? 'history.timeline.earlier' : 'history.timeline.later')}
              onClick={() => step(direction)}
              className="flex size-7 cursor-pointer items-center justify-center rounded-full bg-[#191520] text-sm ring-1 ring-white/20 transition ring-inset hover:ring-pink"
            >
              {direction < 0 ? '‹' : '›'}
            </button>
          ))}
        </div>
      )}

      {!mini && (
        <div className="flex flex-wrap items-center gap-x-[26px] gap-y-2.5 px-[18px] pt-3 pb-3.5 font-label text-[11px] font-semibold tracking-[0.06em] text-muted shadow-[inset_0_1px_0_rgba(255,255,255,0.09)]">
          <span className="flex items-center gap-2">
            <span aria-hidden className="h-3 w-[26px] rounded bg-muted" />
            {t('history.timeline.key.logged')}
          </span>
          <span className="flex items-center gap-2">
            <span
              aria-hidden
              className="h-0.5 w-[26px] bg-[repeating-linear-gradient(90deg,#b8b1c4_0_5px,transparent_5px_10px)]"
            />
            {t('history.timeline.key.gap')}
          </span>
          <span className="flex items-center gap-2">
            <span aria-hidden className="size-2.5 rotate-45 rounded-[2px] bg-muted" />
            {t('history.timeline.key.single')}
          </span>
          <span className="flex items-center gap-2">
            <span aria-hidden className="size-3 rounded-full shadow-[inset_0_0_0_3px_#b8b1c4]" />
            {t('history.timeline.key.ongoing')}
          </span>
          <span className="ml-auto text-dim">{t('history.timeline.hint')}</span>
        </div>
      )}
    </div>
  );
}
