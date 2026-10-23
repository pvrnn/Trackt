# ADR-0009: A cookie locale and bundled catalogs for web

**Status:** Accepted — 2026-10-23, with [docs/web-i18n-plan.md](../web-i18n-plan.md) built for `apps/web` (English + French)
**Touches:** ADR-0008 (the client seam: `packages/client` keeps `en-GB` defaults until mobile has a catalog)

## Context

Trackt had no i18n layer. `apps/web` rendered English literals from components,
from `packages/client` display helpers (`KIND_LABELS`, `TOPIC_LABELS`,
`updatedLabel`, the history month tables), and from `Intl` calls hard-coded to
`en-GB`. `<html lang>` was `en` in the SSR shell, and every route title was an
English literal.

Two locales, English and French, are the immediate requirement. The product is
self-hosted: every reader is on someone's instance, most surfaces are behind
auth, and there is no central server to negotiate a language with. The mobile
client is a second consumer that must inherit the same catalogs without a second
translation project.

## Decision

1. **The locale is a cookie (`trackt_locale`), not a route segment.** No `/fr/…`
   prefix and no `?lang=`. Consequence: public pages have no per-language URLs,
   so there is no `hreflang` and no locale-prefixed canonical. That is
   acceptable because the instance is self-hosted and most surfaces are behind
   auth; adding locale URLs later is additive, not a rewrite.

2. **Catalogs are bundled, with no HTTP translation backend.** Both catalogs
   ship in the client bundle and `createI18n` initializes synchronously
   (`initAsync: false`), so neither side of hydration has a loading state. At
   this string count the cost is roughly 10–20 KB per catalog.

3. **English and French are complete; content is not localized.** The chrome is
   translated. Catalog titles and overviews, news article bodies, usernames,
   list names and other user-generated strings stay in the language their
   authors wrote. `/api/v1` error bodies stay English; the UI maps codes to
   catalog keys. This is a product statement, not an oversight.

4. **`apps/web` first, `packages/i18n` when mobile lands.** The catalogs live in
   `apps/web/src/i18n/`, keyed by surface and typed against `en.json`, so they
   can be lifted without touching keys. Until then the English constants in
   `packages/client` stay for mobile, and web stops importing them; the seam is
   deliberate and the follow-up removes the duplication.

5. **A per-request i18next instance, never the module singleton.** The
   singleton leaks one SSR request's locale into another's render.
   `getRouter()` is already per-request, so the instance is created there and
   rides in router context for `head()`.

6. **Missing keys fail typecheck, not at runtime.** `i18next.d.ts` augments
   `CustomTypeOptions` from `en.json`, and `fr` is checked against the shape of
   `en` in `locales/index.ts`. There is no runtime fallback-to-English path for a
   key that should exist.

## Consequences

- The switcher writes the cookie and calls `router.invalidate()`: `head()`
  re-runs so the tab title follows the switch, and no content query is
  invalidated because nothing cached is language-dependent.
- Reading a page without JavaScript returns the chosen language, with the correct
  `<html lang>`. `curl -s localhost:3000 | grep -o '<html[^>]*>'` is the check.
- A follow-up can add `user.locale` (better-auth `additionalFields`) as the
  cross-device default, or move the catalogs to `packages/i18n` for mobile, both
  without changing keys or call sites.
- Provider and catalog metadata remain English until a separate decision adds a
  language column and provider language parameters.
