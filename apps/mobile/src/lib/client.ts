import ky from 'ky';
import { configureClient } from '@trackt/client';
import { authClient, sessionCookie } from './auth-client';

/**
 * Mobile's half of the `@trackt/client` seam (ADR-0008 §4). Re-called whenever
 * the instance changes.
 *
 * React Native has no cookie jar, so the session cookie is attached by hand —
 * and `credentials: 'omit'` is not optional: with the default, the platform
 * fetch treats the request as credentialed and drops that manual header, which
 * reads as "signed in on the client, 401 from the server".
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
