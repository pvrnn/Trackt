import { Link } from '@tanstack/react-router';
import { useReducedMotion } from 'motion/react';
import clsx from 'clsx';
import { ArrowLeft, ArrowUpRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { MEDIA_KINDS } from '@trackt/shared';
import { CoverWallColumns } from '../marketing/CoverWall';
import { kindDotClass } from '../ui/KindDot';
import { Wordmark } from '../layout/Wordmark';
import { useLabels } from '../../lib/labels';
import { LoginForm } from './LoginForm';
import { RegisterForm } from './RegisterForm';
import { VerifyEmailForm } from './VerifyEmailForm';

export type AuthMode = 'login' | 'register' | 'verify';

/**
 * Everything that moves between modes shares one curve and length, so the
 * heading, underline, forms and pitch travel together. Ease-in-out: a slide
 * that starts gently reads smoother than one that lurches off the mark.
 */
const MOVE = '600ms cubic-bezier(0.65, 0, 0.35, 1)';

/**
 * Staggered crossfade: the outgoing side clears quickly, the incoming one
 * fades in a beat later, so the two never overlap as ghosts mid-slide.
 * `translate` is named on its own: Tailwind v4's translate utilities set that
 * property, not `transform`.
 */
function swapTransition(active: boolean, reduced: boolean): string {
  if (reduced) return 'none';
  const fade = active ? 'opacity 380ms ease-out 180ms' : 'opacity 200ms ease-in';
  return `${fade}, translate ${MOVE}, scale ${MOVE}`;
}

/**
 * Split-screen shell for /login, /register and /verify-email (docs/design/Login.dc.html): the
 * form alone on the left, what is waiting on the other side on the right.
 *
 * Both forms are always mounted, side by side in a track that slides: sign-in
 * sits left of sign-up, so going to CREATE ACCOUNT moves everything left and
 * back moves it right. Each form keeps what was typed into it across switches.
 */
export function AuthLayout({
  mode,
  redirect,
  email,
  code,
}: {
  mode: AuthMode;
  redirect?: string | undefined;
  email?: string | undefined;
  code?: string | undefined;
}) {
  const { t } = useTranslation();
  return (
    <div data-auth-root className="grid min-h-screen bg-ink text-fg lg:grid-cols-2">
      <div className="relative flex min-w-0 flex-col overflow-x-clip px-6 pt-7 pb-8 sm:px-16">
        <div
          aria-hidden
          className="absolute inset-0 bg-[radial-gradient(520px_380px_at_0%_0%,rgb(139_92_246/0.28),transparent_70%),radial-gradient(520px_420px_at_20%_110%,rgb(217_164_65/0.22),transparent_70%)]"
        />
        <div aria-hidden className="grain absolute inset-0" />

        <div className="relative flex items-center justify-between gap-4">
          <Link to="/" aria-label={t('auth.homeAria')}>
            <Wordmark className="text-[26px]" />
          </Link>
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 font-label text-xs font-bold tracking-[0.08em] text-muted transition hover:text-pink"
          >
            <ArrowLeft aria-hidden className="size-3.5" strokeWidth={2.6} />
            {t('auth.backToSite')}
          </Link>
        </div>

        {/* Top-anchored, not centred: the two forms differ in height and the tabs must not move. */}
        <main className="relative mx-auto flex w-full max-w-[420px] flex-1 flex-col gap-6.5 pt-[clamp(3rem,13vh,9rem)] pb-12">
          {mode === 'verify' ? (
            <>
              <h1 className="m-0 font-display text-[56px] leading-[0.95] font-normal uppercase">
                {t('auth.verify.title')}
              </h1>
              <VerifyEmailForm email={email} code={code} redirect={redirect} />
            </>
          ) : (
            <>
              <h1 className="m-0 grid font-display text-[56px] leading-[0.95] font-normal uppercase">
                <Swap active={mode === 'login'} side="left">
                  {t('auth.login.title')}
                </Swap>
                <Swap active={mode === 'register'} side="right">
                  {t('auth.register.title')}
                </Swap>
              </h1>
              <ModeTabs mode={mode} />
              <FormTrack mode={mode} redirect={redirect} />
            </>
          )}
        </main>

        <div className="relative flex flex-wrap gap-x-5 gap-y-2 font-label text-[11px] font-semibold tracking-[0.08em] text-dim">
          <a
            href="https://github.com/pvrnn/Trackt"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-muted transition hover:text-pink"
          >
            {t('auth.github')}
            <ArrowUpRight aria-hidden className="size-3.5" strokeWidth={2.6} />
          </a>
          <span>{t('auth.tvTimeSoon')}</span>
        </div>
      </div>

      <AuthBackdrop mode={mode === 'verify' ? 'register' : mode} />
    </div>
  );
}

/**
 * One of two texts stacked in the same grid cell. The inactive one waits off to
 * its own side, so a switch slides one out and the other in, in the direction
 * the forms travel. Only the active one is read out.
 */
function Swap({
  active,
  side,
  children,
}: {
  active: boolean;
  side: 'left' | 'right';
  children: ReactNode;
}) {
  const reduced = useReducedMotion() ?? false;
  return (
    <span
      aria-hidden={!active}
      style={{ transition: swapTransition(active, reduced) }}
      className={clsx(
        'will-change-[opacity,translate] [grid-area:1/1]',
        active
          ? 'translate-x-0 opacity-100'
          : clsx(
              'pointer-events-none opacity-0',
              side === 'left' ? '-translate-x-6' : 'translate-x-6',
            ),
      )}
    >
      {children}
    </span>
  );
}

/** Both forms in a two-panel track; the inactive panel is `inert`, so Tab never lands in it. */
function FormTrack({ mode, redirect }: { mode: AuthMode; redirect?: string }) {
  const reduced = useReducedMotion() ?? false;
  const panel = (active: boolean) => ({
    className: clsx(
      'flex min-w-0 flex-col gap-6.5 px-2 py-1',
      active ? 'opacity-100' : 'opacity-0',
    ),
    style: { transition: swapTransition(active, reduced) },
    inert: !active,
  });
  return (
    // The negative margin gives focus rings room inside the clip.
    <div className="-mx-2 -my-1 overflow-hidden">
      <div
        style={{ transition: reduced ? 'none' : `translate ${MOVE}` }}
        className={clsx(
          'grid w-[200%] grid-cols-2 items-start will-change-[translate]',
          mode === 'register' && '-translate-x-1/2',
        )}
      >
        <div {...panel(mode === 'login')}>
          <LoginForm redirect={redirect} />
        </div>
        <div {...panel(mode === 'register')}>
          <RegisterForm />
        </div>
      </div>
    </div>
  );
}

/**
 * SIGN IN / CREATE ACCOUNT as underline tabs; each is a link to its route. The
 * underline glides between them: the outgoing one shrinks toward the incoming
 * tab while the incoming one grows from that side.
 */
function ModeTabs({ mode }: { mode: AuthMode }) {
  const { t } = useTranslation();
  const reduced = useReducedMotion() ?? false;
  const tabs = [
    { mode: 'login', to: '/login', label: t('auth.submit'), origin: 'origin-right' },
    { mode: 'register', to: '/register', label: t('auth.createAccount'), origin: 'origin-left' },
  ] as const;
  return (
    <nav aria-label={t('auth.modesAria')} className="flex border-b border-white/12">
      {tabs.map((tab) => {
        const active = tab.mode === mode;
        return (
          <Link
            key={tab.mode}
            to={tab.to}
            aria-current={active ? 'page' : undefined}
            className={clsx(
              'relative mr-5 py-3.25 pr-4 font-label text-xs font-bold tracking-[0.08em] transition-colors duration-500 hover:text-fg',
              active ? 'text-fg' : 'text-muted',
            )}
          >
            {tab.label}
            <span
              aria-hidden
              style={{ transition: reduced ? 'none' : `scale ${MOVE}` }}
              className={clsx(
                'absolute right-4 -bottom-px left-0 h-0.5 rounded-full bg-prism',
                tab.origin,
                active ? 'scale-x-100' : 'scale-x-0',
              )}
            />
          </Link>
        );
      })}
    </nav>
  );
}

/** The instance's covers drifting past under a scrim, and a pitch on top. Decoration only. */
function AuthBackdrop({ mode }: { mode: Exclude<AuthMode, 'verify'> }) {
  const { t } = useTranslation();
  const labels = useLabels();
  return (
    <div
      aria-hidden
      className="relative hidden min-h-[420px] overflow-hidden border-l border-divider bg-[#0b090d] lg:block"
    >
      <CoverWallColumns columns={4} className="absolute -inset-x-15 -inset-y-40" />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgb(11_9_13/0.55)_0%,rgb(11_9_13/0.15)_30%,rgb(11_9_13/0.6)_46%,rgb(11_9_13/0.94)_68%,#0b090d_100%)]" />
      <div className="absolute inset-x-14 bottom-14 flex flex-col gap-4.5">
        <p className="m-0 grid items-end font-display text-[clamp(2.75rem,5vw,4.5rem)] leading-[0.94] uppercase">
          <Swap active={mode === 'login'} side="left">
            {t('auth.login.pitchTop')}
            <br />
            <span className="text-prism">{t('auth.login.pitchBottom')}</span>
          </Swap>
          <Swap active={mode === 'register'} side="right">
            {t('auth.register.pitchTop')}
            <br />
            <span className="text-prism">{t('auth.register.pitchBottom')}</span>
          </Swap>
        </p>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {MEDIA_KINDS.map((kind) => (
            <span key={kind} className="flex items-center gap-1.75">
              <span className={clsx('size-1.75 rounded-full', kindDotClass[kind])} />
              <span className="font-label text-xs font-bold tracking-[0.12em] text-[#cfc9d8]">
                {labels.kind(kind)}
              </span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
