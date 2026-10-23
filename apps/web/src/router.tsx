import { QueryClientProvider } from '@tanstack/react-query';
import { createRouter } from '@tanstack/react-router';
import { createIsomorphicFn } from '@tanstack/react-start';
import { getCookie, getRequestHeader } from '@tanstack/react-start/server';
import { I18nextProvider } from 'react-i18next';
import { routeTree } from './routeTree.gen';
import { makeQueryClient } from '@trackt/client';
import { configureWebClient } from './lib/client';
import { createI18n, LOCALE_COOKIE, localeFromCookie, negotiateLocale } from './i18n';

/**
 * Cookie on the server, `document.cookie` in the browser, one negotiation rule
 * on both sides, so the SSR render and the first hydration render agree.
 */
const readLocale = createIsomorphicFn()
  .server(() => negotiateLocale(getCookie(LOCALE_COOKIE), getRequestHeader('accept-language')))
  .client(() => negotiateLocale(localeFromCookie(document.cookie), navigator.language));

export function getRouter() {
  // Injects the HTTP client and the session source into @trackt/client, which
  // owns no transport of its own (ADR-0008 §4). Idempotent, and ahead of any
  // render, so no fetch helper can run unconfigured.
  configureWebClient();
  // Per-request on the server, per-hydration on the client (see makeQueryClient).
  const queryClient = makeQueryClient();
  const i18n = createI18n(readLocale());
  return createRouter({
    routeTree,
    // `i18n` rides in router context so `head()` can translate titles without a
    // second context key plumbed through every route. It is never serialized.
    context: { queryClient, i18n },
    defaultPreload: 'intent',
    defaultViewTransition: true,
    scrollRestoration: true,
    // Provides both clients to the whole tree without a hand-written provider
    // in __root.
    Wrap: ({ children }) => (
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </I18nextProvider>
    ),
  });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
