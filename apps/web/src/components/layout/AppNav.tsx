import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Link, useNavigate, useRouterState, type LinkProps } from '@tanstack/react-router';
import clsx from 'clsx';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { authClient } from '../../lib/auth-client';
import { useFriends, useFlag } from '@trackt/client';
import { Avatar } from '../ui/Avatar';
import { Tooltip } from '../ui/Tooltip';
import { LocaleMenu } from './LocaleMenu';
import { NavSearch } from './NavSearch';
import { Wordmark } from './Wordmark';

interface NavItem {
  key:
    | 'nav.home'
    | 'nav.discover'
    | 'nav.news'
    | 'nav.lists'
    | 'nav.history'
    | 'nav.trophies'
    | 'nav.profile';
  /** Undefined = the page doesn't exist yet; rendered as an inert placeholder. */
  link?: Pick<LinkProps, 'to' | 'params' | 'activeOptions'>;
}

/**
 * Order from the app mockups (Home/Search/Lists/Profile navs). The mockups
 * label the fourth item ACTIVITY, but it goes to your profile, a page that is
 * a profile (identity, favourites, badges, visibility) with activity as one
 * section. Reading it as "the activity feed" sends people to the avatar menu
 * to look for their profile, so it says PROFILE here. ACTIVITY becomes its
 * own item pointing at the real feed when that ships (ROADMAP, v1.x).
 */
const navItems = (username: string): NavItem[] => [
  { key: 'nav.home', link: { to: '/home' } },
  { key: 'nav.discover', link: { to: '/search' } },
  { key: 'nav.news', link: { to: '/news' } },
  { key: 'nav.lists', link: { to: '/lists' } },
  // A sixth item, which docs/friends-plan.md §6 argued against for friends.
  // The argument there was that a feature with no page of its own doesn't earn
  // a nav slot, and this one is a page. It also absorbs the ROADMAP's Library
  // item, so it is the entry point for "my whole collection" (ADR-0007).
  { key: 'nav.history', link: { to: '/users/$username/history', params: { username } } },
  { key: 'nav.trophies', link: { to: '/trophies' } },
  // Exact, or PROFILE would light up beside HISTORY on `/users/$username/history`.
  {
    key: 'nav.profile',
    link: { to: '/users/$username', params: { username }, activeOptions: { exact: true } },
  },
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
  const { t } = useTranslation();
  const listsOn = useFlag('lists.custom');
  // A half-rolled-out instance must not offer a destination that answers
  // "unavailable": a user below the bucket simply doesn't see LISTS.
  const items = navItems(user.username).filter((item) => item.key !== 'nav.lists' || listsOn);
  // No dedicated friends surface yet, so a badge on PROFILE covers discoverability
  // instead of a sixth top-level nav item (docs/friends-plan.md §6).
  const { data: friendsOverview } = useFriends();
  const incomingCount = friendsOverview?.incoming.length ?? 0;
  const stripRef = useRef<HTMLDivElement>(null);
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  // Below `lg` the links are a sideways-scrolling strip; bring the current
  // section into view so a deep tab (TROPHIES, PROFILE) isn't left off-screen.
  // scrollLeft rather than scrollIntoView, which would also scroll the page.
  useEffect(() => {
    const strip = stripRef.current;
    const active = strip?.querySelector<HTMLElement>('[data-status="active"]');
    if (!strip || !active || strip.scrollWidth <= strip.clientWidth) return;
    strip.scrollLeft = active.offsetLeft - (strip.clientWidth - active.offsetWidth) / 2;
  }, [pathname]);
  return (
    <nav className="sticky top-0 z-10 flex flex-wrap items-center gap-x-3 border-b border-divider bg-ink/75 px-4 pt-2.5 backdrop-blur-[16px] sm:px-10 lg:flex-nowrap lg:gap-6 lg:py-5 xl:gap-8">
      <Link to="/home" className="py-1">
        <Wordmark className="text-[26px]" />
      </Link>
      <div
        ref={stripRef}
        className="order-last -mx-4 scrollbar-none flex basis-[calc(100%+2rem)] gap-6 overflow-x-auto px-4 text-sm font-semibold tracking-btn sm:-mx-10 sm:basis-[calc(100%+5rem)] sm:px-10 lg:order-none lg:mx-0 lg:basis-auto lg:gap-5 lg:overflow-visible lg:px-0 xl:gap-6"
      >
        {items.map((item) =>
          item.link ? (
            <Link
              key={item.key}
              {...item.link}
              className="flex min-h-11 shrink-0 items-center gap-1.5 border-b-2 border-transparent whitespace-nowrap text-dim hover:text-fg data-[status=active]:border-pink data-[status=active]:text-fg lg:min-h-0 lg:pb-0.5"
            >
              {t(item.key)}
              {item.key === 'nav.profile' && incomingCount > 0 && (
                <span className="rounded-full bg-pink px-1.5 py-0.5 text-[10px] font-bold text-on-prism">
                  {incomingCount}
                </span>
              )}
            </Link>
          ) : (
            <Tooltip key={item.key} label={t('shell.comingSoon')}>
              <span tabIndex={0} className="cursor-not-allowed text-dim/60">
                {t(item.key)}
              </span>
            </Tooltip>
          ),
        )}
      </div>
      <div className="flex-1" />
      <NavSearch />
      <LocaleMenu />
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
 * keyboard contract the hand-rolled version lacked: focus moves into the menu
 * on open, ↑/↓ and typeahead move between items, and focus returns to the
 * avatar on close.
 */
function AccountMenu({ user }: { user: AppNavUser }) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label={t('shell.accountMenu')}
        className="-m-1 block cursor-pointer rounded-full p-1 transition outline-none hover:brightness-115"
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
            <Link to="/users/$username" params={{ username: user.username }}>
              {t('shell.profile')}
            </Link>
          </DropdownMenu.Item>
          <DropdownMenu.Item
            onSelect={() =>
              authClient.signOut({
                fetchOptions: { onSuccess: () => navigate({ to: '/login' }) },
              })
            }
            className={clsx(MENU_ITEM, 'border-t border-divider')}
          >
            {t('shell.signOut')}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
