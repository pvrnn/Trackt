import { createAuthClient } from 'better-auth/react';
import { inferAdditionalFields, usernameClient } from 'better-auth/client/plugins';
import { expoClient } from '@better-auth/expo/client';
import * as SecureStore from 'expo-secure-store';

/**
 * better-auth on React Native (ADR-0008 §3).
 *
 * There is no cookie jar here, so `expoClient` mirrors the session cookie into
 * SecureStore and replays it. The server side of this is two lines in
 * `apps/api/src/auth.ts` — the `expo()` plugin and `trackt://` in
 * `trustedOrigins`; sessions themselves are unchanged, which is why every route
 * guard already works for the app.
 *
 * The client is built per instance rather than once at module load: `baseURL`
 * is the origin the user picked, and switching instances has to produce a
 * different client rather than a reconfigured one — the plugin's cookie cache
 * is keyed to the client, and replaying instance A's cookie at instance B is
 * the exact bug the picker exists to make impossible.
 */

export type InstanceAuthClient = ReturnType<typeof createInstanceAuthClient>;

function createInstanceAuthClient(origin: string) {
  return createAuthClient({
    baseURL: origin,
    plugins: [
      expoClient({
        scheme: 'trackt',
        storagePrefix: 'trackt',
        storage: SecureStore,
      }),
      usernameClient(),
      // Mirrors the server's `additionalFields` (apps/api/src/auth.ts).
      inferAdditionalFields({ user: { role: { type: 'string', input: false } } }),
    ],
  });
}

let current: { origin: string; client: InstanceAuthClient } | null = null;

/**
 * The auth client for `origin`, memoised so repeated renders reuse one instance
 * (and so its `useSession` store survives re-renders). Called by
 * `InstanceProvider` on boot and on every instance change.
 */
export function configureAuth(origin: string): InstanceAuthClient {
  if (current?.origin !== origin) {
    current = { origin, client: createInstanceAuthClient(origin) };
  }
  return current.client;
}

export function resetAuth(): void {
  current = null;
}

/**
 * The configured client, for the non-hook half of the surface — the sign-in and
 * sign-up submit handlers, and the `Cookie` header hook in `client.ts`.
 */
export function authClient(): InstanceAuthClient {
  if (!current) {
    throw new Error('No instance selected — auth is unavailable until the picker has run.');
  }
  return current.client;
}

/**
 * The session cookie as a header value, or null before sign-in. `client.ts`
 * attaches this to every `/api/v1/*` request; `credentials: 'omit'` goes with
 * it, because sending both makes the platform fetch drop the manual header.
 */
export function sessionCookie(): string | null {
  return current?.client.getCookie() || null;
}
