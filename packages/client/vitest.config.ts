import { defineConfig } from 'vitest/config';

/**
 * The pure, framework-free half of the package — URL safety, generated covers,
 * the relative-time formatters, history grouping. Moved here from
 * `apps/web/test/lib/` with the code it covers (ADR-0008 §4).
 *
 * Hooks need a renderer and are out of scope, exactly as they were on web; when
 * they land, add a second project here rather than widening this one.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
