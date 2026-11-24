import { Link } from '@tanstack/react-router';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import type { HistoryEntry, LogStatus } from '@trackt/shared';
import { useEffect, useRef } from 'react';
import { kindDotClass } from '../ui/KindDot';
import { FilterCell, KindStrip } from '../ui/FilterBar';
import type { SelectItem } from '../ui/Select';
import { HistoryTimeline } from './HistoryTimeline';
import {
  ALL_STATUSES,
  ALL_YEARS,
  HISTORY_STATUSES,
  type HistorySearchParams,
  type HistoryViewMode,
} from '../../lib/history-search';
import { useFormat } from '../../lib/format';
import { useLabels } from '../../lib/labels';
import { useLoadMoreSentinel } from '../../lib/use-load-more-sentinel';
import {
  coverGradient,
  HISTORY_GROUPINGS,
  groupEntries,
  useHistory,
  type HistoryGrouping,
} from '@trackt/client';

/**
 * The year view (ADR-0007). Absorbs the ROADMAP's Library page: ALL TIME with
 * no kind or status filter is "everything I've ever tracked".
 *
 * `planned` rows never reach this page: the server excludes anything with
 * neither date, and a watchlist is not a history, so the status filter offers
 * the other four only.
 *
 * One view for the viewer's own history and anyone else's, both at
 * `/users/$username/history`: they differ only in whose rows they ask for and
 * in the handle above the title.
 */

export interface HistoryViewProps {
  /** A handle reads that person's history; absent reads the viewer's own. */
  username?: string;
  search: HistorySearchParams;
  /** Patch the URL's search params; each route supplies its own navigate. */
  setSearch: (patch: Partial<HistorySearchParams>) => void;
}

/**
 * Per-status colour, from `docs/design/History.dc.html`: in-progress is the
 * live pink, paused the warm gold, completed a settled neutral, and dropped
 * recedes into the faint grey. Static class strings so Tailwind's scanner sees
 * every one of them (same reason `KindDot` spells its colours out).
 *
 * `planned` never reaches this page: the server excludes anything with no
 * dates, but the map is total so a status can't fall through to no colour.
 */
const STATUS_STYLES: Record<LogStatus, { text: string; dot: string }> = {
  planned: { text: 'text-dim', dot: 'bg-dim' },
  in_progress: { text: 'text-[#e58cc4]', dot: 'bg-pink' },
  completed: { text: 'text-muted', dot: 'bg-muted' },
  paused: { text: 'text-gold', dot: 'bg-gold' },
  dropped: { text: 'text-dim', dot: 'bg-faint' },
};

/** The API's largest page: the timeline wants everything, in as few trips as possible. */
const TIMELINE_PAGE = 200;

const GROUPING_KEYS = {
  year: 'history.grouping.year',
  season: 'history.grouping.season',
  month: 'history.grouping.month',
} as const satisfies Record<HistoryGrouping, string>;

