#!/usr/bin/env bash
# One preview build, ONE static server, then: gallery renders (both themes),
# gallery spec, chrome renders at 360/1440 (both themes), swatch renders,
# per-pattern videos → $VIDEO_DIR (if set). Server killed on every exit path.
set -euo pipefail
cd "$(dirname "$0")/../.."
PORT="${PORT:-3997}"
if ss -ltn 2>/dev/null | grep -q ":${PORT} "; then echo "port ${PORT} is busy — refusing to start"; exit 2; fi
OUT="scripts/screenshots/swatches"; mkdir -p "$OUT"
SERVER_PID=""
cleanup() { if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then kill "$SERVER_PID" 2>/dev/null || true; sleep 1; kill -9 "$SERVER_PID" 2>/dev/null || true; fi; }
trap cleanup EXIT INT TERM
echo "== preview build"; pnpm build:preview > "$OUT/build-preview.log" 2>&1 || { tail -40 "$OUT/build-preview.log"; exit 1; }
node ../../scripts/serve-static.mjs out "$PORT" > "$OUT/serve.log" 2>&1 & SERVER_PID=$!
for i in $(seq 1 30); do sleep 1; curl -s -o /dev/null -w '%{http_code}' "http://localhost:${PORT}/dev/motion" | grep -q 200 && break; done
node - "$PORT" "$OUT" <<'JS'
const { chromium } = require('playwright');
const [port, out] = process.argv.slice(2);
(async () => {
  const browser = await chromium.launch();
  for (const theme of ['light', 'dark']) {
    // gallery
    let ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
    await ctx.addInitScript((t) => localStorage.setItem('sd-theme', t), theme);
    let page = await ctx.newPage();
    await page.goto(`http://localhost:${port}/dev/motion`, { waitUntil: 'networkidle' });
    await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); } window.scrollTo(0, 0); });
    await page.locator('[data-pattern="rolling-label-button"] button').first().click();
    await page.locator('[data-pattern="van-drive-off"] button[type=submit]').first().click();
    await page.locator('[data-pattern="parachute-progress"] .mi-para__btn').first().click();
    await page.locator('[data-pattern="liquid-bead"] .mi-bead--pill [role=tab]').nth(3).click();
    await page.locator('[data-pattern="liquid-bead"] .mi-bead--icon [role=tab]').nth(2).click();
    await page.locator('[data-pattern="segmented-code"] input').first().focus();
    await page.keyboard.type('560001');
    await page.locator('[data-pattern="touches"] .mi-check').click();
    await page.waitForTimeout(1700);
    await page.locator('[data-pattern="contact-fan"] .mi-fan__toggle').click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${out}/gallery-${theme}.png`, fullPage: true });
    // the four scenes of the switcher, in this theme
    for (let i = 0; i < 4; i++) {
      await page.locator('[data-pattern="scene-switcher"] [role=tab]').nth(i).click();
      await page.waitForTimeout(700);
      await page.locator('[data-pattern="scene-switcher"] .mi-scene').screenshot({ path: `${out}/scene-${i + 1}-${theme}.png` });
    }
    await ctx.close();
    // swatches
    ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript((t) => localStorage.setItem('sd-theme', t), theme);
    page = await ctx.newPage();
    await page.goto(`http://localhost:${port}/dev/swatches`, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `${out}/swatches-${theme}.png`, fullPage: true });
    await page.locator('#dark-tints').screenshot({ path: `${out}/tints-${theme}.png` });
    await page.locator('#type').screenshot({ path: `${out}/type-${theme}.png` });
    await ctx.close();
    // chrome
    for (const [w, h, tag] of [[360, 780, '360'], [320, 568, '320'], [1440, 900, '1440']]) {
      const c2 = await browser.newContext({ viewport: { width: w, height: h }, isMobile: w < 500, hasTouch: w < 500 });
      await c2.addInitScript((t) => localStorage.setItem('sd-theme', t), theme);
      const p2 = await c2.newPage();
      await p2.goto(`http://localhost:${port}/`, { waitUntil: 'networkidle' });
      await p2.evaluate(() => document.fonts.ready);
      await p2.waitForTimeout(400);
      await p2.screenshot({ path: `${out}/chrome-${tag}-${theme}.png` });
      if (w < 500) {
        await p2.getByRole('button', { name: 'Open menu' }).click();
        await p2.waitForTimeout(350);
        await p2.screenshot({ path: `${out}/chrome-${tag}-${theme}-drawer.png` });
        await p2.keyboard.press('Escape');
        await p2.waitForTimeout(300);
        await p2.locator('nav[aria-label="Quick actions"] [role=tab]').nth(3).click();
        await p2.waitForTimeout(700);
        await p2.screenshot({ path: `${out}/chrome-${tag}-${theme}-contact.png` });
      } else {
        await p2.locator('.mi-fan__toggle').click();
        await p2.waitForTimeout(700);
        await p2.screenshot({ path: `${out}/chrome-${tag}-${theme}-contact.png` });
      }
      await c2.close();
    }
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
JS
echo "== gallery spec"
( cd ../.. && E2E_DEV_ROUTES=1 npx playwright test -c apps/marketing/playwright.static.config.ts apps/marketing/e2e/gallery.spec.ts --reporter=list 2>&1 | tail -6 ) || true
if [ -n "${VIDEO_DIR:-}" ]; then echo "== videos → $VIDEO_DIR"; node scripts/screenshots/record-videos.mjs "$PORT" "$VIDEO_DIR" | tail -20; fi
