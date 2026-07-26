import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Link, useLocation, useNavigate, type LinkProps } from '@tanstack/react-router';
import clsx from 'clsx';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { UserRoleSchema, isModerator } from '@trackt/shared';
import { authClient } from '../../lib/auth-client';
import { Avatar } from '../ui/Avatar';
import { Tooltip } from '../ui/Tooltip';
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
  { label: 'LISTS', to: '/lists' },
  { label: 'ACTIVITY', to: '/profile' },
];

export interface AppNavUser {
  /** Display name (better-auth `name`). */
  name: string;
  /** Unique @handle (better-auth `displayUsername`). */
  username: string;
  /** Uploaded avatar URL (better-auth `image`). */
  image?: string | null;
  /** Per-instance role (better-auth `role`); gates the MODERATION link. */
  role?: string;
}

/** Sticky authenticated-app navigation: wordmark, section links, search, account menu. */
export function AppNav({ user }: { user: AppNavUser }) {
  const role = UserRoleSchema.safeParse(user.role);
  const items: NavItem[] =
    role.success && isModerator(role.data)
      ? [...NAV_ITEMS, { label: 'MODERATION', to: '/moderation' }]
      : NAV_ITEMS;
  return (
    <nav className="sticky top-0 z-10 flex items-center gap-8 border-b border-divider bg-ink/75 px-10 py-5 backdrop-blur-[16px]">
      <Link to="/home">
        <Wordmark className="text-[26px]" />
      </Link>
      <div className="flex gap-6 text-sm font-semibold tracking-btn">
        {items.map((item) =>
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
            <Tooltip key={item.label} label="Coming soon">
              <span tabIndex={0} className="cursor-not-allowed text-dim/60">
                {item.label}
              </span>
            </Tooltip>
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

/** Focus/hover row treatment shared by the menu's actionable items. */
const MENU_ITEM =
  'block w-full cursor-pointer px-4.5 py-3 text-left text-sm text-fg outline-none transition ' +
  'data-[highlighted]:bg-pink-row data-[highlighted]:text-pink';

/**
 * Avatar dropdown: identity header, Profile link, sign out. Radix owns the
 * keyboard contract the hand-rolled version lacked — focus moves into the menu
 * on open, ↑/↓ and typeahead move between items, and focus returns to the
 * avatar on close.
 */
function AccountMenu({ user }: { user: AppNavUser }) {
  const navigate = useNavigate();
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label="account menu"
        className="block cursor-pointer rounded-full transition outline-none hover:brightness-115"
      >
        <Avatar name={user.username} src={user.image} size={32} className="size-9" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={12}
          className="z-20 w-56 overflow-hidden rounded-card-sm border border-glass-border-strong bg-ink/90 shadow-xl backdrop-blur-[16px]"
        >
          <DropdownMenu.Label className="border-b border-divider px-4.5 py-3.5">
            <p className="text-sm font-bold">{user.name}</p>
            <p className="text-[13px] text-dim">@{user.username}</p>
          </DropdownMenu.Label>
          <DropdownMenu.Item asChild className={MENU_ITEM}>
            <Link to="/profile">Profile</Link>
          </DropdownMenu.Item>
          <DropdownMenu.Item
            onSelect={() =>
              authClient.signOut({
                fetchOptions: { onSuccess: () => navigate({ to: '/login' }) },
              })
            }
            className={clsx(MENU_ITEM, 'border-t border-divider')}
          >
            Sign out
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
