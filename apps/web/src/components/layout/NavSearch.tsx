import * as Popover from '@radix-ui/react-popover';
import { Link, useNavigate } from '@tanstack/react-router';
import clsx from 'clsx';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import type { SearchResult, UserSearchResult } from '@trackt/shared';
import { coverGradient } from '../../lib/cover';
import { useUserSearch } from '../../lib/friends';
import { useMediaSearch } from '../../lib/search';
import { useDebounced } from '../../lib/use-debounced';
import { Avatar } from '../ui/Avatar';
import { KindDot } from '../ui/KindDot';

/**
 * Both endpoints sit behind a 60 req/min per-IP limit, and a settled keystroke
 * costs one request each — hence 250 ms rather than the 200 ms used elsewhere,
 * and a two-character gate. `users/search` already refuses shorter queries;
 * matching it here keeps the two sections appearing together.
 */
const DEBOUNCE_MS = 250;
const MIN_QUERY = 2;

/** Client-side caps: the panel is a shortcut, `/search` is the full grid. */
const MEDIA_LIMIT = 6;
const PEOPLE_LIMIT = 4;

/** A navigable panel row, in render order — the unit ↑/↓ and Enter operate on. */
type Row =
  | { kind: 'media'; result: SearchResult }
  | { kind: 'user'; result: UserSearchResult }
  | { kind: 'all' };

/**
 * Nav multisearch: typing opens a dropdown with matching titles above matching
 * people, each row a link to its page. Enter with nothing highlighted keeps the
 * original behaviour and carries the query to /search.
 *
 * Deliberately *not* limited server-side: the media query key stays identical to
 * the Discover page's (`['search', q, undefined]`), so pressing Enter renders
 * /search straight from this cache. The slicing is client-side instead.
 *
 * Renders on /search too — it owns the one global ⌘K listener in the app.
 */
