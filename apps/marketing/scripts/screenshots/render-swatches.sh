#!/usr/bin/env bash
# Preview-build the marketing app (dev routes ON, ribbon ON), serve `out/` on
# a checked port, render: /dev/swatches (full page, type section, dark tint
# panels) and the site chrome (`/` at 360 and 1440) in BOTH themes, print the
# heading-font proof, then kill the server — ALWAYS, via trap — and prove a
# plain build has no /dev/ and no ribbon. Never `next dev`; one server.
set -euo pipefail
cd "$(dirname "$0")/../.."
PORT="${PORT:-3999}"
if ss -ltn 2>/dev/null | grep -q ":${PORT} "; then echo "port ${PORT} is busy — refusing to start"; exit 2; fi
OUT="scripts/screenshots/swatches"; mkdir -p "$OUT"
SERVER_PID=""
cleanup() { if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then kill "$SERVER_PID" 2>/dev/null || true; sleep 1; kill -9 "$SERVER_PID" 2>/dev/null || true; fi; }
trap cleanup EXIT INT TERM
echo "== preview build (dev routes + ribbon on)"; pnpm build:preview > "$OUT/build-preview.log" 2>&1 || { tail -40 "$OUT/build-preview.log"; exit 1; }
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
    await page.waitForTimeout(400);
    const proof = await page.evaluate(() => {
      const rows = [];
      for (const card of document.querySelectorAll('[data-specimen]')) {
        const h1 = card.querySelector('h1'); const p = card.querySelector('p.text-base');
        rows.push(`${card.getAttribute('data-specimen')}: h1 → ${getComputedStyle(h1).fontFamily.split(',').slice(0,2).join(',')} | body → ${getComputedStyle(p).fontFamily.split(',').slice(0,2).join(',')} | stat → ${getComputedStyle(card.querySelector('.tabular')).fontVariantNumeric}`);
      }
      rows.push(`page h1 (global, layout face) → ${getComputedStyle(document.querySelector('main > header h1')).fontFamily.split(',').slice(0,2).join(',')}`);
      return rows;
    });
    console.log(`[${theme}] ` + proof.join('\n' + ' '.repeat(theme.length + 3)));
    await page.screenshot({ path: `${out}/swatches-${theme}.png`, fullPage: true });
    await page.locator('#type').screenshot({ path: `${out}/type-${theme}.png` });
    await page.locator('#dark-tints').screenshot({ path: `${out}/tints-${theme}.png` });
    await ctx.close();
    // chrome renders: the landing page at phone and desktop widths
    for (const [w, h, tag] of [[360, 780, '360'], [1440, 900, '1440']]) {
      const c2 = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: w < 500, hasTouch: w < 500 });
      await c2.addInitScript((t) => { localStorage.setItem('sd-theme', t); }, theme);
      const p2 = await c2.newPage();
      await p2.goto(`http://localhost:${port}/`, { waitUntil: 'networkidle' });
      await p2.evaluate(() => document.fonts.ready);
      await p2.waitForTimeout(400);
      await p2.screenshot({ path: `${out}/chrome-${tag}-${theme}.png` });
      if (w < 500) {
        await p2.getByRole('button', { name: 'Open menu' }).click();
        await p2.waitForTimeout(300);
        await p2.screenshot({ path: `${out}/chrome-${tag}-${theme}-drawer.png` });
        await p2.keyboard.press('Escape');
      }
      await p2.getByRole('button', { name: 'Contact us' }).click();
      await p2.waitForTimeout(250);
      await p2.screenshot({ path: `${out}/chrome-${tag}-${theme}-contact.png` });
      await c2.close();
    }
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
JS
cleanup; SERVER_PID=""
echo "== plain build (dev routes OFF) — must contain no /dev/ and no ribbon"
pnpm build > "$OUT/build-plain.log" 2>&1 || { tail -60 "$OUT/build-plain.log"; exit 1; }
if [ -e out/dev ]; then echo "FAIL: out/dev exists after a plain build"; exit 1; fi
grep -rl "Swatches, tokens and type specimens" out/ && { echo "FAIL: swatch page text leaked into out/"; exit 1; }
grep -rl "data-placeholder-ribbon\|Preview build — placeholder" out/ && { echo "FAIL: ribbon leaked into a plain build"; exit 1; }
echo "OK: no out/dev, no swatch text, no ribbon after plain build"
grep -E "check:theme|check:bundle|^(OK  |FAIL|info)|First Load JS|^┌|^├ ○|^└ ○" "$OUT/build-plain.log" | head -30
