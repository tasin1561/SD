#!/usr/bin/env node
/**
 * Screenshot the /dev/ui gallery — the Phase 1 review record.
 *
 * Captures the whole gallery in light and dark at 1440, dark at 390, and
 * light with the Motion control on Reduced. Themes are chosen through the
 * gallery's own controls, so the screenshot shows exactly what a reviewer
 * clicking them would see. A local `next start` of a build made with
 * APPS_DEV_ROUTES=1 only; output is gitignored.
 *
 *   node scripts/screenshots/apps-gallery.mjs --base http://localhost:3002 \
 *     --out screenshots/apps-restyle/gallery
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1]]);
    return acc;
  }, []),
);
const BASE = args.base;
const OUT = args.out;
if (!BASE || !OUT) throw new Error('--base and --out are required');
if (!/^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(BASE)) {
  throw new Error('apps-gallery runs against a local server only');
}
mkdirSync(OUT, { recursive: true });

const VARIANTS = [
  { name: 'light-1440', width: 1440, theme: 'Light', motion: 'Full' },
  { name: 'dark-1440', width: 1440, theme: 'Dark', motion: 'Full' },
  { name: 'dark-390', width: 390, theme: 'Dark', motion: 'Full' },
  { name: 'light-1440-reduced', width: 1440, theme: 'Light', motion: 'Reduced' },
];

const browser = await chromium.launch();
try {
  for (const v of VARIANTS) {
    const page = await browser.newPage({ viewport: { width: v.width, height: 900 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    const res = await page.goto(`${BASE}/dev/ui`, { waitUntil: 'load' });
    if (!res || res.status() !== 200) throw new Error(`/dev/ui answered ${res?.status()}`);
    await page.getByRole('group', { name: 'Theme' }).getByRole('button', { name: v.theme }).click();
    await page
      .getByRole('group', { name: 'Motion' })
      .getByRole('button', { name: v.motion })
      .click();
    // Let entrance animations and count-ups settle.
    await page.waitForTimeout(2500);
    await page.screenshot({ path: join(OUT, `${v.name}.png`), fullPage: true });
    const entries = await page.locator('[data-gallery-entry]').count();
    console.log(
      `${v.name}: ${entries} entries${errors.length ? `, ${errors.length} console error(s)` : ''}`,
    );
    for (const e of errors.slice(0, 10)) console.log(`  ! ${e}`);
    await page.close();
  }
} finally {
  await browser.close();
}
