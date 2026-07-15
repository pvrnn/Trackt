import { createFileRoute, Link, Navigate, useNavigate } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { AuthDivider, AuthLayout } from '../components/layout/AuthLayout';
import { Button, buttonClassName } from '../components/ui/Button';
import { GlassCard } from '../components/ui/GlassCard';
import { Input } from '../components/ui/Input';
import { authClient } from '../lib/auth-client';

/** Only same-app paths survive as a post-login destination — never other origins. */
function safeRedirect(value: unknown): string | undefined {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//')
    ? value
    : undefined;
}

export const Route = createFileRoute('/login')({
  head: () => ({ meta: [{ title: 'Sign in — Trackt' }] }),
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({
    redirect: safeRedirect(search.redirect),
  }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const { redirect } = Route.useSearch();
  const { data: session } = authClient.useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // The guard put the interrupted destination in ?redirect — honour it here
  // (`href`, when set, takes precedence over `to` in the router).
  if (session) return <Navigate to="/home" href={redirect} />;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setFormError(null);
    const { error } = await authClient.signIn.email({ email, password });
    setSubmitting(false);
    if (error) {
      setFormError(error.message ?? 'Sign in failed');
      return;
    }
    if (redirect) navigate({ href: redirect });
    else navigate({ to: '/home' });
  }

  return (
    <AuthLayout>
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-[44px] leading-none uppercase">Welcome back</h1>
        <p className="text-[15px] text-muted">Track everything. Lose nothing.</p>
      </div>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3.5" noValidate>
        <Input
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <Input
          label="Password"
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
          {submitting ? 'SIGNING IN…' : 'SIGN IN'}
        </Button>
      </form>
      <AuthDivider label="New here" />
      <div className="flex flex-col gap-3">
        <Link
          to="/register"
          className={buttonClassName({ variant: 'secondary', className: 'w-full' })}
        >
          CREATE ACCOUNT
        </Link>
        <TvTimeCard />
      </div>
    </AuthLayout>
  );
}

/**
 * TV Time migration promo (PRD §3.6 — the importer is launch-critical).
 * The importer hasn't shipped yet, so the CTA is visibly inert — not a fake link.
 */
export function TvTimeCard() {
  return (
    <GlassCard className="flex items-center gap-4 px-5 py-4">
      <span className="text-prism font-display text-xl">TV</span>
      <div className="flex-1">
        <p className="text-sm font-bold">Coming from TV Time?</p>
        <p className="text-[13px] text-muted">
          Bring your GDPR export — 1,000 episodes import in under a minute.
        </p>
      </div>
      <span
        title="The TV Time importer is coming soon"
        className="cursor-not-allowed text-[13px] font-bold text-pink/50"
      >
        IMPORT · SOON
      </span>
    </GlassCard>
  );
}
