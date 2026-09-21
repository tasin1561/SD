import { defineConfig, devices } from '@playwright/test';

/**
 * Marketing ALONE, against the STATIC EXPORT — the hygiene rule for local
 * runs: build first, serve `out/` with the same server production's Caddy
 * resolution is modelled on, one server, killed when the run ends. The
 * root `playwright.config.ts` starts all five frontends' dev servers,
 * which is what OOM'd this machine.
 *
 *   pnpm --filter @skydrop/marketing build
 *   npx playwright test -c apps/marketing/playwright.static.config.ts
 */
const PORT = 3006;

export default defineConfig({
  testDir: '../..',
  testMatch: ['apps/marketing/e2e/**/*.spec.ts', 'e2e-shared/**/*.spec.ts'],
  //  holds full checkouts left by agents — each with its own
  // node_modules and e2e-shared — and walking them loads @playwright/test twice.
  testIgnore: [
    '**/node_modules/**',
    '**/.next/**',
    '**/out/**',
    '**/dist/**',
    '**/.turbo/**',
    '**/.claude/**',
  ],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: { actionTimeout: 5_000, navigationTimeout: 30_000, trace: 'retain-on-failure' },
  projects: [
    {
      name: 'marketing',
      use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${PORT}` },
    },
  ],
  webServer: {
    command: `node ../../scripts/serve-static.mjs out ${PORT}`,
    // A render script may already be serving out/ on another port; this
    // config always brings its own server on 3006 and tears it down.
    cwd: __dirname,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
