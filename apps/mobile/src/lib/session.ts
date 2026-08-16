import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { authClient } from './auth-client';

/**
 * The mobile analogue of web's `useAuthedPage()` (`apps/web/src/lib/auth-client.ts`).
 *
 * Both hooks here require an instance to be selected — there is no auth client
 * to ask before that, and no session that could mean anything. The *instance*
 * half of the gate is structural instead: `app/_layout.tsx` only registers the
 * routes that use these hooks inside a `<Stack.Protected guard={!!origin}>`, so
 * a deep link that arrives before the picker has run resolves to the picker
 * rather than mounting a screen with nothing to fetch from.
 */

export interface SessionUser {
  name: string;
  username: string;
  image?: string | null | undefined;
  role?: string | undefined;
}

export interface SessionState {
  isPending: boolean;
  user: SessionUser | null;
  /** Re-pull the session after a profile edit changes the name or avatar. */
  refetch: () => void;
}

/**
 * Session resolution without the gate, for screens that render either way —
 * the signed-out landing and (from phase 2) News.
 */
export function useOptionalSession(): SessionState {
  const { data, isPending, refetch } = authClient().useSession();
  return {
    isPending,
    user: data
      ? {
          name: data.user.name,
          username: data.user.displayUsername ?? data.user.name,
          image: data.user.image,
          role: data.user.role,
        }
      : null,
    refetch,
  };
}

/**
 * The gate every signed-in screen shares: resolves the session and replaces the
 * route with login when there isn't one. `replace`, not `push`, so the back
 * gesture never returns to a screen the gate just rejected.
 */
export function useAuthedScreen(): SessionState {
  const router = useRouter();
  const session = useOptionalSession();
  const signedOut = !session.isPending && !session.user;

  useEffect(() => {
    if (signedOut) router.replace('/login');
  }, [signedOut, router]);

  return session;
}