export function HistoryView({ username, search, setSearch }: HistoryViewProps) {
  const { t } = useTranslation();
  const labels = useLabels();
  const format = useFormat();
  const { kind, status } = search;
  // Absent means this year: the page opens on what you're watching now, not on
  // a decade of everything.
  const year = search.year ?? new Date().getUTCFullYear();
  // Year by default: the page's own axis is the year, so the headings match it
  // out of the box. Season and month are the zoom-ins.
  const group = search.group ?? 'year';
  const view = search.view ?? 'timeline';

  // The year-scoped read: the grid's rows, and in both views the stats, the
  // kind counts and the year picker.
  const history = useHistory({
    username,
    year: year === ALL_YEARS ? undefined : year,
    kind,
    status,
  });
  // The timeline draws the whole span and scrolls to the year instead of
  // filtering to it, so it reads all time, every page.
  const timeline = useHistory({
    username,
    kind,
    status,
    limit: TIMELINE_PAGE,
    enabled: view === 'timeline',
  });
  const { hasMore: timelineHasMore, isLoadingMore: timelineLoadingMore, loadMore } = timeline;
  useEffect(() => {
    if (view === 'timeline' && timelineHasMore && !timelineLoadingMore) loadMore();
  }, [view, timelineHasMore, timelineLoadingMore, loadMore]);

  const sentinel = useRef<HTMLDivElement>(null);
  useLoadMoreSentinel(
    sentinel,
    view === 'grid' && history.entries.length > 0 && history.hasMore,
    `${history.entries.length}:${history.isLoadingMore}`,
    () => {
      if (!history.isLoadingMore) history.loadMore();
    },
  );

  const scope = year === ALL_YEARS ? t('history.allTime') : String(year);
  const groups = groupEntries(history.entries, group, year === ALL_YEARS, format.locale, {
    winter: t('history.season.winter'),
    spring: t('history.season.spring'),
    summer: t('history.season.summer'),
    autumn: t('history.season.autumn'),
  });
  const statusItems: SelectItem[] = [
    {
      value: ALL_STATUSES,
      label: (
        <span className="flex items-center gap-2">
          <span aria-hidden className="size-1.5 rounded-full bg-faint" />
          {t('history.filters.allStatuses')}
        </span>
      ),
    },
    ...HISTORY_STATUSES.map((status) => ({
      value: status,
      label: (
        <span className="flex items-center gap-2">
          <span aria-hidden className={clsx('size-1.5 rounded-full', STATUS_STYLES[status].dot)} />
          {labels.status(status)}
        </span>
      ),
    })),
  ];
  const groupItems: SelectItem[] = HISTORY_GROUPINGS.map((value) => ({
    value,
    label: t(GROUPING_KEYS[value]),
  }));
  // Years come from the facet, so the picker only ever offers years the subject
  // has something in; the count rides along the way the design's menu shows it.
  const yearItems: SelectItem[] = [
    { value: ALL_YEARS, label: t('history.allTime') },
    ...history.years.map((entry) => ({
      value: String(entry.year),
      label: (
        <span className="flex items-center gap-2">
          {entry.year}
          <span className="font-label text-[11px] text-faint">{entry.count}</span>
        </span>
      ),
    })),
  ];
  const filtered = Boolean(kind || status);
  // The picker's own years are unfiltered by year, so an empty list means the
  // account has nothing at all, not just nothing in the selected window.
  const nothingTracked = !history.isLoading && history.years.length === 0 && !filtered;
  const titles = t('history.titles', { count: history.totals.titles });

  const stats = [
    { value: history.totals.completed, label: t('history.stats.completed') },
    { value: history.totals.titles, label: t('history.stats.titles') },
    { value: history.totals.episodes, label: t('history.stats.episodes') },
    { value: history.totals.chapters, label: t('history.stats.chapters') },
  ];
  const timelineEmpty = !timeline.isLoading && timeline.entries.length === 0;
  const active = view === 'timeline' ? timeline : history;
  // The timeline's origin is its oldest title, so it waits for the last page
  // rather than redrawing (and jumping its scroll) as each older one lands.
  const pending = active.isLoading || (view === 'timeline' && timeline.hasMore);

  return (
    <main className="mx-auto flex max-w-[1360px] flex-col gap-6 px-4 pt-12 pb-20 sm:px-10">
      <div className="flex flex-wrap items-end gap-4">
        <h1 className="font-heading text-[64px] leading-none uppercase">{t('history.title')}</h1>
        <span className="mb-2 text-prism font-label text-sm font-bold tracking-label">
          {username && (
            <>
              <Link to="/users/$username" params={{ username }} className="hover:brightness-115">
                @{username}
              </Link>
              {' · '}
            </>
          )}
          {nothingTracked ? t('history.nothingTracked') : t('history.scope', { scope, titles })}
        </span>
        <span className="flex-1" />
        <div
          role="group"
          aria-label={t('history.view.aria')}
          className="flex rounded-full bg-glass p-1 ring-1 ring-white/12 ring-inset"
        >
          {VIEWS.map(({ value, glyph }) => (
            <button
              key={value}
              type="button"
              aria-pressed={view === value}
              onClick={() => setSearch({ view: value === 'timeline' ? undefined : value })}
              className={clsx(
                'flex h-[38px] cursor-pointer items-center gap-2 rounded-full px-[18px] font-label text-xs font-bold tracking-label transition',
                view === value ? 'bg-fg text-on-prism' : 'text-muted hover:text-fg',
              )}
            >
              <span aria-hidden>{glyph}</span>
              {t(`history.view.${value}`)}
            </button>
          ))}
        </div>
      </div>

      {/* One console: every filter is the same cell, and the numbers for
          whatever they select sit underneath. */}
      <div className="fbar flex-col flex-nowrap">
        <div className="flex flex-wrap items-stretch">
          <KindStrip
            value={kind}
            counts={history.kinds}
            onChange={(next) => setSearch({ kind: next })}
          />
          <FilterCell
            label={t('history.filters.year')}
            items={yearItems}
            value={year === ALL_YEARS ? ALL_YEARS : String(year)}
            onChange={(value) =>
              setSearch({ year: value === ALL_YEARS ? ALL_YEARS : Number(value) })
            }
          />
          <FilterCell
            label={t('history.filters.status')}
            items={statusItems}
            value={status ?? ALL_STATUSES}
            onChange={(value) =>
              setSearch({ status: value === ALL_STATUSES ? undefined : (value as LogStatus) })
            }
          />
          {view === 'grid' && (
            <FilterCell
              label={t('history.filters.group')}
              items={groupItems}
              value={group}
              onChange={(value) => setSearch({ group: value as HistoryGrouping })}
            />
          )}
        </div>
        <dl className="m-0 grid grid-cols-2 lg:grid-cols-4">
          {stats.map((stat, index) => (
            <div
              key={stat.label}
              className={clsx(
                'flex min-w-0 items-baseline gap-3 px-6 py-3.5',
                index > 0 && 'shadow-[inset_1px_0_0_rgba(255,255,255,0.09)]',
              )}
            >
              <dt className="order-last truncate font-label text-[11px] font-semibold tracking-[0.1em] text-dim uppercase">
                {stat.label}
              </dt>
              <dd className="m-0 text-prism font-display text-[28px] leading-none">{stat.value}</dd>
            </div>
          ))}
        </dl>
      </div>

      {active.isError ? (
        <p role="alert" className="text-[15px] text-red-400">
          {username ? t('history.public.error', { username }) : t('history.error')}
        </p>
      ) : pending ? (
        <p aria-busy className="text-[15px] text-muted">
          {t('history.loading', { scope: scope.toLowerCase() })}
        </p>
      ) : view === 'timeline' ? (
        timelineEmpty ? (
          <EmptyHistory
            username={username}
            nothingTracked={nothingTracked}
            filtered={filtered}
            scope={t('history.allTime')}
            onClearFilters={() => setSearch({ kind: undefined, status: undefined })}
          />
        ) : (
          <HistoryTimeline entries={timeline.entries} jumpYear={year} />
        )
      ) : history.entries.length === 0 ? (
        <EmptyHistory
          username={username}
          nothingTracked={nothingTracked}
          filtered={filtered}
          scope={scope}
          onClearFilters={() => setSearch({ kind: undefined, status: undefined })}
        />
      ) : (
        <>
          {groups.map((group) => (
            <section key={group.key} className="flex flex-col gap-4">
              <div className="flex items-baseline gap-3.5">
                <h2 className="font-heading text-[28px] uppercase">{group.label}</h2>
                <span className="font-label text-[11px] font-semibold tracking-[0.1em] text-dim">
                  {t('history.titles', { count: group.entries.length })}
                </span>
                <span aria-hidden className="h-px flex-1 self-center bg-divider" />
              </div>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-x-4 gap-y-[26px]">
                {group.entries.map((entry) => (
                  <HistoryCard key={entry.id} entry={entry} />
                ))}
              </div>
            </section>
          ))}

          <div ref={sentinel} aria-hidden="true" className="h-px" />
          <p
            role="status"
            className="min-h-5 text-center font-label text-[12px] tracking-label text-dim"
          >
            {history.isLoadingMore ? t('history.loadingMore') : ''}
          </p>
        </>
      )}
    </main>
  );
}

