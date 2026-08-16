import { APP_VERSION, HealthResponseSchema } from '@trackt/shared';

/**
 * Instance addressing (ADR-0008 §2). Trackt has no canonical server, so the
 * origin the user picked is the root of every URL the app builds: the API, the
 * better-auth base, and the `/uploads/*` paths the API returns relative.
 *
 * Deliberately free of `expo-*` imports so the whole module is unit-testable in
 * a node vitest project — SecureStore lives in `storage.ts` next door.
 */

/** The oldest instance this build can talk to. Bump when a screen needs a newer API. */
export const MIN_INSTANCE_VERSION = '0.1.0';

/** How long the picker waits before calling an origin unreachable. */
const PROBE_TIMEOUT_MS = 8000;

/**
 * Turn whatever the user typed into a bare origin, or null if it can't be one.
 *
 * A scheme is assumed rather than required (`demo.trackt.app` is what people
 * type), and `http:` is allowed because the overwhelmingly common first
 * instance is a LAN address or `localhost:3000` with no certificate. Anything
 * past the authority — path, query, hash — is dropped: it is never part of an
 * origin, and keeping it would silently produce `https://host/x/api/v1/search`.
 */
export function normalizeOrigin(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  // Backslashes are normalised to `/` by URL parsers, so `https:/\evil.com`
  // would parse as a different host than it reads as. Same class of bug as
  // `safeRedirect` in @trackt/client.
  if (trimmed.includes('\\')) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (!url.hostname) return null;
  // Credentials in the origin would be replayed on every request and stored in
  // SecureStore as part of the URL. Reject rather than strip.
  if (url.username || url.password) return null;
  return url.origin;
}

/**
 * Compare two `major.minor.patch` strings. Returns <0, 0, >0 like a comparator.
 * Anything non-numeric in a segment sorts as 0 — a server reporting a version
 * we can't parse is treated as ancient, not as an error.
 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => v.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const left = parse(a);
  const right = parse(b);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export type ProbeResult =
  | { ok: true; origin: string; version: string }
  /** Nothing answered: DNS, TLS, timeout, wrong port. */
  | { ok: false; reason: 'unreachable' }
  /** Something answered, but not `{ status, version }` — a router, a proxy, another app. */
  | { ok: false; reason: 'not-trackt' }
  /** A Trackt instance too old for this build. */
  | { ok: false; reason: 'too-old'; version: string };

/**
 * Probe a candidate origin. Three distinguishable failures, because the fix is
 * different for each: check the address, check it's a Trackt server, or ask the
 * admin to update. `signal` is the caller's cancellation (the picker aborts an
 * in-flight probe when the field changes).
 */
export async function probeInstance(origin: string, signal?: AbortSignal): Promise<ProbeResult> {
  let response: Response;
  try {
    response = await fetch(`${origin}/healthz`, {
      headers: { accept: 'application/json' },
      signal: signal ?? AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, reason: 'unreachable' };
  }
  if (!response.ok) return { ok: false, reason: 'not-trackt' };

  const parsed = HealthResponseSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) return { ok: false, reason: 'not-trackt' };

  const { version } = parsed.data;
  if (compareVersions(version, MIN_INSTANCE_VERSION) < 0) {
    return { ok: false, reason: 'too-old', version };
  }
  return { ok: true, origin, version };
}

/** What the app tells a user a failed probe means. */
export function describeProbeFailure(result: Extract<ProbeResult, { ok: false }>): string {
  switch (result.reason) {
    case 'unreachable':
      return "Couldn't reach that address. Check the URL, the port, and that you're on the same network.";
    case 'not-trackt':
      return "That address answered, but it isn't a Trackt instance.";
    case 'too-old':
      return `That instance runs ${result.version}; this app needs ${MIN_INSTANCE_VERSION} or newer. Ask its admin to update.`;
  }
}

/**
 * The active origin, as module state for the same reason `configureClient()` is
 * (ADR-0008 §4): `resolveInstanceUrl` is called from list renderers and image
 * props where threading a context through would mean touching every component.
 * `InstanceProvider` owns writes; nothing else calls the setter.
 */
let activeOrigin: string | null = null;

export function setActiveInstance(origin: string | null): void {
  activeOrigin = origin;
}

export function activeInstance(): string | null {
  return activeOrigin;
}

/**
 * The one place an instance-relative path becomes a URL — ADR-0008 §2. The API
 * hands back `coverUrl` and avatar `image` as `/uploads/…`, which is same-origin
 * on web and a broken image on mobile.
 *
 * Absolute URLs pass through untouched (covers from a provider CDN already are
 * one), and anything that isn't a rooted path returns null rather than being
 * concatenated into a plausible-looking wrong URL.
 */
export function resolveInstanceUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  if (!path.startsWith('/') || path.startsWith('//')) return null;
  const origin = activeInstance();
  return origin ? `${origin}${path}` : null;
}

/**
 * The mobile analogue of `safeRedirect` from `@trackt/client`: a deep link may
 * only resolve to an in-app route. Same rules — rooted, single-slash, no
 * backslashes — because expo-router's `href` will happily open an external URL.
 */
export function safeRoute(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  if (!value.startsWith('/') || value.startsWith('//')) return undefined;
  if (value.includes('\\')) return undefined;
  return value;
}

/** This build's version, for the "connected to" line and future skew checks. */
export const CLIENT_VERSION = APP_VERSION;
