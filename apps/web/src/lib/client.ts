import ky from 'ky';
import { configureClient } from '@trackt/client';
import { authClient } from './auth-client';

/**
 * Web's half of the `@trackt/client` seam (ADR-0008 §4).
 *
 * Same-origin in both dev (Vite proxies /api → :3001) and prod (monolith
 * proxy), so the prefix is a bare path and there is no base URL to resolve —
 * the mobile client is the one that has to absolutize against a picked
 * instance.
 *
 * Called from `getRouter()` rather than at module scope: that is the single
 * entry both the server render and the browser hydration go through, so the
 * runtime is always configured before anything can fetch, without depending on
 * import order.
 */
export function configureWebClient(): void {
  configureClient({
    http: ky.create({ prefix: '/api/v1/' }),
    useIsAuthed: () => !!authClient.useSession().data,
  });
}
