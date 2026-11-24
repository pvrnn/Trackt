import { Link } from '@tanstack/react-router';
import { m } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { ArrowUpRight } from 'lucide-react';
import { buttonClassName } from '../ui/Button';
import { LocaleMenu } from './LocaleMenu';
import { Wordmark } from './Wordmark';

const MotionLink = m.create(Link);

/**
 * `routed` links go through the router; the rest are real page loads: `/docs`
 * is the API's own Scalar page (proxied in dev, see vite.config.ts), and GitHub
 * is off-site.
 */
const links = [
  // News is public (ADR-0005), so signed-out visitors get a real link, not a teaser.
  { key: 'nav.news', href: '/news', routed: true, external: false },
  { key: 'nav.api', href: '/docs', routed: false, external: false },
  { key: 'nav.github', href: 'https://github.com/pvrnn/Trackt', routed: false, external: true },
] as const;

/** Landing navigation: wordmark, dim links, glass SIGN IN pill. */
export function MarketingNav() {
  const { t } = useTranslation();
  return (
    <nav
      aria-label="Main"
      className="sticky top-0 z-20 flex flex-wrap items-center gap-x-7 gap-y-3 border-b border-divider bg-ink/72 px-5 py-4.5 backdrop-blur-[16px] sm:px-10"
    >
      <Link to="/">
        <Wordmark className="text-[26px]" />
      </Link>
      <span className="flex-1" />
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm font-semibold tracking-btn">
        {links.map((link) => {
          const className =
            'inline-flex items-center gap-1 whitespace-nowrap text-muted transition hover:text-pink';
          return link.routed ? (
            <Link key={link.key} to={link.href} className={className}>
              {t(link.key)}
            </Link>
          ) : (
            <a
              key={link.key}
              href={link.href}
              className={className}
              {...(link.external && { target: '_blank', rel: 'noopener noreferrer' })}
            >
              {t(link.key)}
              {link.external && <ArrowUpRight aria-hidden className="size-3.5" strokeWidth={2.6} />}
            </a>
          );
        })}
        <LocaleMenu />
        <MotionLink
          to="/login"
          whileTap={{ scale: 0.97 }}
          className={buttonClassName({
            variant: 'secondary',
            className: 'px-5.5 py-2.5 whitespace-nowrap',
          })}
        >
          {t('nav.signIn')}
        </MotionLink>
      </div>
    </nav>
  );
}
