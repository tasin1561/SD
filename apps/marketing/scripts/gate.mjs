// Acceptance-gate evidence: reduced-motion screenshot, keyboard-tab
// pass (focus ring visibility on every interactive element), and a
// horizontal-overflow probe at all three widths.

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const url = process.argv[2] ?? 'http://localhost:3999/';
const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, 'screenshots');
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();

// 1) Reduced-motion, dark, 1440 — full page must be fully readable/static
{
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: 'reduce',
  });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    try { localStorage.setItem('sd-theme', 'dark'); } catch {}
  });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: join(outDir, 'gate-reduced-motion-full.png'), fullPage: true });
  console.log('reduced-motion: screenshot saved');
  await ctx.close();
}

// 2) Horizontal-overflow probe at 360/768/1440
for (const w of [360, 768, 1440]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'networkidle' });
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    return {
      scrollW: doc.scrollWidth,
      clientW: doc.clientWidth,
      overflows: doc.scrollWidth > doc.clientWidth,
    };
  });
  console.log(`overflow@${w}: scrollW=${overflow.scrollW} clientW=${overflow.clientW} → ${overflow.overflows ? 'FAIL' : 'ok'}`);
  await ctx.close();
}

// 3) Keyboard-tab pass — tab through everything; count focusables that
// receive a visible outline; screenshot mid-pass focus state.
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'networkidle' });
  const results = [];
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab');
    const info = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const cs = getComputedStyle(el);
      const hasOutline = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth || '0') > 0;
      return {
        tag: el.tagName.toLowerCase(),
        text: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 34),
        hasOutline,
      };
    });
    if (info) results.push(info);
    if (i === 3) {
      await page.screenshot({ path: join(outDir, 'gate-focus-ring.png') });
    }
  }
  const noRing = results.filter((r) => !r.hasOutline);
  console.log(`tab-pass: ${results.length} stops, ${noRing.length} without visible outline`);
  for (const r of noRing.slice(0, 8)) console.log(`  no-ring: <${r.tag}> ${r.text}`);
  await ctx.close();
}

await browser.close();
