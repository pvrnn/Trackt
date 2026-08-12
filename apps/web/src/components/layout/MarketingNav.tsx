import { Link } from '@tanstack/react-router';
import { m } from 'motion/react';
import { buttonClassName } from '../ui/Button';
import { Wordmark } from './Wordmark';

const MotionLink = m.create(Link);

/**
 * `routed` links go through the router; the rest are real page loads — `/docs`
 * is the API's own Scalar page (proxied in dev, see vite.config.ts), and GitHub
 * is off-site.
 *
 * SELF-HOST is `/#pillars`, not a bare `#pillars`: this nav also renders on
 * `/news` and `/users/$username` when signed out, where a bare fragment names
 * an element that isn't on the page and the link does nothing.
 */
const links = [
  // News is public (ADR-0005), so signed-out visitors get a real link, not a teaser.
  { label: 'NEWS', href: '/news', routed: true },
  { label: 'SELF-HOST', href: '/#pillars', routed: false },
  { label: 'API', href: '/docs', routed: false },
  { label: 'GITHUB', href: 'https://github.com/pvrnn/Trackt', routed: false },
] as const;

/** Landing navigation: wordmark, dim links, gradient SIGN IN pill. */
export function MarketingNav() {
  return (
    <nav className="flex flex-wrap items-center gap-x-8 gap-y-3 border-b border-divider px-6 py-5 sm:px-10">
      <Link to="/">
        <Wordmark className="text-[26px]" />
      </Link>
      <span className="flex-1" />
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm font-semibold tracking-btn">
        {links.map((link) => {
          const className = 'whitespace-nowrap text-dim transition hover:text-pink';
          return link.routed ? (
            <Link key={link.label} to={link.href} className={className}>
              {link.label}
            </Link>
          ) : (
            <a key={link.label} href={link.href} className={className}>
              {link.label}
            </a>
          );
        })}
        <MotionLink
          to="/login"
          whileTap={{ scale: 0.97 }}
          className={buttonClassName({ className: 'px-5.5 py-2.5 whitespace-nowrap' })}
        >
          SIGN IN
        </MotionLink>
      </div>
    </nav>
  );
}
