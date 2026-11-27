import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  GenreListSchema,
  MEDIA_KINDS,
  SEARCH_SORTS,
  STATUS_FILTERS,
  type MediaKind,
  type SearchResult,
  type SearchSort,
  type StatusFilter,
} from '@trackt/shared';
import { AppNav } from '../components/layout/AppNav';
import { AuraBackground } from '../components/layout/AuraBackground';
import { FilterPanel, FilterTokens, FiltersCell } from '../components/search/DiscoverFilterPanel';
import { DiscoverPoster } from '../components/search/DiscoverPoster';
import { DiscoverSkeleton } from '../components/search/DiscoverSkeleton';
import { FilterBar, FilterCell, KindStrip } from '../components/ui/FilterBar';
import { Select } from '../components/ui/Select';
import type { SelectItem } from '../components/ui/Select';
import { useAuthedPage } from '../lib/auth-client';
import { useLabels } from '../lib/labels';
import { useLoadMoreSentinel } from '../lib/use-load-more-sentinel';
import {
  MIN_MEDIA_SEARCH_QUERY,
  SELECTABLE_YEARS,
  gameSearchContext,
  groupGameSearchResults,
  isSelectableYear,
  useMediaSearch,
  useSearchKindCounts,
  useShowcase,
} from '@trackt/client';

export interface SearchParams {
  q?: string;
  kind?: MediaKind;
  year?: number;
  /** Absent means relevance, so the plain search URL stays the default. */
  sort?: Exclude<SearchSort, 'relevance'>;
  /** Comma-joined, as the API takes it; every genre must match. */
  genres?: string;
  status?: StatusFilter;
}

/** A `?genres=` the API would accept, normalised; anything else is no filter. */
function parseGenres(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const parsed = GenreListSchema.safeParse(value);
  return parsed.success ? parsed.data.join(',') : undefined;
}

/**
 * A URL value that names a year the picker offers, else no filter. The range
 * lives in `@trackt/client` because the mobile year pill offers the same one.
 */
function parseYear(value: unknown): number | undefined {
  const year = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return isSelectableYear(year) ? year : undefined;
}

export const Route = createFileRoute('/search')({
  head: ({ match }) => ({ meta: [{ title: match.context.i18n.t('meta.discover') }] }),
  validateSearch: (search: Record<string, unknown>): SearchParams => ({
    q: typeof search.q === 'string' && search.q ? search.q : undefined,
    kind: MEDIA_KINDS.includes(search.kind as MediaKind) ? (search.kind as MediaKind) : undefined,
    year: parseYear(search.year),
    sort:
      search.sort !== 'relevance' && SEARCH_SORTS.includes(search.sort as SearchSort)
        ? (search.sort as Exclude<SearchSort, 'relevance'>)
        : undefined,
    genres: parseGenres(search.genres),
    status: STATUS_FILTERS.includes(search.status as StatusFilter)
      ? (search.status as StatusFilter)
      : undefined,
  }),
  component: SearchPage,
});

/**
 * How long typing settles before it becomes a query. The search endpoint sits
 * behind a 60/min per-IP bucket, and this timer is the only thing between a
 * keystroke and a request.
 */
const TYPING_SETTLE_MS = 500;

/**
 * How many characters `next` adds to `prev`. A keystroke adds one; a paste, a
 * drag-drop or an autofill adds a run — the difference the caller needs to skip
 * the settle timer, without reading the clipboard and taking paste away from
 * the browser (undo, selection replacement and all).
 */
