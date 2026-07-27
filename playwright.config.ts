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
 * **This IS a CI gate** (2026-07-27) — the `browser` job in
 * `.github/workflows/ci.yml` runs it. It gets its own job rather than
 * riding along in `checks`, because the API e2e suite's teardown DROPS
 * the test database; anything needing a live API afterwards would find
 * nothing there.
 *
 * In CI the app servers run the BUILT output (`start`) rather than
 * `dev`: it is what production actually serves, and a dev server
 * compiling routes on first request makes the first navigation of every
 * spec slow enough to look like a timeout.
 */

const ADMIN_PORT = 3002;
const SELLER_PORT = 3003;

/** CI serves the built apps; a dev machine serves `dev` for hot reload. */
const APP_COMMAND = (app: string): string =>
  process.env.CI ? `pnpm --filter @skydrop/${app} start` : `pnpm --filter @skydrop/${app} dev`;

/** The API the same-origin proxy forwards to (FE-3). CI runs it on 4000. */
const API_ORIGIN = process.env.API_ORIGIN ?? 'http://localhost:3000';

export default defineConfig({
  testDir: '.',
  testMatch: ['apps/admin/e2e/**/*.spec.ts', 'apps/seller/e2e/**/*.spec.ts'],
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
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
      command: APP_COMMAND('admin'),
      url: `http://localhost:${ADMIN_PORT}/login`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: { API_ORIGIN },
    },
    {
      command: APP_COMMAND('seller'),
      url: `http://localhost:${SELLER_PORT}/login`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: { API_ORIGIN },
    },
  ],
});
