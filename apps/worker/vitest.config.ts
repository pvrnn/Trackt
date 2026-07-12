import { defineConfig } from 'vitest/config';

// No tests exist yet — catalog-sync (the only job this worker ran) was
// retired by ADR-0002. Passes cleanly until importers/notifications (PRD §6)
// land with their own suites.
export default defineConfig({
  test: {
    passWithNoTests: true,
  },
});
