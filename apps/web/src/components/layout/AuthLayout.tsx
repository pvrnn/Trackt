import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Wordmark } from './Wordmark';

/**
 * Split-screen shell for /login and /register (docs/design/Login.dc.html):
 * aura manifesto panel on the left, form column on the right.
 */
export function AuthLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="grid min-h-screen bg-ink text-fg lg:grid-cols-2">
      <div className="relative hidden overflow-hidden border-r border-divider lg:flex lg:flex-col">
        <div className="aura-auth absolute inset-0" />
        <div className="grain absolute inset-0 opacity-55" aria-hidden />
        <div className="relative flex flex-1 flex-col justify-end p-14">
          <h2 className="font-heading text-[64px] leading-[0.95] uppercase">
            {t('auth.manifesto.line1')}
            <br />
            {t('auth.manifesto.line2')}
            <br />
            <span className="text-prism">{t('auth.manifesto.line3')}</span>
          </h2>
          <p className="mt-4 max-w-[400px] text-[15px] text-muted">{t('auth.manifesto.body')}</p>
        </div>
      </div>
      <div className="flex flex-col justify-center gap-7 p-10 lg:max-w-[560px] lg:p-20">
        <Link to="/" aria-label={t('auth.homeAria')}>
          <Wordmark className="text-[30px]" />
        </Link>
        {children}
      </div>
    </div>
  );
}

/** "NEW HERE" / "ALREADY A MEMBER" hairline divider between form and cross-link. */
export function AuthDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3.5 font-label text-xs text-faint uppercase">
      <div className="h-px flex-1 bg-divider" />
      {label}
      <div className="h-px flex-1 bg-divider" />
    </div>
  );
}
