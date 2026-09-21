import { test, expect } from '@playwright/test';

/**
 * The hero's Core-Web-Vitals SHAPE, on a 360×780 phone: the largest
 * element painted is text — the headline — and never the map canvas (which
 * is text-free and starts drawing on idle), and the layout does not move
 * once drawn. A regression guard, not a Lighthouse substitute — the
 * numbers come from Lighthouse, run by hand.
 */
test.describe('hero vitals shape (360×780)', () => {
  test.use({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true });

  test('LCP is the headline, never the canvas; CLS stays under 0.05', async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __lcp: string[]; __cls: number };
      w.__lcp = [];
      w.__cls = 0;
      new PerformanceObserver((list) => {
        for (const e of list.getEntries() as (PerformanceEntry & { element?: Element })[]) {
          const el = e.element;
          w.__lcp.push(el ? `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}` : '?');
        }
      }).observe({ type: 'largest-contentful-paint', buffered: true });
      new PerformanceObserver((list) => {
        for (const e of list.getEntries() as (PerformanceEntry & {
          hadRecentInput?: boolean;
          value?: number;
        })[]) {
          if (!e.hadRecentInput) w.__cls += e.value ?? 0;
        }
      }).observe({ type: 'layout-shift', buffered: true });
    });
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);
    const { lcp, cls } = await page.evaluate(() => {
      const w = window as unknown as { __lcp: string[]; __cls: number };
      return { lcp: w.__lcp, cls: w.__cls };
    });
    expect(lcp.length).toBeGreaterThan(0);
    const last = lcp[lcp.length - 1] ?? '';
    expect(last === 'h1#hero-h1' || last === 'p', `LCP element was ${last}`).toBe(true);
    expect(lcp.some((l) => l === 'canvas')).toBe(false);
    expect(cls).toBeLessThan(0.05);
    // The action card and the trust row are above the fold at 360×780.
    const card = await page.locator('.hero-card').boundingBox();
    const trust = await page.locator('.hero__trust').boundingBox();
    expect(card, 'action card').not.toBeNull();
    expect(trust, 'trust row').not.toBeNull();
    if (card && trust) {
      expect(card.y + card.height).toBeLessThanOrEqual(780);
      expect(trust.y + trust.height).toBeLessThanOrEqual(780);
    }
  });
});
