import { defineConfig } from 'vitest/config';

/**
 * The mapping, planning and provider-client halves are pure — they take a fetch
 * stub and plain objects. The one database-backed test lives in
 * `import.integration.test.ts` and self-skips without the dev compose stack.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // The integration suite migrates and seeds a database of its own; the pure
    // suites in the same run must not wait on it.
    fileParallelism: true,
  },
});
