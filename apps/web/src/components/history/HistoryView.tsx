import { Link } from '@tanstack/react-router';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { MEDIA_KINDS, type HistoryEntry, type LogStatus, type MediaKind } from '@trackt/shared';
import { GlassCard } from '../ui/GlassCard';
import { KindDot } from '../ui/KindDot';
import { Select, type SelectItem } from '../ui/Select';
import {
  ALL_KINDS,
  ALL_STATUSES,
  ALL_YEARS,
  HISTORY_STATUSES,
  type HistorySearchParams,
} from '../../lib/history-search';
import { useFormat } from '../../lib/format';
import { useLabels } from '../../lib/labels';
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
 * One view for two routes — `/history` (the viewer's) and
 * `/users/$username/history` (anyone's) — because they differ only in whose
 * rows they ask for and in the handle above the title.
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
const STATUS_STYLES: Record<LogStatus, { text: string; border: string; dot: string }> = {
  planned: { text: 'text-dim', border: 'border-white/10', dot: 'bg-dim' },
  in_progress: { text: 'text-pink', border: 'border-pink/50', dot: 'bg-pink' },
  completed: { text: 'text-muted', border: 'border-white/15', dot: 'bg-muted' },
  paused: { text: 'text-gold', border: 'border-gold/40', dot: 'bg-gold' },
  dropped: { text: 'text-faint', border: 'border-white/10', dot: 'bg-faint' },
};

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

  const history = useHistory({
    username,
    year: year === ALL_YEARS ? undefined : year,
    kind,
    status,
  });

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

  return (
    <main className="mx-auto flex max-w-[1360px] flex-col gap-6 px-6 pt-12 pb-20 sm:px-10">
      <div className="flex flex-wrap items-baseline gap-4">
        <h1 className="font-heading text-[64px] leading-none uppercase">{t('history.title')}</h1>
        <span className="text-prism font-label text-sm font-bold tracking-label">
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
      </div>

      {/* One row: kinds are tabs (the primary axis, and the one filter worth
          seeing every option of at a glance), everything else is a captioned
          pill on the right. Three stacked rows of chips spent most of their
          width on empty space and pushed the actual history below the fold. */}
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3 border-b border-divider">
        <div className="scrollbar-none flex min-w-0 flex-1 gap-1 overflow-x-auto">
          {[ALL_KINDS, ...MEDIA_KINDS].map((value) => {
            const selected = (kind ?? ALL_KINDS) === value;
            return (
              <button
                key={value}
                type="button"
                aria-pressed={selected}
                onClick={() =>
                  setSearch({ kind: value === ALL_KINDS ? undefined : (value as MediaKind) })
                }
                className={clsx(
                  '-mb-px cursor-pointer border-b-2 px-4 py-3 font-label text-[13px] font-semibold tracking-label whitespace-nowrap transition',
                  selected ? 'border-pink text-fg' : 'border-transparent text-dim hover:text-pink',
                )}
              >
                {value === ALL_KINDS ? t('common.all') : labels.kind(value as MediaKind)}
              </button>
            );
          })}
        </div>

        <div className="mb-2 flex shrink-0 flex-wrap items-center gap-2">
          <Select
            variant="pill"
            caption={t('history.filters.year')}
            aria-label={t('history.filters.yearAria')}
            className="py-2 pr-3 pl-3.5"
            items={yearItems}
            value={year === ALL_YEARS ? ALL_YEARS : String(year)}
            selected={year !== ALL_YEARS}
            onChange={(value) =>
              setSearch({ year: value === ALL_YEARS ? ALL_YEARS : Number(value) })
            }
          />
          <Select
            variant="pill"
            caption={t('history.filters.status')}
            aria-label={t('history.filters.statusAria')}
            className="py-2 pr-3 pl-3.5"
            items={statusItems}
            value={status ?? ALL_STATUSES}
            selected={status !== undefined}
            onChange={(value) =>
              setSearch({ status: value === ALL_STATUSES ? undefined : (value as LogStatus) })
            }
          />
          <Select
            variant="pill"
            caption={t('history.filters.group')}
            aria-label={t('history.filters.groupAria')}
            className="py-2 pr-3 pl-3.5"
            items={groupItems}
            value={group}
            onChange={(value) => setSearch({ group: value as HistoryGrouping })}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <HistoryStat
          value={history.totals.completed}
          label={t('history.stats.completed')}
          note={t('history.stats.completedNote', { scope })}
        />
        <HistoryStat
          value={history.totals.titles}
          label={t('history.stats.inView')}
          note={t('history.stats.inViewNote', { scope })}
        />
        <HistoryStat
          value={history.totals.episodes}
          label={t('history.stats.episodes')}
          note={t('history.stats.checkInsNote', { scope })}
        />
        <HistoryStat
          value={history.totals.chapters}
          label={t('history.stats.chapters')}
          note={t('history.stats.checkInsNote', { scope })}
        />
      </div>

      {history.isError ? (
        <p role="alert" className="text-[15px] text-red-400">
          {username ? t('history.public.error', { username }) : t('history.error')}
        </p>
      ) : history.isLoading ? (
        <p aria-busy className="text-[15px] text-muted">
          {t('history.loading', { scope: scope.toLowerCase() })}
        </p>
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
            <section key={group.key} className="flex flex-col gap-3">
              <div className="flex items-center gap-3.5">
                <h2 className="font-heading text-[26px] uppercase">{group.label}</h2>
                <span className="font-label text-[11px] font-semibold tracking-label text-faint">
                  {t('history.titles', { count: group.entries.length })}
                </span>
                <span aria-hidden className="h-px flex-1 bg-divider" />
              </div>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-4">
                {group.entries.map((entry) => (
                  <HistoryCard key={entry.id} entry={entry} />
                ))}
              </div>
            </section>
          ))}

          {history.hasMore && (
            <div className="flex justify-center">
              <button
                type="button"
                onClick={history.loadMore}
                disabled={history.isLoadingMore}
                className="cursor-pointer rounded-full border border-glass-border-strong bg-glass px-6 py-3 font-label text-xs font-semibold tracking-label text-muted transition hover:border-pink hover:text-pink disabled:cursor-wait disabled:opacity-60"
              >
                {history.isLoadingMore ? t('history.loadingMore') : t('history.loadMore')}
              </button>
            </div>
          )}
        </>
      )}
    </main>
  );
}

