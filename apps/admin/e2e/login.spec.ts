import { test, expect } from '@playwright/test';

/**
 * apps/admin login round-trip (M13 CP1.7).
 *
 * The harness's first spec — proves the FE-3 proxy + FE-4 SSR gate +
 * FE-2 server-verdict-verbatim discipline hold end-to-end through a
 * real browser, not just at the integration layer.
 *
 * Prereqs: Postgres + Redis + apps/api running. See
 * playwright.config.ts for the manual setup steps. The dev servers
 * for admin + seller are auto-spawned via `webServer`.
 *
 * No seeded test user required — every assertion is on
 * UI behavior + the server's authoritative 401, which the API
 * returns generically for any unknown email.
 */

test.describe('admin login (M13 CP1.7 harness)', () => {
  test('login page renders the Skydrop Admin chrome', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByText('Skydrop', { exact: true })).toBeVisible();
    await expect(page.getByText('Admin', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
  });

  test('unauthed /dashboard redirects to /login (FE-4 SSR gate)', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('bad credentials surface the server verdict (FE-2)', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill('nobody@example.com');
    await page.getByLabel('Password').fill('wrong-password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    // The API returns 401; the form surfaces the generic
    // "Invalid email or password." copy (FE-2: server verdict
    // surfaced, not pre-empted client-side).
    await expect(page.getByText('Invalid email or password.')).toBeVisible();
    // URL stays on /login — no premature navigation.
    await expect(page).toHaveURL(/\/login$/);
  });
});