export function NavSearch() {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const listboxId = useId();
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);

  const debounced = useDebounced(query, DEBOUNCE_MS).trim();
  const active = debounced.length >= MIN_QUERY;
  // Both hooks pass `signal` and keep previous data, so superseded keystrokes
  // abort and the panel holds the last results instead of flashing empty.
  const media = useMediaSearch(active ? debounced : '');
  const users = useUserSearch(active ? debounced : '');

  const mediaResults = media.status === 'error' ? [] : media.results.slice(0, MEDIA_LIMIT);
  const userResults = users.isError ? [] : (users.data ?? []).slice(0, PEOPLE_LIMIT);
  // The skeleton is for an empty panel only — once either side has landed it
  // renders, rather than being hidden behind the slower of the two.
  const hasResults = mediaResults.length > 0 || userResults.length > 0;
  const loading = !hasResults && (media.status === 'loading' || users.isFetching);
  // A side that failed degrades to the other while that one has something to
  // show. With nothing to show it must say so: reporting "nothing matches" for
  // a query whose title half never completed states a negative we don't have.
  const failed = !loading && !hasResults && (media.status === 'error' || users.isError);
  const empty = !loading && !failed && !hasResults;

  const rows: Row[] = [
    ...mediaResults.map((result): Row => ({ kind: 'media', result })),
    ...userResults.map((result): Row => ({ kind: 'user', result })),
    { kind: 'all' },
  ];

  // ⌘K / Ctrl-K focuses the pill from anywhere, including /search.
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'k') return;
      // The pill is `lg:flex`-only. Focusing a `display:none` input does
      // nothing, so below that breakpoint leave the browser's own Ctrl-K alone
      // rather than swallowing it for a shortcut that can't land.
      const input = inputRef.current;
      if (!input || input.offsetParent === null) return;
      event.preventDefault();
      input.focus();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // The two queries settle independently, so the row list grows *after* the
  // media half lands — keying this on `debounced` alone would leave an index
  // taken against the short list pointing at a different row once people
  // arrive, and Enter would open something the user never highlighted.
  const rowsKey = rows.map((row) => (row.kind === 'all' ? 'all' : row.result.id)).join('|');
  useEffect(() => setHighlighted(-1), [rowsKey]);

  const open = active && focused && !dismissed;

  const seeAll = (q: string) => navigate({ to: '/search', search: { q: q || undefined } });

  const go = (row: Row) => {
    setDismissed(true);
    if (row.kind === 'media') navigate({ to: '/media/$slug', params: { slug: row.result.slug } });
    else if (row.kind === 'user')
      navigate({ to: '/users/$username', params: { username: row.result.username } });
    // The row's own label reads “See all results for <debounced>” — going
    // anywhere else would betray it, and `debounced` is the key already warm
    // in the cache that /search is about to render from.
    else seeAll(debounced);
  };

  // Enter with nothing highlighted submits what has been *typed*, debounce or
  // not, so a fast typist never loses their last characters to the timer.
  const submit = (event: FormEvent) => {
    event.preventDefault();
    seeAll(query.trim());
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      // First Escape closes the panel, a second one clears the field. The
      // preventDefault matters: Chrome and Safari clear a `type="search"`
      // input on Escape natively, collapsing the two steps into one.
      event.preventDefault();
      if (open) setDismissed(true);
      else setQuery('');
      return;
    }
    if (!open) return;
    // Wrap within the flat row list; -1 (nothing highlighted) enters at either end.
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlighted((current) => (current >= rows.length - 1 ? 0 : current + 1));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlighted((current) => (current <= 0 ? rows.length - 1 : current - 1));
      return;
    }
    if (event.key === 'Enter' && highlighted >= 0) {
      const row = rows[highlighted];
      if (row) {
        event.preventDefault();
        go(row);
      }
    }
  };

  const optionId = (index: number) => `${listboxId}-option-${index}`;

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) setDismissed(true);
      }}
    >
      <Popover.Anchor asChild>
        <form
          ref={formRef}
          onSubmit={submit}
          className="hidden w-[260px] items-center gap-2.5 rounded-full border border-glass-border bg-glass-well px-4.5 py-2.5 transition focus-within:border-glass-border-strong lg:flex"
        >
          <span aria-hidden className="text-dim">
            ⌕
          </span>
          <input
            ref={inputRef}
            type="search"
            role="combobox"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              // Typing reopens a panel an earlier Escape closed. Done here
              // rather than in an effect on `query`, so the Escape that
              // *clears* the field doesn't immediately reopen the panel over
              // the results still sitting in the 250 ms debounce window.
              setDismissed(false);
            }}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onKeyDown={onKeyDown}
            placeholder="Search titles or people…"
            aria-label="search titles and people"
            aria-expanded={open}
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={open && highlighted >= 0 ? optionId(highlighted) : undefined}
            autoComplete="off"
            className="w-full flex-1 bg-transparent text-sm outline-none placeholder:text-dim"
          />
          <kbd className="rounded-md border border-glass-border px-1.5 py-0.5 font-label text-[10px] text-faint">
            ⌘K
          </kbd>
        </form>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          // Focus must never leave the input: Radix would otherwise move it into
          // the panel on open and back to the anchor on close, and a mousedown
          // on a row would blur the field before its click landed.
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onMouseDown={(event) => event.preventDefault()}
          // Radix exempts only `Popover.Trigger` from outside-dismissal, and
          // there is no trigger here — the anchor is the form. Without this,
          // clicking into the input to reposition the caret counts as an
          // interaction outside and closes the panel.
          onInteractOutside={(event) => {
            if (formRef.current?.contains(event.target as Node)) event.preventDefault();
          }}
          className="z-20 max-h-[70vh] w-[420px] overflow-y-auto rounded-card-sm border border-glass-border-strong bg-ink/90 py-2 shadow-xl backdrop-blur-[16px]"
        >
          <div id={listboxId} role="listbox" aria-label="search results">
            {loading && <LoadingRows />}
            {failed && (
              <p role="alert" className="px-4 py-3 text-sm text-red-400">
                Search is unavailable right now.
              </p>
            )}
            {empty && (
              <p className="px-4 py-3 text-sm text-muted">Nothing matches “{debounced}”.</p>
            )}

            {mediaResults.length > 0 && (
              <Section label="TITLES">
                {mediaResults.map((result, index) => (
                  <MediaRow
                    key={result.id}
                    result={result}
                    id={optionId(index)}
                    highlighted={highlighted === index}
                    onHighlight={() => setHighlighted(index)}
                    onSelect={() => setDismissed(true)}
                  />
                ))}
              </Section>
            )}

            {userResults.length > 0 && (
              <Section label="PEOPLE">
                {userResults.map((result, index) => {
                  const rowIndex = mediaResults.length + index;
                  return (
                    <UserRow
                      key={result.id}
                      result={result}
                      id={optionId(rowIndex)}
                      highlighted={highlighted === rowIndex}
                      onHighlight={() => setHighlighted(rowIndex)}
                      onSelect={() => setDismissed(true)}
                    />
                  );
                })}
              </Section>
            )}

            <Link
              to="/search"
              search={{ q: debounced }}
              id={optionId(rows.length - 1)}
              role="option"
              aria-selected={highlighted === rows.length - 1}
              onMouseEnter={() => setHighlighted(rows.length - 1)}
              onClick={() => setDismissed(true)}
              className={clsx(
                'mt-1 block truncate border-t border-divider px-4 pt-3 pb-1.5 text-[13px] text-dim',
                highlighted === rows.length - 1 && 'text-pink',
              )}
            >
              See all results for “{debounced}”
            </Link>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  const headingId = useId();
  return (
    <div role="group" aria-labelledby={headingId}>
      <h2 id={headingId} className="px-4 pt-2 pb-1 font-label text-xs tracking-label text-dim">
        {label}
      </h2>
      {children}
    </div>
  );
}