function HistoryStat({ value, label, note }: { value: number; label: string; note: string }) {
  return (
    <GlassCard className="flex items-baseline gap-3 rounded-card-sm px-4 py-3">
      <span className="shrink-0 text-prism font-display text-[26px] leading-none">{value}</span>
      <span className="flex min-w-0 flex-col">
        <span className="font-label text-[10px] font-semibold tracking-label text-muted uppercase">
          {label}
        </span>
        <span className="truncate font-label text-[10px] tracking-label text-dim">{note}</span>
      </span>
    </GlassCard>
  );
}

/**
 * A cover with the record on it: status and score at rest, the full log (date
 * range and progress) on hover and focus. Focus matters as much as hover here:
 * the range is the only place the two dates are readable, so a keyboard user
 * must be able to reach it.
 */
function HistoryCard({ entry }: { entry: HistoryEntry }) {
  const labels = useLabels();
  const format = useFormat();
  const range = format.dateRange(entry.startedAt, entry.finishedAt);
  const progress =
    entry.total !== null && entry.status !== 'completed' ? `${entry.watched}/${entry.total}` : null;
  return (
    <Link
      to="/media/$slug"
      params={{ slug: entry.slug }}
      className="group relative block aspect-[2/3] overflow-hidden rounded-cover border border-glass-border bg-cover bg-center transition hover:border-pink focus-visible:border-pink focus-visible:outline-none"
      style={
        entry.coverUrl
          ? { backgroundImage: `url(${entry.coverUrl})` }
          : { background: coverGradient(entry.kind, entry.title) }
      }
    >
      {/* Nothing at rest but the artwork: the overlay below carries the whole
          record (title, kind, date range, progress) on hover and focus. */}
      <span className="absolute inset-0 flex flex-col justify-end gap-2 bg-ink/95 p-4 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
        <span className="font-heading text-lg leading-tight uppercase">{entry.title}</span>
        {range && <span className="font-label text-[13px] font-semibold">{range}</span>}
        <span className="flex items-center gap-2">
          <KindDot kind={entry.kind} showLabel />
          {progress && (
            <span className="font-label text-[11px] tracking-label text-dim">{progress}</span>
          )}
        </span>
      </span>

      {/* Last, so it paints over the hover overlay: status and score are the
          two facts that stay readable in both states. */}
      <span className="absolute inset-x-2 top-2 flex items-center justify-between gap-2">
        <span
          className={clsx(
            'rounded-full border bg-ink/80 px-2.5 py-1 font-label text-[9px] font-bold tracking-label',
            STATUS_STYLES[entry.status].text,
            STATUS_STYLES[entry.status].border,
          )}
        >
          {labels.status(entry.status)}
        </span>
        {entry.score !== null && (
          <span className="rounded-full bg-ink/80 px-2 py-0.5 font-display text-[15px] text-pink">
            {format.score(entry.score)}
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
          className="mt-2 cursor-pointer font-label text-xs font-semibold tracking-label text-pink hover:brightness-115"
        >
          {t('history.empty.clear')}
        </button>
      )}
      {nothingTracked && !username && (
        <Link
          to="/search"
          className="mt-2 font-label text-xs font-semibold tracking-label text-pink hover:brightness-115"
        >
          {t('history.empty.browse')}
        </Link>
      )}
    </div>
  );
}
