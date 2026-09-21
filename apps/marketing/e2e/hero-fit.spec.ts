import { test, expect } from '@playwright/test';

/**
 * Nothing in the hero may extend past the viewport at phone widths, in
 * EVERY tab state — measured by getBoundingClientRect, regardless of
 * overflow settings, so a card clipped by `overflow: hidden` still fails.
 * Elements that are deliberately off-canvas (the closed drawer, `inert`)
 * or not rendered (`display: none`) are excluded; everything painted must
 * fit. This is the Phase 3 review's real bug: at 360 px the Track button,
 * the direction chip and every Book-tab field were cut off.
 */
const WIDTHS = [320, 360, 414] as const;
const TABS = ['Track', 'Quote', 'Book'] as const;

test.describe('hero fits the viewport in every tab state', () => {
  for (const w of WIDTHS) {
    test(`${w}px`, async ({ browser }) => {
      const ctx = await browser.newContext({
        viewport: { width: w, height: 780 },
        isMobile: true,
        hasTouch: true,
      });
      const page = await ctx.newPage();
      await page.goto('/', { waitUntil: 'networkidle' });
      for (const tab of TABS) {
        await page
          .getByRole('tab', { name: new RegExp(`^${tab}`) })
          .first()
          .click();
        await page.waitForTimeout(900);
        if (tab === 'Quote') {
          // Scoped to the hero: the estimator further down carries the same direction radios.
          await page
            .locator('.hero')
            .getByRole('radio', { name: /India.*Bangladesh/ })
            .check({ force: true });
          await page.waitForTimeout(300);
        }
        const offenders = await page.evaluate((vw) => {
          const out: string[] = [];
          const hero = document.querySelector('.hero');
          if (!hero) return ['no .hero'];
          for (const el of Array.from(hero.querySelectorAll<HTMLElement>('*'))) {
            if (el.closest('[inert],[aria-hidden="true"]')) continue;
            const cs = getComputedStyle(el);
            if (cs.display === 'none' || cs.visibility === 'hidden') continue;
            if (el.classList.contains('hero__art-slot') || el.closest('.hero__art-slot')) continue;
            const r = el.getBoundingClientRect();
            if (r.width === 0) continue;
            if (Math.round(r.right) > vw + 1 || Math.round(r.left) < -1) {
              out.push(
                `${el.tagName.toLowerCase()}.${Array.from(el.classList).slice(0, 2).join('.')} right=${Math.round(r.right)} left=${Math.round(r.left)}`,
              );
            }
          }
          return out.slice(0, 8);
        }, w);
        expect(offenders, `${tab} tab at ${w}px`).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
          w,
        );
      }
      await ctx.close();
    });
  }
});
