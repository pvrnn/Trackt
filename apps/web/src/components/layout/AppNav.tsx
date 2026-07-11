import { Link, useLocation, useNavigate, type LinkProps } from '@tanstack/react-router';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { authClient } from '../../lib/auth-client';
import { Avatar } from '../ui/Avatar';
import { Wordmark } from './Wordmark';

interface NavItem {
  label: string;
  /** Undefined = the page doesn't exist yet; rendered as an inert placeholder. */
  to?: LinkProps['to'];
}

/** Order and labels from the app mockups (Home/Search/Lists/Profile navs). */
const NAV_ITEMS: NavItem[] = [
  { label: 'HOME', to: '/home' },
  { label: 'DISCOVER', to: '/search' },
  { label: 'LISTS' },
  { label: 'ACTIVITY' },
];

export interface AppNavUser {
  /** Display name (better-auth `name`). */
  name: string;
  /** Unique @handle (better-auth `displayUsername`). */
  username: string;
}

/** Sticky authenticated-app navigation: wordmark, section links, search, account menu. */
export function AppNav({ user }: { user: AppNavUser }) {
  return (
    <nav className="sticky top-0 z-10 flex items-center gap-8 border-b border-divider bg-ink/75 px-10 py-5 backdrop-blur-[16px]">
      <Link to="/home">
        <Wordmark className="text-[26px]" />
      </Link>
      <div className="flex gap-6 text-sm font-semibold tracking-btn">
        {NAV_ITEMS.map((item) =>
          item.to ? (
            <Link
              key={item.label}
              to={item.to}
              className="text-dim hover:text-fg"
              activeProps={{ className: 'border-b-2 border-pink pb-0.5 text-fg' }}
            >
              {item.label}
            </Link>
          ) : (
            <span key={item.label} title="Coming soon" className="cursor-not-allowed text-dim/60">
              {item.label}
            </span>
          ),
        )}
      </div>
      <div className="flex-1" />
      <NavSearch />
      <AccountMenu user={user} />
    </nav>
  );
}

/**
 * Real search input: typing stays local, Enter carries the query to /search
 * (each route mounts its own AppNav, so navigating mid-keystroke would drop
 * focus). Hidden on /search itself — that page owns the search UX and the ⌘K
 * shortcut there.
 */
function NavSearch() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const onSearchPage = pathname === '/search';

  useEffect(() => {
    if (onSearchPage) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onSearchPage]);

  if (onSearchPage) return null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    navigate({ to: '/search', search: { q: query.trim() || undefined } });
  };

  return (
    <form
      onSubmit={submit}
      className="hidden w-[260px] items-center gap-2.5 rounded-full border border-glass-border bg-glass-well px-4.5 py-2.5 transition focus-within:border-glass-border-strong lg:flex"
    >
      <span aria-hidden className="text-dim">
        ⌕
      </span>
      <input
        ref={inputRef}
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search titles…"
        aria-label="search titles"
        className="w-full flex-1 bg-transparent text-sm outline-none placeholder:text-dim"
      />
      <kbd className="rounded-md border border-glass-border px-1.5 py-0.5 font-label text-[10px] text-faint">
        ⌘K
      </kbd>
    </form>
  );
}

/** Avatar dropdown: identity header, Profile placeholder, sign out. */
function AccountMenu({ user }: { user: AppNavUser }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="account menu"
        onClick={() => setOpen((current) => !current)}
        className="block cursor-pointer rounded-full transition hover:brightness-115"
      >
        <Avatar name={user.username} size={32} className="size-9" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-3 w-56 overflow-hidden rounded-card-sm border border-glass-border-strong bg-ink/90 shadow-xl backdrop-blur-[16px]"
        >
          <div className="border-b border-divider px-4.5 py-3.5">
            <p className="text-sm font-bold">{user.name}</p>
            <p className="text-[13px] text-dim">@{user.username}</p>
          </div>
          <span
            role="menuitem"
            aria-disabled
            title="Coming soon"
            className="block cursor-not-allowed px-4.5 py-3 text-sm text-dim/60"
          >
            Profile
          </span>
          <button
            type="button"
            role="menuitem"
            onClick={() =>
              authClient.signOut({
                fetchOptions: { onSuccess: () => navigate({ to: '/login' }) },
              })
            }
            className="block w-full cursor-pointer border-t border-divider px-4.5 py-3 text-left text-sm text-fg transition hover:bg-pink-row hover:text-pink"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
