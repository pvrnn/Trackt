import * as ToggleGroup from '@radix-ui/react-toggle-group';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MEDIA_KINDS, type MediaKind } from '@trackt/shared';
import { AppNav } from '../components/layout/AppNav';
import { AuraBackground } from '../components/layout/AuraBackground';
import { CoverCard } from '../components/media/CoverCard';
import { Chip } from '../components/ui/Chip';
import { KindDot } from '../components/ui/KindDot';
import { useAuthedPage } from '../lib/auth-client';
import { useLabels } from '../lib/labels';
import {
  MEDIA_SEARCH_LIMIT,
  gameSearchContext,
  groupGameSearchResults,
  useMediaSearch,
} from '@trackt/client';

export interface SearchParams {
  q?: string;
  kind?: MediaKind;
  page?: number;
}

/**
 * The highest page the API can serve: it caps `offset` at 1000, and each page is
 * one search batch, so a page is only reachable while its offset is under it.
 */
const MAX_SEARCH_PAGE = Math.floor(1000 / MEDIA_SEARCH_LIMIT) + 1;

export const Route = createFileRoute('/search')({
  head: ({ match }) => ({ meta: [{ title: match.context.i18n.t('meta.discover') }] }),
  validateSearch: (search: Record<string, unknown>): SearchParams => ({
    q: typeof search.q === 'string' && search.q ? search.q : undefined,
    kind: MEDIA_KINDS.includes(search.kind as MediaKind) ? (search.kind as MediaKind) : undefined,
    page:
      Number.isInteger(Number(search.page)) && Number(search.page) > 1
        ? Math.min(Number(search.page), MAX_SEARCH_PAGE)
        : 1,
  }),
  component: SearchPage,
});

