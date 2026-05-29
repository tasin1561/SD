import { defineConfig } from 'vitest/config';
import path from 'node:path';

/**
 * Seller component tests. Same vitest setup as apps/admin — happy-dom
 * environment + JSX automatic + @ alias to src/. The FE/BE test runner
 * split is intentional: apps/api uses jest; apps/admin + apps/seller +
 * the FE packages use vitest. See CLAUDE.md.
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