const VIEWS: { value: HistoryViewMode; glyph: string }[] = [
  { value: 'timeline', glyph: '▬' },
  { value: 'grid', glyph: '▦' },
];

/**
 * The artwork stays clean but for the score; the record sits underneath, so
 * nothing needs a hover to be read.
 */
function HistoryCard({ entry }: { entry: HistoryEntry }) {
  const labels = useLabels();
  const format = useFormat();
  const range = format.dateRange(entry.startedAt, entry.finishedAt);
  return (
    <Link
      to="/media/$slug"
      params={{ slug: entry.slug }}
      className="group flex min-w-0 flex-col gap-2.5 focus-visible:outline-none"
    >
      <span
        className="relative block aspect-[2/3] overflow-hidden rounded-[10px] bg-cover bg-center shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14),0_10px_28px_-14px_rgba(0,0,0,0.9)] transition duration-160 group-hover:-translate-y-1 group-hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.22),0_18px_36px_-16px_rgba(217,107,176,0.45),0_10px_28px_-14px_rgba(0,0,0,0.9)] group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-pink motion-reduce:transition-none motion-reduce:group-hover:translate-y-0"
        style={
          entry.coverUrl
            ? { backgroundImage: `url(${entry.coverUrl})` }
            : { background: coverGradient(entry.kind, entry.title) }
        }
      >
        {entry.score !== null && (
          <span className="absolute top-2 right-2 rounded-full bg-on-prism px-[9px] py-[5px] font-display text-[15px] leading-none text-[#e58cc4] ring-1 ring-white/14 ring-inset">
            {format.score(entry.score)}
          </span>
        )}
      </span>
      <span className="flex min-w-0 flex-col gap-[5px]">
        <span className="line-clamp-2 text-sm leading-[1.3] font-semibold">{entry.title}</span>
        <span className="flex flex-wrap items-center gap-[7px]">
          <span
            aria-hidden
            className={clsx('size-[7px] shrink-0 rounded-full', kindDotClass[entry.kind])}
          />
          <span className="font-label text-[11px] font-semibold tracking-label text-muted uppercase">
            {labels.kindSingular(entry.kind)}
          </span>
          <span
            className={clsx(
              'font-label text-[11px] font-semibold tracking-[0.06em] uppercase',
              STATUS_STYLES[entry.status].text,
            )}
          >
            · {labels.status(entry.status)}
          </span>
        </span>
        {range && (
          <span className="font-label text-[11px] font-medium tracking-[0.06em] text-dim">
            {range}
          </span>
        )}
      </span>
    </Link>
  );
}

