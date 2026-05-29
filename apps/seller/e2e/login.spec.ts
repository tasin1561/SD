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
    await expect(page.getByText('Seller', { exact: true })).toBeVisible();
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
    await expect(page.getByText('Invalid email or password.')).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });
});
