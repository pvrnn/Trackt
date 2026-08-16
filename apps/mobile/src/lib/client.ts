import ky from 'ky';
import { configureClient } from '@trackt/client';
import { authClient, sessionCookie } from './auth-client';

/**
 * Mobile's half of the `@trackt/client` seam (ADR-0008 §4), and the counterpart
 * to `apps/web/src/lib/client.ts`.
 *
 * Two things differ from web, and they are the two things the seam exists for:
 *
 * 1. **The prefix is absolute** — every request goes to the instance the user
 *    picked, not to an origin the runtime already knows.
 * 2. **The session is a header** — React Native has no cookie jar, so the
 *    cookie better-auth's Expo plugin keeps in SecureStore is attached by hand.
 *    `credentials: 'omit'` is not optional: with the default the platform fetch
 *    treats the request as credentialed and drops the manual `Cookie` header,
 *    which reads as "signed in on the client, 401 from the server".
 *
 * Re-called whenever the instance changes; `configureClient` resolves `http()`
 * per call, so in-flight screens pick up the new client on their next fetch.
 */
export function configureMobileClient(origin: string): void {
  configureClient({
    http: ky.create({
      prefix: `${origin}/api/v1/`,
      credentials: 'omit',
      hooks: {
        beforeRequest: [
          ({ request }) => {
            const cookie = sessionCookie();
            if (cookie) request.headers.set('Cookie', cookie);
          },
        ],
      },
    }),
    useIsAuthed: () => !!authClient().useSession().data,
  });
}
