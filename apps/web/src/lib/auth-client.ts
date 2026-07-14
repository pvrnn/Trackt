import { createAuthClient } from 'better-auth/react';
import { inferAdditionalFields, usernameClient } from 'better-auth/client/plugins';
import { useEffect } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { UserRoleSchema, isModerator } from '@trackt/shared';
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
  isModerator: boolean;
  /** Re-pull the better-auth session (nav name/avatar) after a profile edit. */
  refetch: () => void;
}

/**
 * The client-side auth gate every app page shares: resolves the session,
 * redirects to /login when signed out (and to /home when a page needs a
 * moderator and the viewer isn't one — the server enforces this too), and
 * hands back the canonical `navUser`. Replaces the guard `useEffect` + `navUser`
 * object that used to be copy-pasted across the app routes.
 */
export function useAuthedPage(options?: { requireModerator?: boolean }): AuthedPage {
  const navigate = useNavigate();
  const { data: session, isPending, refetch } = authClient.useSession();
  const role = UserRoleSchema.safeParse(session?.user.role);
  const moderator = role.success && isModerator(role.data);
  const requireModerator = options?.requireModerator ?? false;

  useEffect(() => {
    if (isPending) return;
    if (!session) navigate({ to: '/login' });
    else if (requireModerator && !moderator) navigate({ to: '/home' });
  }, [isPending, session, moderator, requireModerator, navigate]);

  const navUser: AppNavUser | null = session
    ? {
        name: session.user.name,
        username: session.user.displayUsername ?? session.user.name,
        image: session.user.image,
        role: session.user.role,
      }
    : null;

  return { isPending, session, navUser, isModerator: moderator, refetch };
}
