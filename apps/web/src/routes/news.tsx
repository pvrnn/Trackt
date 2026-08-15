import * as ToggleGroup from '@radix-ui/react-toggle-group';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import clsx from 'clsx';
import { MEDIA_KINDS, type MediaKind } from '@trackt/shared';
import { AppNav } from '../components/layout/AppNav';
import { AuraBackground } from '../components/layout/AuraBackground';
import { MarketingNav } from '../components/layout/MarketingNav';
import { NewsCard } from '../components/news/NewsCard';
import { Chip } from '../components/ui/Chip';
import { useOptionalSession } from '../lib/auth-client';
import { KIND_LABELS } from '../lib/kinds';
import { useNewsFeed } from '../lib/news';

export interface NewsSearchParams {
  kind?: MediaKind;
  from?: string;
  to?: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function asDate(value: unknown): string | undefined {
  return typeof value === 'string' && ISO_DATE.test(value) ? value : undefined;
}

export const Route = createFileRoute('/news')({
  head: () => ({ meta: [{ title: 'News — Trackt' }] }),
  validateSearch: (search: Record<string, unknown>): NewsSearchParams => ({
    kind: MEDIA_KINDS.includes(search.kind as MediaKind) ? (search.kind as MediaKind) : undefined,
    from: asDate(search.from),
    to: asDate(search.to),
  }),
  component: NewsPage,
});

/** Toggle-group value for the unfiltered state; `kind` stays undefined in the URL. */
const ALL_KINDS = 'all';

/** Relative ranges, resolved against today. `null` days = no lower bound. */
const RANGES: { label: string; days: number | null }[] = [
  { label: 'TODAY', days: 0 },
  { label: 'THIS WEEK', days: 7 },
  { label: 'THIS MONTH', days: 30 },
  { label: 'ALL TIME', days: null },
];

function isoDaysAgo(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function NewsPage() {
  const navigate = useNavigate({ from: Route.fullPath });
  const { kind, from, to } = Route.useSearch();
  const { isPending, navUser } = useOptionalSession();
  const feed = useNewsFeed({ kind, from, to });

  const setSearch = (patch: Partial<NewsSearchParams>) => {
    navigate({ search: (previous) => ({ ...previous, ...patch }) });
  };

  const activeRange = RANGES.find((range) =>
    range.days === null ? !from && !to : from === isoDaysAgo(range.days) && !to,
  );

  // The session only decides which nav renders — news is public, so the page
  // never waits on it beyond the first paint.
  if (isPending) return <div className="min-h-screen bg-ink" />;

  return (
    <div className="min-h-screen bg-ink text-fg">
      <AuraBackground variant="app" />
      <div className="relative">
        {navUser ? <AppNav user={navUser} /> : <MarketingNav />}
        <main className="mx-auto flex max-w-[1360px] flex-col gap-7 px-6 pt-12 pb-20 sm:px-10">
          <h1 className="font-heading text-[64px] leading-none uppercase">News</h1>

          <ToggleGroup.Root
            type="single"
            aria-label="filter by media kind"
            value={kind ?? ALL_KINDS}
            onValueChange={(value) => {
              // Radix emits '' when the active item is pressed again; a filter
              // row has no "nothing selected" state, so ignore it.
              if (!value) return;
              setSearch({ kind: value === ALL_KINDS ? undefined : (value as MediaKind) });
            }}
            className="scrollbar-none flex gap-1 overflow-x-auto border-b border-divider"
          >
            {[ALL_KINDS, ...MEDIA_KINDS].map((value) => {
              const selected = (kind ?? ALL_KINDS) === value;
              return (
                <ToggleGroup.Item
                  key={value}
                  value={value}
                  className={clsx(
                    '-mb-px cursor-pointer border-b-2 px-5 py-3 font-label text-[13px] font-semibold tracking-label whitespace-nowrap transition',
                    selected
                      ? 'border-pink text-fg'
                      : 'border-transparent text-dim hover:text-pink',
                  )}
                >
                  {value === ALL_KINDS ? 'ALL' : KIND_LABELS[value as MediaKind]}
                </ToggleGroup.Item>
              );
            })}
          </ToggleGroup.Root>

          <div className="flex flex-wrap items-center gap-2">
            {RANGES.map((range) => (
              <Chip
                key={range.label}
                selected={activeRange?.label === range.label}
                onClick={() =>
                  setSearch({
                    from: range.days === null ? undefined : isoDaysAgo(range.days),
                    to: undefined,
                  })
                }
              >
                {range.label}
              </Chip>
            ))}
            <span aria-hidden className="mx-1 h-5 w-px bg-glass-border-strong" />
            <label className="flex items-center gap-2 rounded-full border border-glass-border-strong bg-glass px-3.5 py-1.5">
              <span className="font-label text-[10px] font-bold tracking-label text-dim">FROM</span>
              <input
                type="date"
                value={from ?? ''}
                onChange={(event) => setSearch({ from: event.target.value || undefined })}
                className="bg-transparent font-label text-xs text-fg [color-scheme:dark] outline-none"
              />
            </label>
            <label className="flex items-center gap-2 rounded-full border border-glass-border-strong bg-glass px-3.5 py-1.5">
              <span className="font-label text-[10px] font-bold tracking-label text-dim">TO</span>
              <input
                type="date"
                value={to ?? ''}
                onChange={(event) => setSearch({ to: event.target.value || undefined })}
                className="bg-transparent font-label text-xs text-fg [color-scheme:dark] outline-none"
              />
            </label>
            {(from || to) && (
              <button
                type="button"
                onClick={() => setSearch({ from: undefined, to: undefined })}
                className="cursor-pointer font-label text-[11px] font-semibold tracking-label text-dim hover:text-pink"
              >
                CLEAR
              </button>
            )}
          </div>

          <div className="flex items-baseline justify-between gap-4">
            <h2 className="font-heading text-[32px] uppercase">Latest</h2>
            {!feed.isLoading && feed.articles.length > 0 && (
              <span className="font-label text-xs tracking-label text-dim">
                {feed.articles.length} {feed.articles.length === 1 ? 'STORY' : 'STORIES'}
                {feed.hasMore ? '+' : ''}
              </span>
            )}
          </div>

          {feed.isLoading ? (
            <p aria-busy className="text-[15px] text-muted">
              Loading the feed…
            </p>
          ) : feed.isError ? (
            <p role="alert" className="text-[15px] text-red-400">
              News failed to load — is this instance&apos;s API reachable? Try again in a moment.
            </p>
          ) : feed.articles.length === 0 ? (
            <EmptyFeed filtered={Boolean(kind || from || to)} />
          ) : (
            <>
              {/* A plain responsive grid, not the mockup's masonry. The
                  hand-packed 3-column version was fixed at three at every
                  width — three ~110px columns on a phone — and its DOM order
                  was column-major (1, 4, 7, 2, 5, 8…), so keyboard and screen
                  reader order disagreed with the recency the packing existed
                  to produce. A grid costs ragged card bottoms and buys back
                  both. */}
              <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {feed.articles.map((article) => (
                  <NewsCard key={article.id} article={article} />
                ))}
              </div>

              {feed.hasMore && (
                <div className="flex justify-center">
                  <button
                    type="button"
                    onClick={feed.loadMore}
                    disabled={feed.isLoadingMore}
                    className="cursor-pointer rounded-full border border-glass-border-strong bg-glass px-6 py-3 font-label text-xs font-semibold tracking-label text-muted transition hover:border-pink hover:text-pink disabled:cursor-wait disabled:opacity-60"
                  >
                    {feed.isLoadingMore ? 'LOADING…' : 'LOAD MORE'}
                  </button>
                </div>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}

/**
 * The empty state carries real information: an unfiltered empty feed usually
 * means this instance has no catalog configured or the catalog has published
 * nothing yet, which is a very different thing from an over-narrow filter.
 */
function EmptyFeed({ filtered }: { filtered: boolean }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-card border border-dashed border-white/20 bg-glass px-8 py-10 text-center backdrop-blur-[16px]">
      <p className="font-heading text-[32px] text-faint uppercase">Nothing yet</p>
      <p className="max-w-[420px] text-sm text-muted">
        {filtered
          ? 'No stories match these filters. Widen the dates, or clear the kind.'
          : 'No news has been published yet. Stories appear here once the central catalog starts publishing them.'}
      </p>
      <Link
        to="/search"
        className="mt-2 font-label text-xs font-semibold tracking-label text-pink hover:brightness-115"
      >
        BROWSE DISCOVER →
      </Link>
    </div>
  );
}
