import { expect, test } from '@playwright/test';

/**
 * apps/associate login round-trip (ASSOC-1) — the reseller spec's shape
 * for the same third identity. No seeded user needed: every assertion is
 * on the page and on the server's own generic 401.
 */
test.describe('associate login', () => {
  test('the login page renders the sales portal chrome', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByText('Skydrop', { exact: true })).toBeVisible();
    await expect(page.getByText('sales portal', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await expect(page.locator('#email')).toBeVisible();
    await expect(page.locator('#password')).toBeVisible();
  });

  test('unauthed /orders redirects to /login (FE-4 SSR gate)', async ({ page }) => {
    await page.goto('/orders');
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
