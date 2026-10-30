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
  MIN_MEDIA_SEARCH_QUERY,
  gameSearchContext,
  groupGameSearchResults,
  useMediaSearch,
  useShowcase,
} from '@trackt/client';

export interface SearchParams {
  q?: string;
  kind?: MediaKind;
}

export const Route = createFileRoute('/search')({
  head: ({ match }) => ({ meta: [{ title: match.context.i18n.t('meta.discover') }] }),
  validateSearch: (search: Record<string, unknown>): SearchParams => ({
    q: typeof search.q === 'string' && search.q ? search.q : undefined,
    kind: MEDIA_KINDS.includes(search.kind as MediaKind) ? (search.kind as MediaKind) : undefined,
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
  const { q = '', kind } = Route.useSearch();
  const [input, setInput] = useState(q);
  const { status, results, hasMore, loadMore, loadingMore } = useMediaSearch(q, kind);
  // What the page shows before anything is typed: the instance's own catalog,
  // narrowed by the same kind chips the results are. It is the one honest thing
  // an empty search box can say, and it needs no query to say it.
  const { data: showcase } = useShowcase(kind);
  const browseItems = q ? [] : (showcase ?? []);
  const resultGroups = groupGameSearchResults(results);
  const tooShort = q.trim().length > 0 && q.trim().length < MIN_MEDIA_SEARCH_QUERY;

  // Infinite scroll: the sentinel sits past the grid and pulls the next batch
  // when it comes within 600px of the viewport, so the next batch is usually
  // there before the last row is. Re-observing after every batch is deliberate
  // — an IntersectionObserver only reports *changes*, so a sentinel that stays
  // in view across a batch would never fire again and the grid would stall one
  // screen short of the fold; `loadingMore` is in the deps for the batch that
  // appended nothing new (a deduplicated overlap), which `results.length` misses.
  const sentinel = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef(loadMore);
  useEffect(() => {
    loadMoreRef.current = loadMore;
  });
  useEffect(() => {
    const node = sentinel.current;
    if (!node || !hasMore || status !== 'success') return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadMoreRef.current();
      },
      { rootMargin: '600px 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, status, results.length, loadingMore]);

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

          {!q ? (
            /* Nothing typed yet: the instance's own catalog, under the filter
               chips above. No heading when the shelf is empty — a lone "On this
               instance" over nothing reads as a load that failed. */
            browseItems.length > 0 && (
              <>
                <h2 className="font-heading text-[32px] uppercase">
                  {kind
                    ? t('discover.browseKind', { kind: labels.kind(kind) })
                    : t('discover.browse')}
                </h2>
                <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                  {browseItems.map((item) => (
                    <li key={item.id}>
                      <Link to="/media/$slug" params={{ slug: item.slug }}>
                        <CoverCard
                          kind={item.kind}
                          title={item.title}
                          coverUrl={item.coverUrl ?? undefined}
                          caption={
                            <span className="flex items-center gap-2 font-label text-[11px] tracking-label uppercase">
                              <KindDot kind={item.kind} showLabel />
                              {item.year !== null && <span>· {item.year}</span>}
                            </span>
                          }
                        />
                      </Link>
                    </li>
                  ))}
                </ul>
              </>
            )
          ) : (
            <>
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <h2 className="font-heading text-[32px] uppercase">{t('discover.results')}</h2>
                {status === 'success' && results.length > 0 && (
                  <span className="font-label text-[13px] tracking-label text-dim">
                    {t('discover.resultCount', { count: results.length })}
                  </span>
                )}
              </div>

              {status === 'error' ? (
                <p role="alert" className="text-[15px] text-red-400">
                  {t('errors.searchFailed')}
                </p>
              ) : tooShort ? (
                <p className="text-[15px] text-muted">
                  {t('discover.minQuery', { count: MIN_MEDIA_SEARCH_QUERY })}
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
                                  const itemContext = gameSearchContext(
                                    item.kind,
                                    item.metadata ?? {},
                                  );
                                  const itemRole = itemContext?.role
                                    ? t(`discover.gameRole.${itemContext.role}`)
                                    : null;
                                  const itemLabel = [
                                    itemContext?.editionTitle
                                      ? t('discover.gameEdition', {
                                          name: itemContext.editionTitle,
                                        })
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
                  {/* The sentinel the scroll observer watches, then the only
                      thing a short grid says about more: a batch on its way.
                      Nothing is rendered at the end of the list, because the
                      count above already says how many are showing. */}
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

          <aside className="mt-3 rounded-card border border-dashed border-white/20 bg-glass px-8 py-7 backdrop-blur-[16px]">
            <p className="text-base font-bold">{t('discover.missingTitle')}</p>
            <p className="mt-0.5 text-sm text-muted">{t('discover.missingBody')}</p>
          </aside>
        </main>
      </div>
    </div>
  );
}
