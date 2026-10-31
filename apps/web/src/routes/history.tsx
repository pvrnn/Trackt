import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { AppNav } from '../components/layout/AppNav';
import { AuraBackground } from '../components/layout/AuraBackground';
import { HistoryView } from '../components/history/HistoryView';
import { useAuthedPage } from '../lib/auth-client';
import { validateHistorySearch } from '../lib/history-search';

/**
 * The viewer's own year view. The page itself is `HistoryView`, shared with
 * `/users/$username/history` — this route owns the session guard and the nav.
 */
export const Route = createFileRoute('/history')({
  head: ({ match }) => ({ meta: [{ title: match.context.i18n.t('meta.history') }] }),
  validateSearch: validateHistorySearch,
  component: OwnHistoryPage,
});

function OwnHistoryPage() {
  const { isPending, navUser } = useAuthedPage();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });

  if (isPending || !navUser) return <div className="min-h-screen bg-ink" />;

  return (
    <div className="min-h-screen bg-ink text-fg">
      <AuraBackground variant="app" />
      <div className="relative">
        <AppNav user={navUser} />
        <HistoryView
          search={search}
          setSearch={(patch) => navigate({ search: (previous) => ({ ...previous, ...patch }) })}
        />
      </div>
    </div>
  );
}
