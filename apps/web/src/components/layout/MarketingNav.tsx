import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Link } from '@tanstack/react-router';
import { m } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { ArrowUpRight, Menu } from 'lucide-react';
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
      className="sticky top-0 z-20 flex items-center gap-x-2 border-b border-divider bg-ink/72 px-4 py-3 backdrop-blur-[16px] sm:flex-wrap sm:gap-x-7 sm:gap-y-3 sm:px-10 sm:py-4.5"
    >
      <Link to="/">
        <Wordmark className="text-[26px]" />
      </Link>
      <span className="flex-1" />
      <div className="flex items-center gap-x-2 text-sm font-semibold tracking-btn sm:flex-wrap sm:gap-x-6 sm:gap-y-3">
        {links.map((link) => {
          const className =
            'hidden items-center gap-1 whitespace-nowrap text-muted transition hover:text-pink sm:inline-flex';
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
        <LinksMenu />
        <LocaleMenu />
        <MotionLink
          to="/login"
          whileTap={{ scale: 0.97 }}
          className={buttonClassName({
            variant: 'secondary',
            className: 'px-4 py-2.5 whitespace-nowrap sm:px-5.5',
          })}
        >
          {t('nav.signIn')}
        </MotionLink>
      </div>
    </nav>
  );
}

const MENU_ITEM =
  'flex w-full cursor-pointer items-center gap-1 px-4 py-3 text-left text-sm font-semibold tracking-btn text-fg outline-none transition ' +
  'data-[highlighted]:bg-pink-row data-[highlighted]:text-pink';

/** Below `sm` the links don't fit on the one row the sticky bar can afford. */
function LinksMenu() {
  const { t } = useTranslation();
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label={t('nav.menu')}
        className="inline-flex size-11 cursor-pointer items-center justify-center rounded-lg text-muted transition outline-none hover:bg-white/8 hover:text-fg focus-visible:bg-white/8 data-[state=open]:bg-white/8 data-[state=open]:text-fg sm:hidden"
      >
        <Menu aria-hidden className="size-5" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          className="z-30 w-48 overflow-hidden rounded-card-sm border border-glass-border-strong bg-ink/90 py-1 shadow-xl backdrop-blur-[16px]"
        >
          {links.map((link) => (
            <DropdownMenu.Item key={link.key} asChild className={MENU_ITEM}>
              {link.routed ? (
                <Link to={link.href}>{t(link.key)}</Link>
              ) : (
                <a
                  href={link.href}
                  {...(link.external && { target: '_blank', rel: 'noopener noreferrer' })}
                >
                  {t(link.key)}
                  {link.external && (
                    <ArrowUpRight aria-hidden className="size-3.5" strokeWidth={2.6} />
                  )}
                </a>
              )}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
