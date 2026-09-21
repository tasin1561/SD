#!/usr/bin/env bash
# Hero renders against an EXISTING preview build: 360/768/1440 × light/dark,
# the quote and book tabs, plus the chrome at 360/1440 (drawer, contact fan,
# bottom bar). ONE static server on $PORT, killed on every exit path.
set -euo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PORT="${PORT:-3997}"
if ss -ltn 2>/dev/null | grep -q ":${PORT} "; then echo "port ${PORT} is busy — refusing to start"; exit 2; fi
OUT="scripts/screenshots/hero"; mkdir -p "$OUT"
SERVER_PID=""
cleanup() { if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then kill "$SERVER_PID" 2>/dev/null || true; sleep 1; kill -9 "$SERVER_PID" 2>/dev/null || true; fi; }
trap cleanup EXIT INT TERM
node ../../scripts/serve-static.mjs out "$PORT" > "$OUT/serve.log" 2>&1 & SERVER_PID=$!
for i in $(seq 1 30); do sleep 1; curl -s -o /dev/null -w '%{http_code}' "http://localhost:${PORT}/" | grep -q 200 && break; done
node - "$PORT" "$OUT" <<'JS'
const { chromium } = require('playwright');
const [port, out] = process.argv.slice(2);
(async () => {
  const browser = await chromium.launch();
  const sizes = [[360, 780], [768, 1024], [1440, 900]];
  for (const theme of ['dark', 'light']) {
    for (const [w, h] of sizes) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: w < 500, hasTouch: w < 500, deviceScaleFactor: 1 });
      await ctx.addInitScript((t) => localStorage.setItem('sd-theme', t), theme);
      const page = await ctx.newPage();
      await page.goto(`http://localhost:${port}/`, { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(2600); // the map starts on idle; let a few parcels fly
      await page.screenshot({ path: `${out}/hero-${w}-${theme}.png` });
      if (w === 1440) {
        await page.getByRole('tab', { name: 'Get a quote' }).click();
        await page.waitForTimeout(400);
        await page.getByRole('button', { name: /India.*Bangladesh/ }).click();
        await page.locator('.hero-card .mi-para__btn').click();
        await page.waitForTimeout(2900);
        await page.screenshot({ path: `${out}/hero-${w}-${theme}-quote.png` });
        await page.getByRole('tab', { name: 'Book a shipment' }).click();
        await page.waitForTimeout(1200);
        await page.screenshot({ path: `${out}/hero-${w}-${theme}-book.png` });
        await page.locator('.mi-fan__toggle').click();
        await page.waitForTimeout(700);
        await page.screenshot({ path: `${out}/chrome-1440-${theme}-contact.png` });
      }
      if (w === 360) {
        await page.getByRole('button', { name: 'Open menu' }).click();
        await page.waitForTimeout(350);
        await page.screenshot({ path: `${out}/chrome-360-${theme}-drawer.png` });
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
        await page.locator('nav[aria-label="Quick actions"] [role=tab]').nth(3).click();
        await page.waitForTimeout(700);
        await page.screenshot({ path: `${out}/chrome-360-${theme}-contact.png` });
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
        await page.getByRole('tab', { name: 'Get a quote' }).click();
        await page.waitForTimeout(400);
        await page.screenshot({ path: `${out}/hero-360-${theme}-quote.png` });
        await page.getByRole('tab', { name: 'Book a shipment' }).click();
        await page.waitForTimeout(1200);
        await page.screenshot({ path: `${out}/hero-360-${theme}-book.png` });
      }
      await ctx.close();
    }
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
JS
echo "== done → $OUT"; ls "$OUT" | wc -l
