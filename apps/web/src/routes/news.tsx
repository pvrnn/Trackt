import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MEDIA_KINDS, type MediaKind, type NewsArticleSummary } from '@trackt/shared';
import { AppNav } from '../components/layout/AppNav';
import { AuraBackground } from '../components/layout/AuraBackground';
import { MarketingNav } from '../components/layout/MarketingNav';
import { NewsCard, NewsCardSkeleton } from '../components/news/NewsCard';
import { DatePicker } from '../components/ui/DatePicker';
import { FilterBar, FilterCell, KindStrip } from '../components/ui/FilterBar';
import { Masonry } from '../components/ui/Masonry';
import { SkeletonRegion } from '../components/ui/Skeleton';
import { useOptionalSession } from '../lib/auth-client';
import { useHomeSummary, useNewsFeed, useTrackedNews } from '@trackt/client';

export interface NewsSearchParams {
  kind?: MediaKind;
  from?: string;
  to?: string;
  /** `library` narrows the page to stories about titles the viewer tracks. */
  show?: 'library';
  /** 1-based page of Latest; absent is the first. */
  page?: number;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function asPage(value: unknown): number | undefined {
  const page = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isInteger(page) && page > 1 ? page : undefined;
}

function asDate(value: unknown): string | undefined {
  return typeof value === 'string' && ISO_DATE.test(value) ? value : undefined;
}

export const Route = createFileRoute('/news')({
  head: ({ match }) => ({ meta: [{ title: match.context.i18n.t('meta.news') }] }),
  validateSearch: (search: Record<string, unknown>): NewsSearchParams => ({
    kind: MEDIA_KINDS.includes(search.kind as MediaKind) ? (search.kind as MediaKind) : undefined,
    from: asDate(search.from),
    to: asDate(search.to),
    show: search.show === 'library' ? 'library' : undefined,
    page: asPage(search.page),
  }),
  component: NewsPage,
});

/** WHEN's relative ranges, resolved against today. */
const RANGES = [
  { value: 'today', days: 0 },
  { value: 'week', days: 7 },
  { value: 'month', days: 30 },
] as const;

/**
 * In-progress titles asked for news, one rate-limited by-media read each; the
 * first four are the same reads Home's widget makes, so those come from cache.
 */
const LIBRARY_SOURCES = 6;
const LIBRARY_SHOWN = 6;

/** Stories per page of Latest, as the design pages them. */
const PAGE_SIZE = 12;
/** Placeholder keys: `coverHeightFor` turns each into a stable, varied cover. */
const SKELETON_CARDS = Array.from({ length: 8 }, (_, index) => `skeleton-${index}`);

/** The design's three cover heights, picked per story so the masonry has shapes to pack. */
const COVER_HEIGHTS = [130, 180, 240] as const;

function coverHeightFor(id: string): number {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return COVER_HEIGHTS[Math.abs(hash) % COVER_HEIGHTS.length] ?? 180;
}

/** Pre-measurement height: the cover, the meta row and padding, then wrapped text. */
function estimateCardHeight(article: NewsArticleSummary): number {
  const title = Math.ceil(article.title.length / 32) * 20;
  const dek = article.dek ? 8 + Math.ceil(article.dek.length / 42) * 20 : 0;
  return coverHeightFor(article.id) + 88 + title + dek;
}

/** 1 … 4 5 6 … 12: the ends, the current page and its neighbours. */
function pageList(current: number, count: number): (number | 'gap')[] {
  const pages: (number | 'gap')[] = [];
  for (let page = 1; page <= count; page += 1) {
    if (page === 1 || page === count || Math.abs(page - current) <= 1) pages.push(page);
    else if (pages.at(-1) !== 'gap') pages.push('gap');
  }
  return pages;
}

function inWindow(article: NewsArticleSummary, kind?: MediaKind, from?: string, to?: string) {
  const day = article.publishedAt.slice(0, 10);
  return (!kind || article.kinds.includes(kind)) && (!from || day >= from) && (!to || day <= to);
}

function isoDaysAgo(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function NewsPage() {
  const navigate = useNavigate({ from: Route.fullPath });
  const { t } = useTranslation();
  const { kind, from, to, show, page = 1 } = Route.useSearch();
  const { isPending, navUser } = useOptionalSession();
  const feed = useNewsFeed({ kinds: kind ? [kind] : undefined, from, to, limit: PAGE_SIZE });
  // News is public; the library section and the SHOW filter exist only for a
  // signed-in viewer (useHomeSummary stays idle otherwise).
  const { data: summary, isLoading: summaryLoading } = useHomeSummary();
  const libraryIds = (summary?.inProgress ?? []).slice(0, LIBRARY_SOURCES).map((e) => e.id);
  const tracked = useTrackedNews(libraryIds, LIBRARY_SHOWN);
  const library = navUser
    ? tracked.articles.filter((article) => inWindow(article, kind, from, to))
    : [];
  const libraryOnly = Boolean(navUser) && show === 'library';
  const libraryIdSet = new Set(library.map((article) => article.id));

  // Without counts (an older catalog) the pager knows the pages it has walked
  // and whether another follows.
  const pageCount = feed.facets
    ? Math.max(1, Math.ceil(feed.facets.total / PAGE_SIZE))
    : feed.pages.length + (feed.hasMore ? 1 : 0);
  const { loadPages } = feed;
  useEffect(() => loadPages(page), [loadPages, page]);
  const pageArticles = feed.pages[page - 1];
  const latest = (pageArticles ?? []).filter((article) => !libraryIdSet.has(article.id));
  const walking = !feed.isLoading && !pageArticles && (feed.isLoadingMore || feed.hasMore);
  const pastEnd = !feed.isLoading && !pageArticles && !walking && page > 1;

  const latestRef = useRef<HTMLElement>(null);
  const goToPage = (next: number) => {
    navigate({ search: (previous) => ({ ...previous, page: next > 1 ? next : undefined }) });
    latestRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // Every filter is a new feed, so it starts again from its first page.
  const setSearch = (patch: Partial<NewsSearchParams>) => {
    navigate({ search: (previous) => ({ ...previous, ...patch, page: undefined }) });
  };

  const preset = RANGES.find((range) => from === isoDaysAgo(range.days) && !to);
  // CUSTOM is a choice before it is a pair of dates, so it needs to survive
  // being picked with neither date set yet.
  const [customPicked, setCustomPicked] = useState(false);
  const when = preset ? preset.value : from || to || customPicked ? 'custom' : 'all';
  const whenItems = [
    { value: 'all', label: t('news.when.all') },
    ...RANGES.map((range) => ({ value: range.value, label: t(`news.when.${range.value}`) })),
    { value: 'custom', label: t('news.when.custom') },
  ];
  const onWhen = (value: string) => {
    const range = RANGES.find((r) => r.value === value);
    setCustomPicked(value === 'custom');
    if (value === 'custom') return;
    setSearch({ from: range ? isoDaysAgo(range.days) : undefined, to: undefined });
  };
  const filtered = Boolean(kind || from || to);

  // The session only decides which nav renders: news is public, so the page
  // never waits on it beyond the first paint.
  if (isPending) return <div className="min-h-screen bg-ink" />;

  return (
    <div className="min-h-screen bg-ink text-fg">
      <AuraBackground variant="app" />
      <div className="relative">
        {navUser ? <AppNav user={navUser} /> : <MarketingNav />}
        <main className="mx-auto flex max-w-[1360px] flex-col gap-7 px-4 pt-12 pb-20 sm:px-10">
          <h1 className="font-heading text-[64px] leading-none uppercase">{t('news.title')}</h1>

          <div className="flex flex-col gap-2.5">
            <FilterBar>
              <KindStrip
                value={kind}
                counts={libraryOnly ? undefined : feed.facets?.kinds}
                total={feed.facets?.anyKind}
                onChange={(next) => setSearch({ kind: next })}
              />
              {navUser && (
                <FilterCell
                  label={t('news.show.label')}
                  items={[
                    { value: 'all', label: t('news.show.all') },
                    { value: 'library', label: t('news.show.library') },
                  ]}
                  value={libraryOnly ? 'library' : 'all'}
                  onChange={(value) =>
                    setSearch({ show: value === 'library' ? 'library' : undefined })
                  }
                />
              )}
              <FilterCell
                label={t('news.when.label')}
                items={whenItems}
                value={when}
                onChange={onWhen}
              />
            </FilterBar>
            {when === 'custom' && (
              <FilterBar>
                <div className="fcell">
                  <DatePicker
                    variant="cell"
                    label={t('news.from')}
                    value={from ?? ''}
                    onChange={(value) => setSearch({ from: value || undefined })}
                  />
                </div>
                <div className="fcell">
                  <DatePicker
                    variant="cell"
                    label={t('news.to')}
                    value={to ?? ''}
                    onChange={(value) => setSearch({ to: value || undefined })}
                  />
                </div>
                <div className="fcell justify-center">
                  <button
                    type="button"
                    onClick={() => {
                      setCustomPicked(false);
                      setSearch({ from: undefined, to: undefined });
                    }}
                    className="cursor-pointer font-label text-[11px] font-bold tracking-label text-pink hover:brightness-115"
                  >
                    {t('news.clearRange')}
                  </button>
                </div>
              </FilterBar>
            )}
          </div>

          {/* What the viewer already tracks leads; its position says so, not a
              louder card. */}
          {library.length > 0 && (
            <section aria-labelledby="news-library" className="flex flex-col gap-4">
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <h2 id="news-library" className="font-heading text-[32px] uppercase">
                  {t('news.library.title')}
                </h2>
                <span className="font-label text-xs font-semibold tracking-label text-dim">
                  {t('news.storyCount', { count: library.length })}
                </span>
              </div>
              <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {library.map((article) => (
                  <NewsCard key={article.id} article={article} />
                ))}
              </div>
            </section>
          )}

          {libraryOnly ? (
            summaryLoading || (tracked.isPending && libraryIds.length > 0) ? (
              <SkeletonRegion className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: 3 }, (_, index) => (
                  <NewsCardSkeleton key={index} />
                ))}
              </SkeletonRegion>
            ) : (
              library.length === 0 && <EmptyFeed filtered={filtered} library />
            )
          ) : (
            <section ref={latestRef} className="flex scroll-mt-24 flex-col gap-4">
              <div className="flex items-baseline justify-between gap-4">
                <h2 className="font-heading text-[32px] uppercase">{t('news.latest')}</h2>
                {feed.facets && pageArticles && pageArticles.length > 0 && (
                  <span className="font-label text-xs font-semibold tracking-label text-dim">
                    {t('news.range', {
                      from: (page - 1) * PAGE_SIZE + 1,
                      to: (page - 1) * PAGE_SIZE + pageArticles.length,
                      count: feed.facets.total,
                    })}
                  </span>
                )}
              </div>

              {feed.isLoading || walking ? (
                <SkeletonRegion label={walking ? t('news.loadingMore') : t('news.loadingFeed')}>
                  <Masonry
                    items={SKELETON_CARDS}
                    itemKey={(id) => id}
                    estimate={(id) => coverHeightFor(id) + 150}
                  >
                    {(id) => <NewsCardSkeleton coverHeight={coverHeightFor(id)} />}
                  </Masonry>
                </SkeletonRegion>
              ) : feed.isError ? (
                <p role="alert" className="text-[15px] text-red-400">
                  {t('news.feedError')}
                </p>
              ) : pastEnd ? (
                <EmptyFeed filtered />
              ) : latest.length === 0 && pageCount <= 1 ? (
                <EmptyFeed filtered={filtered} />
              ) : (
                <Masonry
                  items={latest}
                  itemKey={(article) => article.id}
                  estimate={estimateCardHeight}
                >
                  {(article) => (
                    <NewsCard article={article} coverHeight={coverHeightFor(article.id)} />
                  )}
                </Masonry>
              )}

              {pageCount > 1 && (
                <Pager
                  page={page}
                  count={pageCount}
                  known={Boolean(feed.facets)}
                  onPage={goToPage}
                />
              )}
            </section>
          )}
        </main>
      </div>
    </div>
  );
}

