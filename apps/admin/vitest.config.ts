import { defineConfig } from 'vitest/config';
import path from 'node:path';

/**
 * Admin component tests. The FE/BE test runner split is intentional:
 * apps/api uses jest (preset is fully wired against the NestJS
 * setup); apps/admin + the FE packages use vitest (faster, native
 * ESM, JSX without extra config). See CLAUDE.md.
 */
export default defineConfig({
  test: {
    include: ['src/tests/**/*.test.{ts,tsx}'],
    environment: 'happy-dom',
    setupFiles: ['./src/tests/setup.ts'],
    reporters: ['default'],
    /**
     * 20s, not the 5s default.
     *
     * The god-mode specs drive `user-event`, which types a 30-character
     * reason and a typed-confirm phrase one keystroke at a time, each
     * with its own act() flush. Alone they take ~800ms a test; with
     * eighteen files running in parallel on a loaded runner they went
     * past 5s and failed — and a timeout reads exactly like a broken
     * assertion, so the first look is always at code that is fine.
     *
     * It cost a red CI run to learn that. The limit is here to catch a
     * hang, not to police how long a keystroke-by-keystroke form test
     * takes, so it is set well clear of the real number.
     */
    testTimeout: 20_000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  esbuild: {
    jsx: 'automatic',
  },
});
