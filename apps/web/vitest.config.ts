import { defineConfig } from 'vitest/config';

/**
 * Deliberately standalone rather than extending `vite.config.ts`: that config
 * carries the TanStack Start plugin, which builds an SSR entry and a route tree
 * — none of which a unit test needs, and all of which it would have to boot.
 *
 * Scope is the pure, framework-free half of `src/lib` (URL safety, generated
 * covers, the relative-time formatters). Component and route tests need a DOM
 * environment and Testing Library; when those land, add a second project here
 * with `environment: 'jsdom'` rather than widening this one.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