/**
 * Three distinct empty states, because they call for three different actions:
 * an account with nothing tracked, a window with nothing in it, and a filter
 * that excludes everything the window holds.
 *
 * Someone else's page keeps the first two but not the action under them: the
 * only thing there is to do about an empty account is log something, and that
 * is their account, not yours.
 */
function EmptyHistory({
  username,
  nothingTracked,
  filtered,
  scope,
  onClearFilters,
}: {
  username: string | undefined;
  nothingTracked: boolean;
  filtered: boolean;
  scope: string;
  onClearFilters: () => void;
}) {
  const { t } = useTranslation();
  const body = nothingTracked
    ? username
      ? t('history.public.emptyNothingBody', { username })
      : t('history.empty.nothingBody')
    : filtered
      ? username
        ? t('history.public.emptyFilteredBody', { username, scope })
        : t('history.empty.filteredBody', { scope })
      : username
        ? t('history.public.emptyWindowBody', { username })
        : t('history.empty.windowBody');
  return (
    <div className="flex flex-col items-center gap-2 rounded-card border border-dashed border-white/20 bg-glass px-8 py-11 text-center backdrop-blur-[16px]">
      <p className="font-heading text-[32px] text-faint uppercase">
        {nothingTracked
          ? t('history.empty.nothingTitle')
          : filtered
            ? t('history.empty.filteredTitle')
            : t('history.empty.windowTitle', { scope })}
      </p>
      <p className="max-w-[460px] text-sm leading-relaxed text-muted">{body}</p>
      {filtered && !nothingTracked && (
        <button
          type="button"
          onClick={onClearFilters}
          className="tap-area mt-2 cursor-pointer font-label text-xs font-semibold tracking-label text-pink hover:brightness-115"
        >
          {t('history.empty.clear')}
        </button>
      )}
      {nothingTracked && !username && (
        <Link
          to="/search"
          className="tap-area mt-2 font-label text-xs font-semibold tracking-label text-pink hover:brightness-115"
        >
          {t('history.empty.browse')}
        </Link>
      )}
    </div>
  );
}
