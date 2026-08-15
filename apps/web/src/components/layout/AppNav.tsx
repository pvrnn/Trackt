import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Link, useNavigate, type LinkProps } from '@tanstack/react-router';
import clsx from 'clsx';
import { authClient } from '../../lib/auth-client';
import { useFriends } from '@trackt/client';
import { Avatar } from '../ui/Avatar';
import { Tooltip } from '../ui/Tooltip';
import { NavSearch } from './NavSearch';
import { Wordmark } from './Wordmark';

interface NavItem {
  label: string;
  /** Undefined = the page doesn't exist yet; rendered as an inert placeholder. */
  to?: LinkProps['to'];
}

/**
 * Order from the app mockups (Home/Search/Lists/Profile navs). The mockups
 * label the fourth item ACTIVITY, but it goes to `/profile` — a page that is
 * a profile (identity, favourites, badges, visibility) with activity as one
 * section. Reading it as "the activity feed" sends people to the avatar menu
 * to look for their profile, so it says PROFILE here. ACTIVITY becomes its
 * own item pointing at the real feed when that ships (ROADMAP, v1.x).
 */
const NAV_ITEMS: NavItem[] = [
  { label: 'HOME', to: '/home' },
  { label: 'DISCOVER', to: '/search' },
  { label: 'NEWS', to: '/news' },
  { label: 'LISTS', to: '/lists' },
  // A sixth item, which docs/friends-plan.md §6 argued against for friends —
  // the argument there was that a feature with no page of its own doesn't earn
  // a nav slot, and this one is a page. It also absorbs the ROADMAP's Library
  // item, so it is the entry point for "my whole collection" (ADR-0007).
  { label: 'HISTORY', to: '/history' },
  { label: 'PROFILE', to: '/profile' },
];

export interface AppNavUser {
  /** Display name (better-auth `name`). */
  name: string;
  /** Unique @handle (better-auth `displayUsername`). */
  username: string;
  /** Uploaded avatar URL (better-auth `image`). */
  image?: string | null;
}

/** Sticky authenticated-app navigation: wordmark, section links, search, account menu. */
export function AppNav({ user }: { user: AppNavUser }) {
  const items: NavItem[] = NAV_ITEMS;
  // No dedicated friends surface yet — a badge on PROFILE covers discoverability
  // instead of a sixth top-level nav item (docs/friends-plan.md §6).
  const { data: friendsOverview } = useFriends();
  const incomingCount = friendsOverview?.incoming.length ?? 0;
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
              className="flex items-center gap-1.5 text-dim hover:text-fg"
              activeProps={{ className: 'border-b-2 border-pink pb-0.5 text-fg' }}
            >
              {item.label}
              {item.label === 'PROFILE' && incomingCount > 0 && (
                <span className="rounded-full bg-pink px-1.5 py-0.5 text-[10px] font-bold text-on-prism">
                  {incomingCount}
                </span>
              )}
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
