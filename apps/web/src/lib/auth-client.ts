import { createAuthClient } from 'better-auth/react';
import { inferAdditionalFields, usernameClient } from 'better-auth/client/plugins';
import { useEffect } from 'react';
import { useLocation, useNavigate } from '@tanstack/react-router';
import type { AppNavUser } from '../components/layout/AppNav';

/**
 * Same-origin in both dev (Vite proxies /api → :3001) and prod (monolith proxy),
 * so no baseURL — the client defaults to window.location.origin.
 * Only use these hooks/methods from client-rendered code paths.
 * `role` mirrors the server's additionalFields config (apps/api/src/auth.ts).
 */
export const authClient = createAuthClient({
  plugins: [
    usernameClient(),
    inferAdditionalFields({ user: { role: { type: 'string', input: false } } }),
  ],
});

type Session = ReturnType<typeof authClient.useSession>['data'];

export interface AuthedPage {
  isPending: boolean;
  session: Session;
  /** null until the session resolves — every app page renders a blank shell until then. */
  navUser: AppNavUser | null;
  /** Re-pull the better-auth session (nav name/avatar) after a profile edit. */
  refetch: () => void;
}

/**
 * The client-side auth gate every app page shares: resolves the session,
 * redirects to /login when signed out, and hands back the canonical `navUser`.
 * Replaces the guard `useEffect` + `navUser` object that used to be
 * copy-pasted across the app routes.
 */
export function useAuthedPage(): AuthedPage {
  const navigate = useNavigate();
  const location = useLocation();
  const { data: session, isPending, refetch } = authClient.useSession();
  // Deep link → login → back to the deep link, not dumped at /home.
  const returnTo = location.href;

  useEffect(() => {
    if (isPending) return;
    if (!session) {
      navigate({
        to: '/login',
        search: returnTo === '/home' ? {} : { redirect: returnTo },
        replace: true,
      });
    }
  }, [isPending, session, navigate, returnTo]);

  const navUser: AppNavUser | null = session
    ? {
        name: session.user.name,
        username: session.user.displayUsername ?? session.user.name,
        image: session.user.image,
      }
    : null;

  return { isPending, session, navUser, refetch };
}

/**
 * The same session resolution without the gate, for pages that are public but
 * render differently when signed in — News is the first (ADR-0005). Signing in
 * is not a precondition, so a `null` navUser means "show the marketing nav",
 * not "redirect to /login".
 */
export function useOptionalSession(): Pick<AuthedPage, 'isPending' | 'session' | 'navUser'> {
  const { data: session, isPending } = authClient.useSession();
  const navUser: AppNavUser | null = session
    ? {
        name: session.user.name,
        username: session.user.displayUsername ?? session.user.name,
        image: session.user.image,
      }
    : null;
  return { isPending, session, navUser };
}
