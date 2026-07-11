import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { AuraBackground } from '../components/layout/AuraBackground';
import { Wordmark } from '../components/layout/Wordmark';
import { Avatar } from '../components/ui/Avatar';
import { Button, buttonClassName } from '../components/ui/Button';
import { GlassCard } from '../components/ui/GlassCard';
import { authClient } from '../lib/auth-client';

export const Route = createFileRoute('/home')({
  head: () => ({ meta: [{ title: 'Home — Trackt' }] }),
  component: HomePage,
});

/**
 * Stub authenticated home — the destination for login/register while the real
 * tracking UI doesn't exist yet. Client-side session guard: a `beforeLoad` guard
 * would run on the SSR server where the session cookie isn't forwarded; revisit
 * with a createServerFn when real app pages land.
 */
function HomePage() {
  const navigate = useNavigate();
  const { data: session, isPending } = authClient.useSession();

  useEffect(() => {
    if (!isPending && !session) navigate({ to: '/login' });
  }, [isPending, session, navigate]);

  if (isPending || !session) return <div className="min-h-screen bg-ink" />;

  const displayName = session.user.displayUsername ?? session.user.name;

  return (
    <div className="min-h-screen bg-ink text-fg">
      <AuraBackground variant="app" />
      <main className="relative mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center gap-8 p-10">
        <Wordmark className="text-[30px]" />
        <GlassCard className="flex w-full flex-col items-center gap-5 p-10 text-center">
          <Avatar name={displayName} size={120} />
          <div className="flex flex-col gap-2">
            <h1 className="font-display text-[36px] leading-none uppercase">
              Welcome, {displayName}
            </h1>
            <p className="text-[15px] text-muted">
              Your tracker is ready. Check-ins and stats land here next.
            </p>
          </div>
          <Link to="/search" className={buttonClassName({ className: 'w-full' })}>
            DISCOVER
          </Link>
          <Button
            variant="secondary"
            onClick={() =>
              authClient.signOut({
                fetchOptions: { onSuccess: () => navigate({ to: '/login' }) },
              })
            }
          >
            SIGN OUT
          </Button>
        </GlassCard>
      </main>
    </div>
  );
}
