#!/usr/bin/env bash
# Preview-build, serve out/ on a checked port, screenshot /dev/motion in
# both themes (full page + each pattern mid-state), run the gallery spec
# against the same server, kill it on exit. Never `next dev`.
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
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1 });
    await ctx.addInitScript((t) => localStorage.setItem('sd-theme', t), theme);
    const page = await ctx.newPage();
    await page.goto(`http://localhost:${port}/dev/motion`, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    // scroll the whole page once so the in-view patterns (odometer, connector) arm
    await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); } window.scrollTo(0, 0); });
    // drive the stateful demos mid-way so the render shows motion, not idle
    await page.locator('[data-pattern="rolling-label-button"] button').first().click();
    await page.locator('[data-pattern="van-drive-off"] button[type=submit]').first().click();
    await page.locator('[data-pattern="parachute-progress"] .mi-para__btn').first().click();
    await page.locator('[data-pattern="liquid-bead"] [role=tab]').nth(3).click();
    await page.locator('[data-pattern="segmented-code"] input').first().focus();
    await page.keyboard.type('560001');
    await page.waitForTimeout(1600);
    // the fan closes on any outside pointerdown, so it opens LAST
    await page.locator('[data-pattern="radial-contact-fan"] .mi-fan__toggle').click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${out}/gallery-${theme}.png`, fullPage: true });
    await ctx.close();
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
JS
echo "== gallery spec against the same server"
cd ../.. && E2E_DEV_ROUTES=1 npx playwright test -c apps/marketing/playwright.static.config.ts apps/marketing/e2e/gallery.spec.ts --reporter=list 2>&1 | tail -14 || true
