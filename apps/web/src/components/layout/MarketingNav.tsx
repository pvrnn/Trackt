import { Link } from '@tanstack/react-router';
import { m } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { buttonClassName } from '../ui/Button';
import { LocaleMenu } from './LocaleMenu';
import { Wordmark } from './Wordmark';

const MotionLink = m.create(Link);

/**
 * `routed` links go through the router; the rest are real page loads: `/docs`
 * is the API's own Scalar page (proxied in dev, see vite.config.ts), and GitHub
 * is off-site.
 *
 * SELF-HOST is `/#pillars`, not a bare `#pillars`: this nav also renders on
 * `/news` and `/users/$username` when signed out, where a bare fragment names
 * an element that isn't on the page and the link does nothing.
 */
const links = [
  // News is public (ADR-0005), so signed-out visitors get a real link, not a teaser.
  { key: 'nav.news', href: '/news', routed: true },
  { key: 'nav.selfHost', href: '/#pillars', routed: false },
  { key: 'nav.api', href: '/docs', routed: false },
  { key: 'nav.github', href: 'https://github.com/pvrnn/Trackt', routed: false },
] as const;

/** Landing navigation: wordmark, dim links, gradient SIGN IN pill. */
export function MarketingNav() {
  const { t } = useTranslation();
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
            <Link key={link.key} to={link.href} className={className}>
              {t(link.key)}
            </Link>
          ) : (
            <a key={link.key} href={link.href} className={className}>
              {t(link.key)}
            </a>
          );
        })}
        <LocaleMenu />
        <MotionLink
          to="/login"
          whileTap={{ scale: 0.97 }}
          className={buttonClassName({ className: 'px-5.5 py-2.5 whitespace-nowrap' })}
        >
          {t('nav.signIn')}
        </MotionLink>
      </div>
    </nav>
  );
}
