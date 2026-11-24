import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { AppNav } from '../components/layout/AppNav';
import { AuraBackground } from '../components/layout/AuraBackground';
import { MarketingNav } from '../components/layout/MarketingNav';
import { HistoryView, type HistoryViewProps } from '../components/history/HistoryView';
import { NoSuchUser } from '../components/profile/NoSuchUser';
import { isViewer, useOptionalSession } from '../lib/auth-client';
import { validateHistorySearch, type HistorySearchParams } from '../lib/history-search';
import { usePublicProfile } from '@trackt/client';

/**
 * Anyone's history, the viewer's included. `users_.` opts this route out of
 * nesting under `/users/$username`, which has no `<Outlet />` — as a child,
 * this page would never render (the same trap `news_.$slug.tsx` documents).
 *
 * Anonymous-readable, like the profile it hangs off (ADR-0006 point 3). The
 * viewer's own handle reads `/me/history`; anyone else's goes through the
 * profile query, which also decides between "no such user" and "their history".
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
  component: HistoryPage,
});

function HistoryPage() {
  const { username } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { isPending, session, navUser } = useOptionalSession();
  const setSearch = (patch: Partial<HistorySearchParams>) =>
    navigate({ search: (previous) => ({ ...previous, ...patch }) });

  if (isPending) return <div className="min-h-screen bg-ink" />;

  return (
    <div className="min-h-screen bg-ink text-fg">
      <AuraBackground variant="app" />
      <div className="relative">
        {navUser ? <AppNav user={navUser} /> : <MarketingNav />}
        {isViewer(session, username) ? (
          <HistoryView search={search} setSearch={setSearch} />
        ) : (
          <PublicHistory username={username} search={search} setSearch={setSearch} />
        )}
      </div>
    </div>
  );
}

function PublicHistory({ username, search, setSearch }: HistoryViewProps & { username: string }) {
  const { t } = useTranslation();
  const { data: profile, isPending, isError } = usePublicProfile(username);

  return isError ? (
    <main className="mx-auto max-w-[1360px] px-4 pt-12 sm:px-10">
      <p role="alert" className="text-[15px] text-red-400">
        {t('profile.public.loadError')}
      </p>
    </main>
  ) : isPending ? (
    <main className="h-40" aria-busy />
  ) : !profile ? (
    <NoSuchUser username={username} />
  ) : (
    <HistoryView username={profile.user.username} search={search} setSearch={setSearch} />
  );
}