function insertedCount(prev: string, next: string): number {
  let prefix = 0;
  while (prefix < prev.length && prefix < next.length && prev[prefix] === next[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < prev.length - prefix &&
    suffix < next.length - prefix &&
    prev[prev.length - 1 - suffix] === next[next.length - 1 - suffix]
  ) {
    suffix++;
  }
  return next.length - prefix - suffix;
}

function SearchPage() {
  const { t } = useTranslation();
  const labels = useLabels();
  const navigate = useNavigate({ from: Route.fullPath });
  const { isPending, navUser } = useAuthedPage();
  const {
    q = '',
    kind,
    year,
    sort = 'relevance',
    genres: genreParam,
    status: mediaStatus,
  } = Route.useSearch();
  const [input, setInput] = useState(q);
  const [panelOpen, setPanelOpen] = useState(false);
  const panelId = useId();
  const filtersButton = useRef<HTMLButtonElement>(null);
  const genres = genreParam ? genreParam.split(',') : [];
  const filters = { genres, status: mediaStatus };
  const panelActive = genres.length + (mediaStatus ? 1 : 0);
  const { status, results, hasMore, loadMore, loadingMore } = useMediaSearch(
    q,
    kind,
    year,
    sort,
    filters,
  );
  const kindCounts = useSearchKindCounts(q, year, sort, filters);
  // Hits for every filter at once: the picked kind's count, or all of them.
  const hitCount = kindCounts
    ? kind
      ? (kindCounts[kind] ?? 0)
      : MEDIA_KINDS.reduce((sum, value) => sum + (kindCounts[value] ?? 0), 0)
    : undefined;
  // The count beside RESULTS: the server's, or the list's own once it is all loaded.
  const resultCount =
    hitCount ??
    (status === 'success' && results.length > 0 && !hasMore ? results.length : undefined);
  const panelProps = {
    genres,
    status: mediaStatus,
    onGenres: (next: string[]) =>
      navigate({
        search: (previous) => ({
          ...previous,
          genres: next.length > 0 ? next.join(',') : undefined,
        }),
      }),
    onStatus: (next: StatusFilter | undefined) =>
      navigate({ search: (previous) => ({ ...previous, status: next }) }),
  };
  // What the page shows before anything is typed: the instance's own catalog,
  // narrowed by the same kind chips and year the results are. It survives a
  // query too short to run — there are no results to take its place, and a lone
  // "keep typing" line would blank the page the user arrived on.
  const {
    data: showcase,
    isPending: showcasePending,
    hasMore: showcaseMore,
    loadMore: loadShowcase,
    loadingMore: showcaseLoadingMore,
  } = useShowcase(kind, year, filters);
  const resultGroups = groupGameSearchResults(results);
  const tooShort = q.trim().length > 0 && q.trim().length < MIN_MEDIA_SEARCH_QUERY;
  const browsing = !q || tooShort;
  const browseItems = browsing ? showcase : [];
  const shelfLoading = browsing && showcasePending && showcase.length === 0;
  const resultsLoading = status === 'loading' && results.length === 0;

  const sortItems: SelectItem[] = [
    { value: 'relevance', label: t('discover.sortRelevance') },
    { value: 'newest', label: t('discover.sortNewest') },
    { value: 'az', label: t('discover.sortAz') },
  ];
  const yearItems: SelectItem[] = [
    { value: '', label: t('discover.anyYear') },
    ...SELECTABLE_YEARS.map((value) => ({ value: String(value), label: String(value) })),
  ];
  const emptyMessage = panelActive
    ? t('discover.emptyFiltered', { query: q })
    : kind
      ? year
        ? t('discover.emptyInKindYear', {
            query: q,
            kind: labels.kind(kind).toLowerCase(),
            year,
          })
        : t('discover.emptyInKind', { query: q, kind: labels.kind(kind).toLowerCase() })
      : year
        ? t('discover.emptyInYear', { query: q, year })
        : t('discover.empty', { query: q });

  // Infinite scroll on both grids: the results, and the shelf the page shows
  // before anything is typed. Only one of the two is rendered at a time, so the
  // observers never compete for the fold.
  const sentinel = useRef<HTMLDivElement>(null);
  const shelfSentinel = useRef<HTMLDivElement>(null);
  useLoadMoreSentinel(
    sentinel,
    q !== '' && !tooShort && status === 'success' && hasMore,
    `${results.length}:${loadingMore}`,
    loadMore,
  );
  useLoadMoreSentinel(
    shelfSentinel,
    browsing && browseItems.length > 0 && showcaseMore,
    `${browseItems.length}:${showcaseLoadingMore}`,
    loadShowcase,
  );

  // `?q=` also changes without this field: the nav search submits to this page
  // while it is already mounted (no remount on a search-param change), and
  // Back/Forward rewrites it too. Adopt those, but ignore the echo of our own
  // push below; otherwise a value still in flight overwrites whatever has
  // been typed since, and the two effects push each other back and forth.
  const pushed = useRef(q);
  useEffect(() => {
    if (q === pushed.current) return;
    pushed.current = q;
    setInput(q);
  }, [q]);

  // Keep the typed value in the URL (?q=…) so searches are shareable/back-able.
  // Typing waits out TYPING_SETTLE_MS; text arriving in one go is already
  // settled, so it searches immediately.
  const previousInput = useRef(input);
  useEffect(() => {
    // Only a change to the field is ours to push; a run caused by `q` moving
    // under us (nav search, Back) is the adopt effect's, and rescheduling here
    // would push the value it is replacing.
    const changed = input !== previousInput.current;
    const value = input.trim();
    const pasted = insertedCount(previousInput.current, input) > 1;
    previousInput.current = input;
    if (!changed || value === q) return;
    const timer = setTimeout(
      () => {
        pushed.current = value;
        navigate({
          search: (previous) => ({ ...previous, q: value || undefined }),
          replace: true,
        });
      },
      pasted ? 0 : TYPING_SETTLE_MS,
    );
    return () => clearTimeout(timer);
  }, [input, q, navigate]);

  // No ⌘K listener here: NavSearch owns the one global shortcut and hands it to
  // the `data-discover-query` field below while this page is mounted.

  if (isPending || !navUser) return <div className="min-h-screen bg-ink" />;

  const filtered = kind !== undefined || year !== undefined || panelActive > 0;
  const gameContextLine = (item: SearchResult): string => {
    const context = gameSearchContext(item.kind, item.metadata ?? {});
    if (!context) return '';
    return [
      context.editionTitle
        ? t('discover.gameEdition', { name: context.editionTitle })
        : context.role
          ? t(`discover.gameRole.${context.role}`)
          : null,
      context.parentTitle ? t('discover.gameFor', { title: context.parentTitle }) : null,
    ]
      .filter(Boolean)
      .join(' · ');
  };
  const resetFilters = () => {
    setInput('');
    navigate({ search: {} });
  };

  return (
    <div className="min-h-screen bg-ink text-fg">
      <AuraBackground variant="app" />
      <div className="relative">
        <AppNav user={navUser} />
        <main className="mx-auto flex max-w-[1360px] flex-col gap-7 px-4 pt-12 pb-20 sm:px-10">
          <h1 className="font-heading text-[64px] leading-none uppercase">{t('discover.title')}</h1>

          {/* One row: the query, then every filter as the same cell. */}
          {/* What doesn't fit (status, genres) is the last cell's panel, hung off
              this wrapper; what is set in there shows as tokens under the bar. */}
          <div className="relative">
            <FilterBar className="fbar-discover focus-within:shadow-[inset_0_0_0_1px_rgb(217_107_176_/_0.7)]">
              <label className="fcell flex-[4_1_320px] cursor-text gap-3.5">
                <span aria-hidden className="text-xl leading-none text-dim">
                  ⌕
                </span>
                <input
                  type="search"
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  placeholder={t('discover.searchPlaceholder')}
                  // The label's only other content is aria-hidden, so without this
                  // the name falls back to the placeholder, gone once you type.
                  aria-label={t('discover.searchAria')}
                  autoFocus
                  data-discover-query
                  className="min-w-0 flex-1 bg-transparent py-4 text-[17px] font-medium outline-none placeholder:text-dim [&::-webkit-search-cancel-button]:appearance-none"
                />
                <span
                  aria-hidden
                  className="hidden rounded-md px-2 py-1 font-label text-[11px] font-semibold tracking-[0.06em] text-dim shadow-[inset_0_0_0_1px_rgba(255,255,255,0.15)] lg:inline"
                >
                  ⌘K
                </span>
              </label>
              <KindStrip
                value={kind}
                counts={browsing ? undefined : kindCounts}
                onChange={(next) =>
                  navigate({ search: (previous) => ({ ...previous, kind: next }) })
                }
              />
              <FilterCell
                className="fcell-year"
                label={t('discover.year')}
                items={yearItems}
                value={year === undefined ? '' : String(year)}
                onChange={(value) =>
                  navigate({
                    search: (previous) => ({
                      ...previous,
                      year: value ? Number(value) : undefined,
                    }),
                  })
                }
              />
              <FiltersCell
                ref={filtersButton}
                open={panelOpen}
                active={panelActive}
                panelId={panelId}
                onToggle={() => setPanelOpen((open) => !open)}
              />
            </FilterBar>
            {panelOpen && (
              <FilterPanel
                {...panelProps}
                id={panelId}
                kind={kind}
                total={browsing ? undefined : hitCount}
                onClose={() => {
                  setPanelOpen(false);
                  filtersButton.current?.focus();
                }}
              />
            )}
          </div>

          <FilterTokens {...panelProps} />

          {/* Says why the shelf below hasn't turned into results, without
              taking the shelf away. */}
          {tooShort && (
            <p className="text-[15px] text-muted">
              {t('discover.minQuery', { count: MIN_MEDIA_SEARCH_QUERY })}
            </p>
          )}

          {/* Nothing typed yet (or not enough): the instance's own catalog,
              narrowed by the same tabs and year. No heading over it, by design. */}
          {shelfLoading ? (
            <DiscoverSkeleton className={GRID} />
          ) : browseItems.length > 0 ? (
            <>
              <ul className={GRID}>
                {browseItems.map((item) => (
                  <li key={item.id} className="min-w-0">
                    <DiscoverPoster item={item} />
                  </li>
                ))}
              </ul>
              <div ref={shelfSentinel} aria-hidden="true" className="h-px" />
              <p
                role="status"
                className="min-h-5 text-center font-label text-[12px] tracking-label text-dim"
              >
                {showcaseLoadingMore ? t('discover.loadingMore') : ''}
              </p>
            </>
          ) : (
            browsing &&
            !showcasePending &&
            filtered && <NothingMatches body={t('discover.browseEmpty')} onReset={resetFilters} />
          )}

          {q && !tooShort && (
            <>
              <div className="mt-1 flex flex-wrap items-center justify-between gap-4">
                <h2 className="font-heading text-[32px] uppercase">{t('discover.results')}</h2>
                {/* Sort orders results rather than narrowing them, so it sits
                    with the count as a quiet menu, not in the bar. */}
                <div className="flex items-center gap-1.5">
                  {resultCount !== undefined && (
                    <span className="pr-2.5 font-label text-[12px] font-semibold tracking-label text-dim shadow-[inset_-1px_0_0_rgb(255_255_255_/_0.12)]">
                      {t('discover.resultCount', { count: resultCount })}
                    </span>
                  )}
                  <Select
                    variant="bare"
                    caption={t('discover.sort')}
                    aria-label={t('discover.sort')}
                    items={sortItems}
                    value={sort}
                    onChange={(value) =>
                      navigate({
                        search: (previous) => ({
                          ...previous,
                          sort: value === 'relevance' ? undefined : (value as 'newest' | 'az'),
                        }),
                      })
                    }
                    className="rounded-lg uppercase hover:bg-white/[0.07]"
                  />
                </div>
              </div>

              {resultsLoading ? (
                <DiscoverSkeleton className={GRID} />
              ) : status === 'error' ? (
                <p role="alert" className="text-[15px] text-red-400">
                  {t('errors.searchFailed')}
                </p>
              ) : results.length === 0 && status === 'success' ? (
                <NothingMatches body={emptyMessage} onReset={resetFilters} />
              ) : (
                <>
                  <ul aria-busy={status === 'loading'} className={GRID}>
                    {resultGroups.map(({ result, related }) => (
                      <li key={result.id} className="min-w-0">
                        <DiscoverPoster item={result} context={gameContextLine(result)} />
                        {related.length > 0 && (
                          <details className="mt-2 text-xs text-muted">
                            <summary className="cursor-pointer select-none">
                              {t('discover.relatedReleases', { count: related.length })}
                            </summary>
                            <ul className="mt-1 space-y-1 pl-3">
                              {related.map((item) => {
                                const itemLabel = gameContextLine(item);
                                return (
                                  <li key={item.id}>
                                    <Link
                                      to="/media/$slug"
                                      params={{ slug: item.slug }}
                                      className="block rounded px-1 py-1 hover:bg-white/10 hover:text-fg"
                                    >
                                      <span className="font-semibold">{item.title}</span>
                                      {(item.year !== null || itemLabel) && (
                                        <span className="block text-dim">
                                          {[item.year, itemLabel].filter(Boolean).join(' · ')}
                                        </span>
                                      )}
                                    </Link>
                                  </li>
                                );
                              })}
                            </ul>
                          </details>
                        )}
                      </li>
                    ))}
                  </ul>
                  <div ref={sentinel} aria-hidden="true" className="h-px" />
                  <p
                    role="status"
                    className="min-h-5 text-center font-label text-[12px] tracking-label text-dim"
                  >
                    {loadingMore ? t('discover.loadingMore') : ''}
                  </p>
                </>
              )}
            </>
          )}

          <aside className="mt-3 flex items-center gap-6 rounded-card border border-dashed border-white/20 bg-glass px-8 py-7 backdrop-blur-[16px]">
            <span aria-hidden className="text-prism font-display text-[40px] leading-none">
              ＋
            </span>
            <div>
              <p className="text-base font-bold">{t('discover.missingTitle')}</p>
              <p className="mt-0.5 text-sm text-muted">{t('discover.missingBody')}</p>
            </div>
          </aside>
        </main>
      </div>
    </div>
  );
}

const GRID = 'grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6';

function NothingMatches({ body, onReset }: { body: string; onReset: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center gap-2 rounded-card border border-dashed border-white/20 px-8 py-11 text-center">
      <p className="font-heading text-[32px] text-dim uppercase">{t('discover.nothingMatches')}</p>
      <p className="text-sm text-muted">{body}</p>
      <button
        type="button"
        onClick={onReset}
        className="mt-2 cursor-pointer px-1 py-2 font-label text-xs font-bold tracking-label text-pink hover:brightness-115"
      >
        {t('discover.resetFilters')}
      </button>
    </div>
  );
}
