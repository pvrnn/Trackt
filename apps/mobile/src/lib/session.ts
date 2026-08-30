import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { authClient } from './auth-client';

/**
 * The mobile analogue of web's `useAuthedPage()`. Both hooks need an instance
 * already selected; `app/_layout.tsx` enforces that structurally, by keeping
 * their routes inside `<Stack.Protected guard={!!origin}>`.
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
