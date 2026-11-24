import { createFileRoute, Navigate } from '@tanstack/react-router';
import { useAuthedPage } from '../lib/auth-client';

/** Kept so old links and bookmarks land: the profile lives at `/users/$username`. */
export const Route = createFileRoute('/profile')({
  component: ProfileRedirect,
});

function ProfileRedirect() {
  const { navUser } = useAuthedPage();
  if (!navUser) return <div className="min-h-screen bg-ink" />;
  return <Navigate to="/users/$username" params={{ username: navUser.username }} replace />;
}
