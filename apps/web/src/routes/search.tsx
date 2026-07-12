import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { MEDIA_KINDS, type MediaKind } from '@trackt/shared';
import { AppNav } from '../components/layout/AppNav';
import { AuraBackground } from '../components/layout/AuraBackground';
import { CoverCard } from '../components/media/CoverCard';
import { CreateEntryDialog } from '../components/media/CreateEntryDialog';
import { Chip } from '../components/ui/Chip';
import { KindDot } from '../components/ui/KindDot';
import { authClient } from '../lib/auth-client';
import { useMediaSearch } from '../lib/search';

export interface SearchParams {
  q?: string;
  kind?: MediaKind;
}

export const Route = createFileRoute('/search')({
  head: () => ({ meta: [{ title: 'Discover — Trackt' }] }),
  validateSearch: (search: Record<string, unknown>): SearchParams => ({
    q: typeof search.q === 'string' && search.q ? search.q : undefined,
    kind: MEDIA_KINDS.includes(search.kind as MediaKind) ? (search.kind as MediaKind) : undefined,
  }),
  component: SearchPage,
});

/** Filter chip labels per the mockup — plural forms of the media kinds. */
const KIND_LABELS: Record<MediaKind, string> = {
  movie: 'MOVIES',
  series: 'SERIES',
  anime: 'ANIME',
  manga: 'MANGA',
  webtoon: 'WEBTOONS',
};

function SearchPage() {
  const navigate = useNavigate({ from: Route.fullPath });
  const { data: session, isPending } = authClient.useSession();
  const { q = '', kind } = Route.useSearch();
  const [input, setInput] = useState(q);
  const [creating, setCreating] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { status, results } = useMediaSearch(q, kind);

  // Same client-side session guard as home.tsx (see the note there re: SSR cookies).
  useEffect(() => {
    if (!isPending && !session) navigate({ to: '/login' });
  }, [isPending, session, navigate]);

  // Keep the typed value in the URL (?q=…) so searches are shareable/back-able.
  useEffect(() => {
    const value = input.trim();
    if (value === q) return;
    const timer = setTimeout(() => {
      navigate({
        search: (previous) => ({ ...previous, q: value || undefined }),
        replace: true,
      });
    }, 200);
    return () => clearTimeout(timer);
  }, [input, q, navigate]);

  // ⌘K / Ctrl-K focuses the search field (affordance shown in the input).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  if (isPending || !session) return <div className="min-h-screen bg-ink" />;

  return (
    <div className="min-h-screen bg-ink text-fg">
      <AuraBackground variant="app" />
      <div className="relative">
        <AppNav
          user={{
            name: session.user.name,
            username: session.user.displayUsername ?? session.user.name,
            image: session.user.image,
            role: session.user.role,
          }}
        />
        <main className="mx-auto flex max-w-[1360px] flex-col gap-7 px-10 pt-12 pb-20">
          <h1 className="font-display text-[64px] leading-none uppercase">Discover</h1>

          <div className="flex flex-col gap-3.5">
            <label className="flex items-center gap-3.5 rounded-full border border-glass-border-strong bg-glass-well px-6 py-4 backdrop-blur-[16px]">
              <span aria-hidden className="text-lg text-dim">
                ⌕
              </span>
              <input
                ref={inputRef}
                type="search"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="Search titles…"
                autoFocus
                className="flex-1 bg-transparent text-[17px] outline-none placeholder:text-dim"
              />
              <kbd className="rounded-md border border-glass-border-strong px-2 py-1 font-label text-xs text-faint">
                ⌘K
              </kbd>
            </label>
            <div className="flex flex-wrap gap-2.5">
              <Chip
                selected={kind === undefined}
                onClick={() =>
                  navigate({ search: (previous) => ({ ...previous, kind: undefined }) })
                }
              >
                ALL
              </Chip>
              {MEDIA_KINDS.map((value) => (
                <Chip
                  key={value}
                  selected={kind === value}
                  onClick={() => navigate({ search: (previous) => ({ ...previous, kind: value }) })}
                >
                  {KIND_LABELS[value]}
                </Chip>
              ))}
            </div>
          </div>

          <div className="flex items-baseline justify-between">
            <h2 className="font-display text-[32px] uppercase">Results</h2>
            {q && status !== 'loading' && (
              <span className="font-label text-[13px] tracking-label text-dim">
                {results.length} {results.length === 1 ? 'TITLE' : 'TITLES'}
              </span>
            )}
          </div>

          {!q ? (
            <p className="text-[15px] text-muted">
              Search this instance&apos;s catalog — movies, series, anime, manga, and webtoons.
              Typos welcome.
            </p>
          ) : status === 'error' ? (
            <p role="alert" className="text-[15px] text-red-400">
              Search failed — is the instance API reachable? Try again in a moment.
            </p>
          ) : results.length === 0 && status === 'success' ? (
            <p className="text-[15px] text-muted">
              Nothing on this instance matches “{q}”
              {kind ? ` in ${KIND_LABELS[kind].toLowerCase()}` : ''}.
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

          <aside className="mt-3 flex items-center gap-6 rounded-card border border-dashed border-white/20 bg-glass px-8 py-7 backdrop-blur-[16px]">
            <span aria-hidden className="text-prism font-display text-[40px]">
              ＋
            </span>
            <div className="flex-1">
              <p className="text-base font-bold">Can&apos;t find it?</p>
              <p className="mt-0.5 text-sm text-muted">
                Add it yourself — webtoons and obscure titles welcome. Usable immediately, verified
                by moderators.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="cursor-pointer rounded-full bg-prism px-6 py-3 text-[13px] font-bold tracking-btn text-on-prism transition hover:brightness-110"
            >
              CREATE ENTRY
            </button>
          </aside>
        </main>
      </div>
      {creating && (
        <CreateEntryDialog
          initialTitle={q}
          initialKind={kind}
          onClose={() => setCreating(false)}
          onCreated={(slug) => navigate({ to: '/media/$slug', params: { slug } })}
        />
      )}
    </div>
  );
}
