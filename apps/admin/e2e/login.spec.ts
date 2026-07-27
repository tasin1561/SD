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
    // The app is named by its strapline, not a bare word — the login
    // chrome was restyled after these specs were written, and nothing
    // ran them to notice.
    await expect(page.getByText('operations console', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'email' })).toBeVisible();
    // NOT getByLabel('Password'): the show/hide toggle carries
    // aria-label="Show password", so that locator is ambiguous.
    await expect(page.locator('#password')).toBeVisible();
  });

  test('unauthed /dashboard redirects to /login (FE-4 SSR gate)', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('bad credentials surface the server verdict (FE-2)', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('textbox', { name: 'email' }).fill('nobody@example.com');
    await page.locator('#password').fill('wrong-password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    // The API returns 401; the form surfaces the generic
    // "Invalid email or password." copy (FE-2: server verdict
    // surfaced, not pre-empted client-side).
    await expect(page.getByText('Invalid email or password.')).toBeVisible();
    // URL stays on /login — no premature navigation.
    await expect(page).toHaveURL(/\/login$/);
  });
});
