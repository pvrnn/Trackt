import { Link, type LinkProps } from '@tanstack/react-router';
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

/** Sticky authenticated-app navigation: wordmark, section links, session avatar. */
export function AppNav({ userName }: { userName: string }) {
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
      <Avatar name={userName} size={32} className="size-9" />
    </nav>
  );
}
