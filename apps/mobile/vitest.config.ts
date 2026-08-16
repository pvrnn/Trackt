import { defineConfig } from 'vitest/config';

/**
 * The pure half only (mobile plan, "Verification"): `src/lib/instance.ts` and
 * the token drift guard. Anything that imports `react-native` or an `expo-*`
 * module needs a renderer and a native runtime, and is out of scope here for
 * exactly the reason component tests are out of scope on web.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
