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
import { useMediaSearch } from '@trackt/client';

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
  const { status, results } = useMediaSearch(q, kind);

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

          <div className="flex items-baseline justify-between">
            <h2 className="font-heading text-[32px] uppercase">{t('discover.results')}</h2>
            {q && status !== 'loading' && (
              <span className="font-label text-[13px] tracking-label text-dim">
                {t('discover.resultCount', { count: results.length })}
              </span>
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
            <ul
              aria-busy={status === 'loading'}
              className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6"
            >
              {results.map((result) => (
                <li key={result.id}>
                  <Link to="/media/$slug" params={{ slug: result.slug }}>
                    <CoverCard
                      kind={result.kind}
                      title={result.title}
                      coverUrl={result.coverUrl ?? undefined}
                      caption={
                        <span className="flex items-center gap-2 font-label text-[11px] tracking-label uppercase">
                          <KindDot kind={result.kind} showLabel />
                          {result.year !== null && <span>· {result.year}</span>}
                        </span>
                      }
                    />
                  </Link>
                </li>
              ))}
            </ul>
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
