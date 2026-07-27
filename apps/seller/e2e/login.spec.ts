import { test, expect } from '@playwright/test';

/**
 * apps/seller login round-trip (M13 CP1.7).
 *
 * The FE-5 identity-parameterization in practice: the same harness
 * shape as apps/admin's login spec, with seller-distinct chrome
 * (Seller portal, companyName surface). Proves the second consumer
 * of the M12 frontend foundation works end-to-end.
 *
 * Prereqs: Postgres + Redis + apps/api running. See
 * playwright.config.ts for the manual setup steps.
 *
 * No seeded test user required — every assertion is on UI behavior
 * + the server's authoritative 401.
 */

test.describe('seller login (M13 CP1.7 harness)', () => {
  test('login page renders the Skydrop Seller chrome', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByText('Skydrop', { exact: true })).toBeVisible();
    // The app is named by its strapline, not a bare word — the login
    // chrome was restyled after these specs were written, and nothing
    // ran them to notice.
    await expect(page.getByText('seller portal', { exact: true })).toBeVisible();
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
    await expect(page.getByText('Invalid email or password.')).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });
});
