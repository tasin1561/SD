import { test, expect } from '@playwright/test';

/**
 * The theme toggle flips `data-theme`, remembers it, and rewrites the
 * `theme-color` metas to the hex `theme-colors.ts` declares (the gate in
 * check-theme.mjs keeps that hex equal to `--page`). An OS-light visitor
 * with no pin gets the light tokens without touching anything.
 */
const PAGE_BG = { light: '#f8f9ff', dark: '#090d16' } as const;

test.describe('theme', () => {
  test('toggle pins the theme, stores it, and rewrites theme-color', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    const before = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    // The header carries one toggle for desktop and the drawer another;
    // only the visible one is clickable.
    await page.locator('button[aria-label^="Switch to"]:visible').first().click();
    const after = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    expect(after).not.toBe(before);
    expect(after === 'light' || after === 'dark').toBe(true);
    expect(await page.evaluate(() => localStorage.getItem('sd-theme'))).toBe(after);
    const metas = await page.evaluate(() =>
      Array.from(document.querySelectorAll('meta[name="theme-color"]')).map((m) =>
        m.getAttribute('content'),
      ),
    );
    expect(metas.length).toBeGreaterThan(0);
    for (const m of metas) expect(m).toBe(PAGE_BG[after as 'light' | 'dark']);
  });

  test('OS light with no pin renders the light tokens', async ({ browser }) => {
    const ctx = await browser.newContext({ colorScheme: 'light' });
    const page = await ctx.newPage();
    await page.goto('/', { waitUntil: 'networkidle' });
    const bg = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--page').trim(),
    );
    expect(bg.toLowerCase()).toBe(PAGE_BG.light);
    await ctx.close();
  });
});
