import type { KyInstance } from 'ky';

/**
 * The two things this package deliberately does not own (ADR-0008 §4).
 *
 * Every fetch helper below reaches for `http()` rather than importing a
 * configured `ky`, and every session-gated query asks `useIsAuthed()` rather
 * than importing better-auth. That is the whole seam between the two clients:
 *
 * - **web** injects a same-origin `ky.create({ prefix: '/api/v1/' })` and
 *   better-auth's React client;
 * - **mobile** injects a `ky` prefixed with the instance origin the user picked
 *   (ADR-0008 §2) and better-auth's Expo client, whose session cookie comes out
 *   of SecureStore rather than a cookie jar.
 *
 * Configuration is a module singleton rather than React context because the
 * non-hook half of the surface — `trackingApi`, `listsApi`, `friendsApi`,
 * `fetchMediaDetail` — is called from event handlers and mutation functions
 * where there is no hook to read a context from. On web `getRouter()` sets it
 * once per request (server) or per hydration (client); on mobile it is re-set
 * when the user switches instance.
 */
export interface ClientRuntime {
  /** Prefixed HTTP client. Paths passed to it are relative to `/api/v1/`. */
  http: KyInstance;
  /**
   * Whether a session is currently resolved. Must be a React hook — it is
   * called during render to gate queries, and has to re-render on sign-in.
   */
  useIsAuthed: () => boolean;
}

let runtime: ClientRuntime | null = null;

export function configureClient(next: ClientRuntime): void {
  runtime = next;
}

function required(): ClientRuntime {
  if (!runtime) {
    throw new Error(
      '@trackt/client is not configured — call configureClient({ http, useIsAuthed }) before rendering.',
    );
  }
  return runtime;
}

/** The injected HTTP client. Resolved per call, so re-configuring takes effect. */
export function http(): KyInstance {
  return required().http;
}

/**
 * Session gate for `enabled:`. A hook, and called unconditionally at the top of
 * every hook that uses it — configuration never changes between renders of the
 * same tree, so the delegate is stable.
 */
export function useIsAuthed(): boolean {
  return required().useIsAuthed();
}
