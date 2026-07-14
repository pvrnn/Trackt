import { QueryClientProvider } from '@tanstack/react-query';
import { createRouter } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen';
import { makeQueryClient } from './lib/query-client';

export function getRouter() {
  // Per-request on the server, per-hydration on the client (see makeQueryClient).
  const queryClient = makeQueryClient();
  return createRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: 'intent',
    defaultViewTransition: true,
    scrollRestoration: true,
    // Provides the client to the whole tree without a hand-written provider in
    // __root; also the seam if routes later prefetch via loaders/context.
    Wrap: ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
