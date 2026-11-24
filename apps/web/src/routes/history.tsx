import { createFileRoute, Navigate } from '@tanstack/react-router';
import { useAuthedPage } from '../lib/auth-client';
import { validateHistorySearch } from '../lib/history-search';

/** Kept so old links and bookmarks land: history lives at `/users/$username/history`. */
export const Route = createFileRoute('/history')({
  validateSearch: validateHistorySearch,
  component: HistoryRedirect,
});

function HistoryRedirect() {
  const { navUser } = useAuthedPage();
  const search = Route.useSearch();
  if (!navUser) return <div className="min-h-screen bg-ink" />;
  return (
    <Navigate
      to="/users/$username/history"
      params={{ username: navUser.username }}
      search={search}
      replace
    />
  );
}
