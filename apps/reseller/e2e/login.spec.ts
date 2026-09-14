import { expect, test } from '@playwright/test';

/**
 * apps/reseller login round-trip (RS-2) — the seller spec's shape for the
 * third identity. No seeded user needed: every assertion is on the page
 * and on the server's own generic 401.
 */
test.describe('reseller login', () => {
  test('the login page renders the reseller portal chrome', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByText('Skydrop', { exact: true })).toBeVisible();
    await expect(page.getByText('reseller portal', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await expect(page.locator('#email')).toBeVisible();
    await expect(page.locator('#password')).toBeVisible();
  });

  test('unauthed /dashboard redirects to /login (FE-4 SSR gate)', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('bad credentials surface the server verdict (FE-2)', async ({ page }) => {
    await page.goto('/login');
    await page.locator('#email').fill('nobody@example.com');
    await page.locator('#password').fill('wrong-password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('Invalid email or password.')).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });
});