/** Toggle-group value for the unfiltered state; `kind` stays undefined in the URL. */
const ALL_KINDS = 'all';

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
  const { q = '', kind, page = 1 } = Route.useSearch();
  const [input, setInput] = useState(q);
  const [pageInput, setPageInput] = useState(String(page));
  const { status, results, hasMore } = useMediaSearch(q, kind, page - 1);
  const resultGroups = groupGameSearchResults(results);
  const currentPage = page;

  function goToPage(nextPage: number) {
    const boundedPage = Math.max(1, Math.min(MAX_SEARCH_PAGE, nextPage));
    setPageInput(String(boundedPage));
    navigate({
      search: (previous) => ({ ...previous, page: boundedPage > 1 ? boundedPage : undefined }),
    });
  }

  useEffect(() => setPageInput(String(currentPage)), [currentPage]);

  const pagination = q && (currentPage > 1 || results.length > 0) && (
    <nav
      aria-label={t('discover.pagination')}
      className="flex flex-wrap items-center justify-center gap-2"
    >
      <button
        type="button"
        onClick={() => goToPage(currentPage - 1)}
        disabled={currentPage === 1}
        className="rounded-full border border-white/10 bg-white/[0.04] px-5 py-2.5 font-label text-[12px] tracking-label text-fg transition-colors enabled:hover:text-pink disabled:cursor-not-allowed disabled:text-white/25"
      >
        ← {t('discover.previous').toUpperCase()}
      </button>
      {Array.from(
        new Set([
          Math.max(1, currentPage - 1),
          currentPage,
          // Nothing past the ceiling is reachable: the API refuses an offset
          // over 1000, and goToPage would clamp the click back to this page.
          ...(hasMore && currentPage < MAX_SEARCH_PAGE ? [currentPage + 1] : []),
        ]),
      ).map((pageNumber) => (
        <button
          key={pageNumber}
          type="button"
          onClick={() => goToPage(pageNumber)}
          aria-current={currentPage === pageNumber ? 'page' : undefined}
          aria-label={t('discover.pageNumber', { page: pageNumber })}
          className={`min-w-10 rounded-full px-3 py-2 font-label text-[12px] tracking-label transition-colors ${
            currentPage === pageNumber
              ? 'bg-pink/15 text-pink ring-1 ring-pink ring-inset'
              : 'bg-white/[0.04] text-dim ring-1 ring-white/10 ring-inset hover:text-pink'
          }`}
        >
          {pageNumber}
        </button>
      ))}
      <form
        className="ml-2 flex items-center gap-2 rounded-full bg-white/[0.04] px-3 py-1.5 ring-1 ring-white/10 ring-inset"
        onSubmit={(event) => {
          event.preventDefault();
          const requestedPage = Number(pageInput);
          if (
            Number.isInteger(requestedPage) &&
            requestedPage >= 1 &&
            requestedPage <= MAX_SEARCH_PAGE
          ) {
            goToPage(requestedPage);
          }
        }}
      >
        <label className="flex items-center gap-2 font-label text-[10px] tracking-label text-dim">
          {t('discover.goToPage').toUpperCase()}
          <input
            type="number"
            min={1}
            max={MAX_SEARCH_PAGE}
            value={pageInput}
            onChange={(event) => setPageInput(event.target.value)}
            className="w-10 rounded-full border-0 bg-white/[0.07] px-2 py-1 text-center font-label text-xs text-fg outline-none focus:ring-1 focus:ring-pink"
          />
        </label>
        <button
          type="submit"
          aria-label={t('discover.go')}
          className="text-sm text-dim transition-colors hover:text-pink"
        >
          →
        </button>
      </form>
      <button
        type="button"
        onClick={() => goToPage(currentPage + 1)}
        disabled={!hasMore || currentPage === MAX_SEARCH_PAGE || status === 'loading'}
        className="rounded-full border border-white/10 bg-white/[0.04] px-5 py-2.5 font-label text-[12px] tracking-label text-fg transition-colors enabled:hover:text-pink disabled:cursor-not-allowed disabled:text-white/25"
      >
        {t('discover.next').toUpperCase()} →
      </button>
    </nav>
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
          search: (previous) => ({ ...previous, q: value || undefined, page: undefined }),
          replace: true,
        });
      },
      pasted ? 0 : TYPING_SETTLE_MS,
    );
    return () => clearTimeout(timer);
  }, [input, q, navigate]);

  // No ⌘K listener here: the nav pill now renders on this page too and owns the
  // one global shortcut, so two listeners don't fight over `preventDefault`.
  // This input keeps `autoFocus`, which is what ⌘K would have done on arrival.

  if (isPending || !navUser) return <div className="min-h-screen bg-ink" />;

  return (
    <div className="min-h-screen bg-ink text-fg">
      <AuraBackground variant="app" />
      <div className="relative">
        <AppNav user={navUser} />
        <main className="mx-auto flex max-w-[1360px] flex-col gap-7 px-10 pt-12 pb-20">
          <h1 className="font-heading text-[64px] leading-none uppercase">{t('discover.title')}</h1>

          <div className="flex flex-col gap-3.5">
            <label className="flex items-center gap-3.5 rounded-full border border-glass-border-strong bg-glass-well px-6 py-4 backdrop-blur-[16px]">
              <span aria-hidden className="text-lg text-dim">
                ⌕
              </span>
              <input
                type="search"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder={t('discover.searchPlaceholder')}
                // The wrapping label's only content is the aria-hidden ⌕, so
                // without this the name falls back to the placeholder, the
                // weakest source in the accname spec, and gone once you type.
                aria-label={t('discover.searchAria')}
                autoFocus
                className="flex-1 bg-transparent text-[17px] outline-none placeholder:text-dim"
              />
              {/* No ⌘K hint: the shortcut focuses the nav pill, and this field
                  is already focused on arrival. */}
            </label>
            <ToggleGroup.Root
              type="single"
              aria-label={t('discover.filterAria')}
              value={kind ?? ALL_KINDS}
              onValueChange={(value) => {
                // Radix emits '' when the active item is pressed again; a filter
                // row has no "nothing selected" state, so ignore it.
                if (!value) return;
                navigate({
                  search: (previous) => ({
                    ...previous,
                    kind: value === ALL_KINDS ? undefined : (value as MediaKind),
                    page: undefined,
                  }),
                });
              }}
              className="flex flex-wrap gap-2.5"
            >
              {/* `aria-pressed={undefined}` drops Chip's own toggle semantics:
                  ToggleGroup supplies role="radio" + aria-checked here, and a
                  radio that is also aria-pressed is invalid ARIA. */}
              <ToggleGroup.Item value={ALL_KINDS} asChild>
                <Chip selected={kind === undefined} aria-pressed={undefined}>
                  {t('common.all')}
                </Chip>
              </ToggleGroup.Item>
              {MEDIA_KINDS.map((value) => (
                <ToggleGroup.Item key={value} value={value} asChild>
                  <Chip selected={kind === value} aria-pressed={undefined}>
                    {labels.kind(value)}
                  </Chip>
                </ToggleGroup.Item>
              ))}
            </ToggleGroup.Root>
          </div>

          <div className="grid grid-cols-1 items-center gap-3 sm:grid-cols-[1fr_auto_1fr]">
            <h2 className="font-heading text-[32px] uppercase">{t('discover.results')}</h2>
            {pagination}
            {q && status !== 'loading' ? (
              <span className="font-label text-[13px] tracking-label text-dim sm:text-right">
                {t('discover.resultCount', { count: results.length })}
              </span>
            ) : (
              <span aria-hidden="true" />
            )}
          </div>

          {!q ? null : status === 'error' ? (
            <p role="alert" className="text-[15px] text-red-400">
              {t('errors.searchFailed')}
            </p>
          ) : results.length === 0 && status === 'success' ? (
            <p className="text-[15px] text-muted">
              {kind
                ? t('discover.emptyInKind', {
                    query: q,
                    kind: labels.kind(kind).toLowerCase(),
                  })
                : t('discover.empty', { query: q })}
            </p>
          ) : (
            <>
              <ul
                aria-busy={status === 'loading'}
                className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6"
              >
                {resultGroups.map(({ result, related }) => {
                  const gameContext = gameSearchContext(result.kind, result.metadata ?? {});
                  const role = gameContext?.role
                    ? t(`discover.gameRole.${gameContext.role}`)
                    : null;
                  const context = [
                    gameContext?.editionTitle
                      ? t('discover.gameEdition', { name: gameContext.editionTitle })
                      : role,
                    gameContext?.parentTitle
                      ? t('discover.gameFor', { title: gameContext.parentTitle })
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' · ');
                  return (
                    <li key={result.id}>
                      <Link to="/media/$slug" params={{ slug: result.slug }}>
                        <CoverCard
                          kind={result.kind}
                          title={result.title}
                          coverUrl={result.coverUrl ?? undefined}
                          caption={
                            <>
                              <span className="flex items-center gap-2 font-label text-[11px] tracking-label uppercase">
                                <KindDot kind={result.kind} showLabel />
                                {result.year !== null && <span>· {result.year}</span>}
                              </span>
                              {context && (
                                <span className="mt-1 block text-xs text-dim">{context}</span>
                              )}
                            </>
                          }
                        />
                      </Link>
                      {related.length > 0 && (
                        <details className="mt-2 text-xs text-muted">
                          <summary className="cursor-pointer select-none">
                            {t('discover.relatedReleases', { count: related.length })}
                          </summary>
                          <ul className="mt-1 space-y-1 pl-3">
                            {related.map((item) => {
                              const itemContext = gameSearchContext(item.kind, item.metadata ?? {});
                              const itemRole = itemContext?.role
                                ? t(`discover.gameRole.${itemContext.role}`)
                                : null;
                              const itemLabel = [
                                itemContext?.editionTitle
                                  ? t('discover.gameEdition', { name: itemContext.editionTitle })
                                  : itemRole,
                                itemContext?.parentTitle
                                  ? t('discover.gameFor', { title: itemContext.parentTitle })
                                  : null,
                              ]
                                .filter(Boolean)
                                .join(' · ');
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
                  );
                })}
              </ul>
              {pagination}
            </>
          )}

          <aside className="mt-3 rounded-card border border-dashed border-white/20 bg-glass px-8 py-7 backdrop-blur-[16px]">
            <p className="text-base font-bold">{t('discover.missingTitle')}</p>
            <p className="mt-0.5 text-sm text-muted">{t('discover.missingBody')}</p>
          </aside>
        </main>
      </div>
    </div>
  );
}
