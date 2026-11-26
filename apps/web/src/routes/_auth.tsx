import { createFileRoute, Navigate, useLocation, useSearch } from '@tanstack/react-router';
import { AuthLayout } from '../components/auth/AuthLayout';
import { authClient } from '../lib/auth-client';
import { doorsOpening } from '../lib/door-transition';

/**
 * Pathless parent of /login, /register and /verify-email. It renders both forms itself so it
 * can slide between them; the child routes only own the URL, title and search.
 */
export const Route = createFileRoute('/_auth')({
  component: AuthShell,
});

function AuthShell() {
  const pathname = useLocation({ select: (location) => location.pathname });
  const { redirect, email, code } = useSearch({ strict: false });
  const { data: session } = authClient.useSession();

  // Arriving already signed in: go straight on. Not while the doors are
  // opening, which is the form's own exit and navigates by itself.
  // (`href`, when set, takes precedence over `to` in the router.)
  if (session && !doorsOpening()) return <Navigate to="/home" href={redirect} />;

  const mode = pathname.startsWith('/register')
    ? 'register'
    : pathname.startsWith('/verify-email')
      ? 'verify'
      : 'login';
  return <AuthLayout mode={mode} redirect={redirect} email={email} code={code} />;
}
