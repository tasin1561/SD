// Local screenshot harness: launches bundled Chromium (no system Chrome),
// visits the running static server, captures the landing page at three
// viewport widths (mobile 360, tablet 768, desktop 1440), and drops PNGs
// into scripts/screenshots/.

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const url = process.argv[2] ?? 'http://localhost:3999/';
const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, 'screenshots');
mkdirSync(outDir, { recursive: true });

const widths = [
  { name: '360-mobile', w: 360, h: 780 },
  { name: '768-tablet', w: 768, h: 1024 },
  { name: '1440-desktop', w: 1440, h: 900 },
];

const browser = await chromium.launch();
for (const { name, w, h } of widths) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'networkidle' });
  // Give framer-motion + counters a beat to run animations
  await page.waitForTimeout(2500);
  const path = join(outDir, `${name}-full.png`);
  await page.screenshot({ path, fullPage: true });
  const abovefold = join(outDir, `${name}-fold.png`);
  await page.screenshot({ path: abovefold, fullPage: false });
  console.log(`✓ ${name}: ${path}`);
  await ctx.close();
}
await browser.close();
console.log('done');
