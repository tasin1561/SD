import { defineConfig, devices } from '@playwright/test';

/**
 * Skydrop Playwright config — root-level, two projects:
 *   - admin  (port 3002, apps/admin)
 *   - seller (port 3003, apps/seller)
 *
 * Each project's specs live under apps/<name>/e2e/. Shared fixtures
 * (test users, login helpers — when CP2 spec count grows) will land
 * in e2e-fixtures/.
 *
 * **Prerequisites for `pnpm e2e:fe`:**
 *   1. Postgres + Redis: `docker compose -f docker/docker-compose.yml up -d`
 *   2. apps/api dev server on port 3000: `pnpm --filter @skydrop/api start:dev`
 *
 * The admin + seller Next.js dev servers are auto-spawned via the
 * `webServer` array below.
 *
 * **NOT a CI gate in M13 CP1** — `pnpm e2e:fe` is the manual smoke
 * gate; promotion to CI happens in a later module once the spec
 * count grows (per the M13 design's deferred-CI tradeoff, mirroring
 * the M12 CP2 manual-smoke discipline).
 */

const ADMIN_PORT = 3002;
const SELLER_PORT = 3003;

export default defineConfig({
  testDir: '.',
  testMatch: ['apps/admin/e2e/**/*.spec.ts', 'apps/seller/e2e/**/*.spec.ts'],
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    actionTimeout: 5_000,
    navigationTimeout: 30_000,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'admin',
      testMatch: 'apps/admin/e2e/**/*.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: `http://localhost:${ADMIN_PORT}`,
      },
    },
    {
      name: 'seller',
      testMatch: 'apps/seller/e2e/**/*.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: `http://localhost:${SELLER_PORT}`,
      },
    },
  ],
  webServer: [
    {
      command: 'pnpm --filter @skydrop/admin dev',
      url: `http://localhost:${ADMIN_PORT}/login`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        API_ORIGIN: process.env.API_ORIGIN ?? 'http://localhost:3000',
      },
    },
    {
      command: 'pnpm --filter @skydrop/seller dev',
      url: `http://localhost:${SELLER_PORT}/login`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        API_ORIGIN: process.env.API_ORIGIN ?? 'http://localhost:3000',
      },
    },
  ],
});
