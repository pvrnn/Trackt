import { defineConfig } from 'vitest/config';

// The queue wiring (importer.test.ts) runs against a fake job and a stubbed
// pipeline: no Redis required, so the suite stays hermetic like the rest.
export default defineConfig({
  test: {
    passWithNoTests: true,
  },
});
