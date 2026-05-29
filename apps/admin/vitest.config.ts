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
