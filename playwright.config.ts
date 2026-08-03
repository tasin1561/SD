import { defineConfig, devices } from '@playwright/test';

/**
 * Skydrop Playwright config — root-level, four projects:
 *   - admin     (port 3002, apps/admin)
 *   - seller    (port 3003, apps/seller)
 *   - track     (port 3004, apps/track)
 *   - marketing (port 3005, apps/marketing)
 *
 * Each project's specs live under apps/<name>/e2e/. Specs under
 * `e2e-shared/` run against EVERY project — that is where checks which
 * must hold for all frontends live (currently the nonce CSP). A fourth
 * frontend gets them by being added to `projects` below, which is the
 * point: `apps/track` shipped a CSP violation because the browser job
 * only covered admin and seller.
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
const TRACK_PORT = 3004;
const MARKETING_PORT = 3005;

/** Specs that must hold for every frontend, not just one. */
const SHARED = 'e2e-shared/**/*.spec.ts';

/**
 * CI serves the built apps; a dev machine serves `dev` for hot reload.
 *
 * This holds for marketing too, but its `start` is not `next start` —
 * that command refuses an `output: 'export'` app outright. It runs
 * `scripts/serve-static.mjs`, which resolves extensionless URLs the way
 * Caddy's `try_files` does in production; a plain file server would 404
 * on `/request-invite`, which the export writes as a `.html` file.
 */
const APP_COMMAND = (app: string): string =>
  process.env.CI ? `pnpm --filter @skydrop/${app} start` : `pnpm --filter @skydrop/${app} dev`;

/** The API the same-origin proxy forwards to (FE-3). CI runs it on 4000. */
const API_ORIGIN = process.env.API_ORIGIN ?? 'http://localhost:3000';

export default defineConfig({
  testDir: '.',
  testMatch: [
    'apps/admin/e2e/**/*.spec.ts',
    'apps/seller/e2e/**/*.spec.ts',
    'apps/track/e2e/**/*.spec.ts',
    'apps/marketing/e2e/**/*.spec.ts',
    SHARED,
  ],
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
      testMatch: ['apps/admin/e2e/**/*.spec.ts', SHARED],
      use: {
        ...devices['Desktop Chrome'],
        baseURL: `http://localhost:${ADMIN_PORT}`,
      },
    },
    {
      name: 'seller',
      testMatch: ['apps/seller/e2e/**/*.spec.ts', SHARED],
      use: {
        ...devices['Desktop Chrome'],
        baseURL: `http://localhost:${SELLER_PORT}`,
      },
    },
    {
      name: 'track',
      testMatch: ['apps/track/e2e/**/*.spec.ts', SHARED],
      use: {
        ...devices['Desktop Chrome'],
        baseURL: `http://localhost:${TRACK_PORT}`,
      },
    },
    {
      name: 'marketing',
      testMatch: ['apps/marketing/e2e/**/*.spec.ts', SHARED],
      use: {
        ...devices['Desktop Chrome'],
        baseURL: `http://localhost:${MARKETING_PORT}`,
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
    {
      command: APP_COMMAND('track'),
      // Track has no /login — it is the public lookup page.
      url: `http://localhost:${TRACK_PORT}/`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: { API_ORIGIN },
    },
    {
      command: APP_COMMAND('marketing'),
      // The landing page. Marketing is a static export with no API of
      // its own — the one request it makes is the invite submission,
      // and the spec for it intercepts that rather than sending it.
      url: `http://localhost:${MARKETING_PORT}/`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
