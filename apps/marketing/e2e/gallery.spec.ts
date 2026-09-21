import { test, expect } from '@playwright/test';

/**
 * The motion gallery — every micro pattern renders in both themes, a
 * stateful one really moves through busy → success, and the reduced-motion
 * simulator collapses the busy wait. The gallery is a DEV ROUTE (compiled
 * only under MARKETING_DEV_ROUTES=1), so this spec runs only against a
 * preview build: set E2E_DEV_ROUTES=1, else it skips with that reason.
 */
const PATTERNS = [
  'parachute-progress',
  'van-drive-off',
  'paper-plane-send',
  'glow-field',
  'rolling-label-button',
  'label-into-parcel',
  'expanding-track-field',
  'liquid-bead',
  'radial-contact-fan',
  'segmented-code',
  'scene-switcher',
  'odometer',
  'reactive-mascot',
  'door-hover',
  'connector-draw',
];

test.describe('motion gallery', () => {
  test.skip(
    process.env.E2E_DEV_ROUTES !== '1',
    'dev routes are compiled only in a preview build (E2E_DEV_ROUTES=1)',
  );

  for (const theme of ['light', 'dark'] as const) {
    test(`every pattern renders in ${theme}`, async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem('sd-theme', t), theme);
      await page.goto('/dev/motion', { waitUntil: 'networkidle' });
      expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe(
        theme,
      );
      for (const id of PATTERNS) await expect(page.locator(`[data-pattern="${id}"]`)).toBeVisible();
    });
  }

  test('a state button is busy, then done — never done first', async ({ page }) => {
    await page.goto('/dev/motion', { waitUntil: 'networkidle' });
    const btn = page.locator('[data-pattern="rolling-label-button"] button').first();
    await btn.click();
    await expect(btn).toHaveAttribute('data-phase', 'busy');
    await expect(btn).toHaveAttribute('data-phase', 'success', { timeout: 5_000 });
  });

  test('keyboard reaches the bead tabs and the arrow keys move the bead', async ({ page }) => {
    await page.goto('/dev/motion', { waitUntil: 'networkidle' });
    const tabs = page.locator('[data-pattern="liquid-bead"] [role=tab]');
    await tabs.first().focus();
    await page.keyboard.press('ArrowRight');
    await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
  });

  test('the serviceability code links and merges on a served code, refuses an unserved one', async ({
    page,
  }) => {
    await page.goto('/dev/motion', { waitUntil: 'networkidle' });
    const seg = page.locator('[data-pattern="segmented-code"] .mi-seg');
    const boxes = seg.locator('input');
    await boxes.first().focus();
    await page.keyboard.type('560001');
    await expect(seg).toHaveAttribute('data-verdict', 'ok');
    await expect(seg.locator('.mi-seg__verdict')).toContainText('4–7 days', { timeout: 5_000 });
    await boxes.last().focus();
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    await boxes.first().focus();
    await page.keyboard.type('900000');
    await expect(seg).toHaveAttribute('data-verdict', 'no');
    await expect(seg.locator('.mi-seg__verdict')).toContainText('Not yet');
  });

  test('the reduced-motion simulator removes the busy wait', async ({ page }) => {
    await page.goto('/dev/motion', { waitUntil: 'networkidle' });
    await page.getByLabel('simulate reduced motion').check();
    const btn = page.locator('[data-pattern="rolling-label-button"] button').first();
    const t0 = Date.now();
    await btn.click();
    await expect(btn).toHaveAttribute('data-phase', 'success', { timeout: 5_000 });
    // 900 ms fake task, no 900 ms floor on top — well under two seconds.
    expect(Date.now() - t0).toBeLessThan(2_000);
  });
});
