#!/usr/bin/env bash
# Phase 0: preview-build the marketing app (dev routes ON), serve `out/` on a
# free port, screenshot /dev/swatches in both themes, then kill the server —
# ALWAYS, via trap. Never `next dev`; one server at a time; port checked first.
set -euo pipefail
cd "$(dirname "$0")/../.."
PORT="${PORT:-3999}"
if ss -ltn 2>/dev/null | grep -q ":${PORT} "; then echo "port ${PORT} is busy — refusing to start"; exit 2; fi
OUT="scripts/screenshots/swatches"
SERVER_PID=""
cleanup() { if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then kill "$SERVER_PID" 2>/dev/null || true; sleep 1; kill -9 "$SERVER_PID" 2>/dev/null || true; fi; }
trap cleanup EXIT INT TERM
echo "== preview build (dev routes on)"; pnpm build:preview > "$OUT/build-preview.log" 2>&1 || { tail -40 "$OUT/build-preview.log"; exit 1; }
{ test -f out/dev/swatches.html || test -f out/dev/swatches/index.html; } || { echo "preview build produced no out/dev/swatches(.html)"; exit 1; }
node ../../scripts/serve-static.mjs out "$PORT" > "$OUT/serve.log" 2>&1 & SERVER_PID=$!
for i in $(seq 1 30); do sleep 1; curl -s -o /dev/null -w '%{http_code}' "http://localhost:${PORT}/dev/swatches" | grep -q 200 && break; done
node - "$PORT" "$OUT" <<'JS'
const { chromium } = require('playwright');
const [port, out] = process.argv.slice(2);
(async () => {
  const browser = await chromium.launch();
  for (const theme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    await ctx.addInitScript((t) => { localStorage.setItem('sd-theme', t); }, theme);
    const page = await ctx.newPage();
    await page.goto(`http://localhost:${port}/dev/swatches`, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(500);
    const attr = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    await page.screenshot({ path: `${out}/swatches-${theme}.png`, fullPage: true });
    console.log(`${theme}: data-theme=${attr} -> ${out}/swatches-${theme}.png`);
    await ctx.close();
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
JS
cleanup; SERVER_PID=""
echo "== plain build (dev routes OFF) — must contain no /dev/"
pnpm build > "$OUT/build-plain.log" 2>&1 || { tail -40 "$OUT/build-plain.log"; exit 1; }
if [ -e out/dev ]; then echo "FAIL: out/dev exists after a plain build"; ls -R out/dev; exit 1; fi
grep -rl "Swatches and type specimens" out/ && { echo "FAIL: swatch page text leaked into out/"; exit 1; } || echo "OK: no out/dev and no swatch text in out/ after plain build"
grep -E "First Load JS|^┌|^├ ○|^└ ○|/dev" "$OUT/build-plain.log" | head -12