/**
 * ← PREV, the page numbers, NEXT →. Without a total the numbers stop at the
 * furthest page the feed has reached, plus the one after it.
 */
function Pager({
  page,
  count,
  known,
  onPage,
}: {
  page: number;
  count: number;
  known: boolean;
  onPage: (page: number) => void;
}) {
  const { t } = useTranslation();
  const step =
    'h-9 cursor-pointer rounded-lg px-3.5 font-label text-xs font-bold tracking-label text-muted shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14)] transition hover:text-pink disabled:cursor-default disabled:opacity-40 disabled:hover:text-muted';
  return (
    <nav
      aria-label={t('news.pager.label')}
      className="mt-4 flex flex-wrap items-center justify-center gap-1.5"
    >
      <button type="button" className={step} disabled={page <= 1} onClick={() => onPage(page - 1)}>
        {t('news.pager.prev')}
      </button>
      {(known ? pageList(page, count) : Array.from({ length: count }, (_, index) => index + 1)).map(
        (entry, index) =>
          entry === 'gap' ? (
            <span key={`gap-${index}`} aria-hidden className="w-6 text-center text-dim">
              …
            </span>
          ) : (
            <button
              key={entry}
              type="button"
              aria-label={t('news.pager.page', { page: entry })}
              aria-current={entry === page ? 'page' : undefined}
              onClick={() => onPage(entry)}
              className={
                entry === page
                  ? 'size-9 cursor-pointer rounded-lg bg-pink-selected font-label text-xs font-bold text-pink shadow-[inset_0_0_0_1px_rgb(217_107_176_/_0.6)]'
                  : 'size-9 cursor-pointer rounded-lg font-label text-xs font-bold text-muted transition hover:text-pink'
              }
            >
              {entry}
            </button>
          ),
      )}
      <button
        type="button"
        className={step}
        disabled={page >= count}
        onClick={() => onPage(page + 1)}
      >
        {t('news.pager.next')}
      </button>
    </nav>
  );
}

/**
 * The empty state carries real information: an unfiltered empty feed usually
 * means this instance has no catalog configured or the catalog has published
 * nothing yet, which is a very different thing from an over-narrow filter.
 */
function EmptyFeed({ filtered, library = false }: { filtered: boolean; library?: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center gap-2 rounded-card border border-dashed border-white/20 bg-glass px-8 py-10 text-center backdrop-blur-[16px]">
      <p className="font-heading text-[32px] text-faint uppercase">{t('news.empty.title')}</p>
      <p className="max-w-[420px] text-sm text-muted">
        {library
          ? t('news.empty.library')
          : filtered
            ? t('news.empty.filtered')
            : t('news.empty.unfiltered')}
      </p>
      <Link
        to="/search"
        className="tap-area mt-2 font-label text-xs font-semibold tracking-label text-pink hover:brightness-115"
      >
        {t('news.empty.browse')}
      </Link>
    </div>
  );
}
