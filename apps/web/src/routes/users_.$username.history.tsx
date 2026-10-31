import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { AppNav } from '../components/layout/AppNav';
import { AuraBackground } from '../components/layout/AuraBackground';
import { MarketingNav } from '../components/layout/MarketingNav';
import { HistoryView } from '../components/history/HistoryView';
import { NoSuchUser } from '../components/profile/NoSuchUser';
import { useOptionalSession } from '../lib/auth-client';
import { validateHistorySearch } from '../lib/history-search';
import { usePublicProfile } from '@trackt/client';

/**
 * Someone else's history. `users_.` opts this route out of nesting under
 * `/users/$username`, which has no `<Outlet />` — as a child, this page would
 * never render (the same trap `news_.$slug.tsx` documents).
 *
 * Anonymous-readable, like the profile it hangs off (ADR-0006 point 3): the
 * profile query also decides between "no such user" and "their history".
 */
export const Route = createFileRoute('/users_/$username/history')({
  head: ({ params, match }) => ({
    meta: [
      {
        title: match.context.i18n.t('meta.userHistory', { username: params.username }),
      },
    ],
  }),
  validateSearch: validateHistorySearch,
  component: PublicHistoryPage,
});

function PublicHistoryPage() {
  const { t } = useTranslation();
  const { username } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { isPending: sessionPending, navUser } = useOptionalSession();
  const { data: profile, isPending, isError } = usePublicProfile(username);

  if (sessionPending) return <div className="min-h-screen bg-ink" />;

  return (
    <div className="min-h-screen bg-ink text-fg">
      <AuraBackground variant="app" />
      <div className="relative">
        {navUser ? <AppNav user={navUser} /> : <MarketingNav />}
        {isError ? (
          <main className="mx-auto max-w-[1360px] px-10 pt-12">
            <p role="alert" className="text-[15px] text-red-400">
              {t('profile.public.loadError')}
            </p>
          </main>
        ) : isPending ? (
          <main className="h-40" aria-busy />
        ) : !profile ? (
          <NoSuchUser username={username} />
        ) : (
          <HistoryView
            username={profile.user.username}
            search={search}
            setSearch={(patch) => navigate({ search: (previous) => ({ ...previous, ...patch }) })}
          />
        )}
      </div>
    </div>
  );
}
