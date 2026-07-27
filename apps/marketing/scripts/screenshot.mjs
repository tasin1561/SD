// Local screenshot harness — bundled Chromium headless shell.
// Usage: node scripts/screenshot.mjs [url] [--fold]
// Captures full-page shots at 360/768/1440 in dark + light.

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const url = process.argv[2] ?? 'http://localhost:3005/';
const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, 'screenshots');
mkdirSync(outDir, { recursive: true });

const widths = [
  { name: '360', w: 360, h: 780 },
  { name: '768', w: 768, h: 1024 },
  { name: '1440', w: 1440, h: 900 },
];
const themes = ['dark', 'light'];

const browser = await chromium.launch();
for (const theme of themes) {
  for (const { name, w, h } of widths) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    const page = await ctx.newPage();
    await page.addInitScript((t) => {
      try {
        localStorage.setItem('sd-theme', t);
      } catch {}
    }, theme);
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2200);
    await page.screenshot({ path: join(outDir, `${theme}-${name}-full.png`), fullPage: true });
    await page.screenshot({ path: join(outDir, `${theme}-${name}-fold.png`) });
    console.log(`ok ${theme} ${name}`);
    await ctx.close();
  }
}
await browser.close();
