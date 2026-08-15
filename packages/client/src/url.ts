/**
 * URL safety at the two seams where a string from outside becomes somewhere the
 * browser will actually go: the `?redirect=` a signed-out visitor carries into
 * /login, and the `[label](href)` of an untrusted article body (ADR-0005).
 *
 * Both are one-line-looking checks that are easy to get subtly wrong, so they
 * live here as plain functions rather than inline in a route or a renderer.
 */

/**
 * Only same-app paths survive as a post-login destination — never other origins.
 * Backslashes are rejected outright: browsers normalise them to `/` in URLs, so
 * `/\evil.com` passes a naive `startsWith('//')` check and then resolves as
 * `//evil.com`.
 */
export function safeRedirect(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  if (!value.startsWith('/') || value.startsWith('//')) return undefined;
  if (value.includes('\\')) return undefined;
  return value;
}

/** An href with a scheme (`https:`) or protocol-relative (`//host/x`). */
const ABSOLUTE = /^([a-z][a-z0-9+.-]*:|\/\/)/i;

/**
 * Only http(s) may become an anchor. `javascript:` and friends return null and
 * their link degrades to plain text.
 *
 * Absolute and protocol-relative hrefs come back **normalised** rather than as
 * written: `//evil.com/x` inherits the page's scheme, so echoing the input
 * rendered a link that reads as site-relative and leaves the instance. Relative
 * hrefs are returned untouched — resolving those against the probe base would
 * rewrite every in-article `/path` link to `example.invalid`.
 */
export function safeHref(url: string): string | null {
  try {
    const parsed = new URL(url, 'https://example.invalid');
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return ABSOLUTE.test(url) ? parsed.href : url;
  } catch {
    return null;
  }
}
