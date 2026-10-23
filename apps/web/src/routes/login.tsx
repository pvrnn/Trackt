import { createFileRoute, Link, Navigate, useNavigate } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { AuthDivider, AuthLayout } from '../components/layout/AuthLayout';
import { Button, buttonClassName } from '../components/ui/Button';
import { GlassCard } from '../components/ui/GlassCard';
import { Input } from '../components/ui/Input';
import { Tooltip } from '../components/ui/Tooltip';
import { authClient } from '../lib/auth-client';
import { authErrorKey } from '../lib/auth-errors';
import { safeRedirect } from '@trackt/client';

export const Route = createFileRoute('/login')({
  head: ({ match }) => ({ meta: [{ title: match.context.i18n.t('meta.login') }] }),
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({
    redirect: safeRedirect(search.redirect),
  }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { redirect } = Route.useSearch();
  const { data: session } = authClient.useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // The guard put the interrupted destination in ?redirect; honour it here
  // (`href`, when set, takes precedence over `to` in the router).
  if (session) return <Navigate to="/home" href={redirect} />;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setFormError(null);
    const { error } = await authClient.signIn.email({ email, password });
    setSubmitting(false);
    if (error) {
      setFormError(t(authErrorKey(error, 'errors.signInFailed')));
      return;
    }
    if (redirect) navigate({ href: redirect });
    else navigate({ to: '/home' });
  }

  return (
    <AuthLayout>
      <div className="flex flex-col gap-2">
        <h1 className="font-heading text-[44px] leading-none uppercase">{t('auth.login.title')}</h1>
        <p className="text-[15px] text-muted">{t('auth.login.subtitle')}</p>
      </div>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3.5" noValidate>
        <Input
          label={t('auth.fields.email')}
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <Input
          label={t('auth.fields.password')}
          name="password"
          type="password"
          autoComplete="current-password"
          placeholder="••••••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {formError && (
          <p role="alert" className="text-sm text-red-400">
            {formError}
          </p>
        )}
        <Button type="submit" className="w-full text-sm" disabled={submitting}>
          {submitting ? t('auth.submitting') : t('auth.submit')}
        </Button>
      </form>
      <AuthDivider label={t('auth.newHere')} />
      <div className="flex flex-col gap-3">
        <Link
          to="/register"
          className={buttonClassName({ variant: 'secondary', className: 'w-full' })}
        >
          {t('auth.createAccount')}
        </Link>
        <TvTimeCard />
      </div>
    </AuthLayout>
  );
}

/**
 * TV Time migration promo (PRD §3.6; the importer is launch-critical).
 * The importer hasn't shipped yet, so the CTA is visibly inert, not a fake link.
 */
export function TvTimeCard() {
  const { t } = useTranslation();
  return (
    <GlassCard className="flex items-center gap-4 px-5 py-4">
      <span className="text-prism font-display text-xl">TV</span>
      <div className="flex-1">
        <p className="text-sm font-bold">{t('auth.tvTime.title')}</p>
        <p className="text-[13px] text-muted">{t('auth.tvTime.body')}</p>
      </div>
      <Tooltip label={t('auth.tvTime.tooltip')}>
        <span tabIndex={0} className="cursor-not-allowed text-[13px] font-bold text-pink/50">
          {t('auth.tvTime.cta')}
        </span>
      </Tooltip>
    </GlassCard>
  );
}