/** Shared row chrome: the highlight is driven by ↑/↓ *and* hover, never :hover alone. */
const ROW = 'flex w-full items-center gap-3 px-4 py-2 text-left outline-none transition';

function MediaRow({
  result,
  id,
  highlighted,
  onHighlight,
  onSelect,
}: {
  result: SearchResult;
  id: string;
  highlighted: boolean;
  onHighlight: () => void;
  onSelect: () => void;
}) {
  return (
    <Link
      to="/media/$slug"
      params={{ slug: result.slug }}
      id={id}
      role="option"
      aria-selected={highlighted}
      onMouseEnter={onHighlight}
      onClick={onSelect}
      className={clsx(ROW, highlighted && 'bg-pink-row')}
    >
      {result.coverUrl ? (
        <img
          src={result.coverUrl}
          alt=""
          className="h-12 w-8 shrink-0 rounded object-cover"
          loading="lazy"
        />
      ) : (
        <span
          aria-hidden
          className="h-12 w-8 shrink-0 rounded"
          style={{ background: coverGradient(result.kind, result.title) }}
        />
      )}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={clsx('truncate text-sm font-bold', highlighted && 'text-pink')}>
          {result.title}
        </span>
        <span className="flex items-center gap-2 font-label text-[11px] tracking-label uppercase">
          <KindDot kind={result.kind} showLabel />
          {result.year !== null && <span className="text-dim">· {result.year}</span>}
        </span>
      </span>
    </Link>
  );
}

function UserRow({
  result,
  id,
  highlighted,
  onHighlight,
  onSelect,
}: {
  result: UserSearchResult;
  id: string;
  highlighted: boolean;
  onHighlight: () => void;
  onSelect: () => void;
}) {
  return (
    <Link
      to="/users/$username"
      params={{ username: result.username }}
      id={id}
      role="option"
      aria-selected={highlighted}
      onMouseEnter={onHighlight}
      onClick={onSelect}
      className={clsx(ROW, highlighted && 'bg-pink-row')}
    >
      <Avatar name={result.username} src={result.image} size={32} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={clsx('truncate text-sm font-bold', highlighted && 'text-pink')}>
          {result.name}
        </span>
        <span className="truncate text-xs text-dim">@{result.username}</span>
      </span>
    </Link>
  );
}

function LoadingRows() {
  return (
    <div aria-busy className="flex flex-col gap-2 px-4 py-3">
      {[0, 1, 2].map((row) => (
        <span key={row} className="h-10 animate-pulse rounded bg-glass-well" />
      ))}
    </div>
  );
}
