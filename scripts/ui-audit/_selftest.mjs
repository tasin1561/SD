/*
  Proof that the `overlap` rule still catches the bug it was written
  for. The seller header is FIXED now, so the live page cannot show it
  any more — the reproduction injects the old CSS back over the real
  page and asserts the rule fires, then removes it and asserts it stops.
  A rule that went quiet because it stopped looking reads exactly like a
  rule that went quiet because the bug was fixed.
*/
import { chromium } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { probe } from './audit.mjs';

spawnSync('node', ['scripts/tutorials/lib/clear-login-throttle.mjs'], { stdio: 'ignore' });
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();
await p.goto('http://127.0.0.1:3003/login', { waitUntil: 'domcontentloaded' });
await p.getByLabel(/email/i).first().fill('demo@rangpursilk.test');
await p
  .getByLabel(/password/i)
  .first()
  .fill('Skydrop-Demo-2026');
await p
  .getByRole('button', { name: /sign in|log in/i })
  .first()
  .click();
await p.waitForURL(/\/dashboard/, { timeout: 30000 });
await p.waitForTimeout(1500);

const clean = await p.evaluate(probe);
const cleanOverlaps = clean.findings.filter((f) => f.kind === 'overlap');

// The exact shape the fix removed: the right side starved to a zero
// basis while its contents refuse to shrink, so they spill left over
// whatever the centre holds.
await p.addStyleTag({
  content: `@media (min-width: 1024px){
    .sk-top__right{flex:1 1 0 !important;min-width:auto !important}
    .sk-top__desktop{flex:none !important}
    .sk-top__center{flex:none !important}
  }`,
});
await p.waitForTimeout(400);
const broken = await p.evaluate(probe);
const brokenOverlaps = broken.findings.filter((f) => f.kind === 'overlap');

console.log(`fixed page : ${cleanOverlaps.length} overlap finding(s)`);
for (const f of cleanOverlaps) console.log('   ' + f.detail);
console.log(`old CSS    : ${brokenOverlaps.length} overlap finding(s)`);
for (const f of brokenOverlaps) console.log('   ' + f.detail);

// ── The FRAME signal, which decides whether a clean page was a page ──
//
// `main()` counts an `(authed)` route reporting `shell !== true` as NOT
// MEASURED. The field means "a recognised Skydrop frame rendered" — the
// signed-in app shell OR the shared sign-in frame — so the two live
// pages below must BOTH report true, and something that is not one of
// our pages at all must report false. Proving the positive case alone
// would pass a field hard-coded to `true`, which is the whole failure
// this guard exists to catch, applied to the guard.
await p.goto('http://127.0.0.1:3003/dashboard', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(800);
const onApp = (await p.evaluate(probe)).shell;
await p.context().clearCookies();
await p.goto('http://127.0.0.1:3003/login', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(800);
const onLogin = (await p.evaluate(probe)).shell;
await p.setContent('<!doctype html><title>t</title><p>Not one of our pages.</p>');
const onNothing = (await p.evaluate(probe)).shell;
console.log(`\nframe on /dashboard   : ${onApp}      (want true — the app shell)`);
console.log(`frame on /login       : ${onLogin}      (want true — the sign-in frame)`);
console.log(`frame on a bare page  : ${onNothing}     (want false — neither)`);

// ── `escapes-parent` vs a negative margin ─────────────────────────────
//
// A negative margin is the author saying "extend past my box", and the
// admin dashboard's (i) uses one to grow a 28px control to a 44px tap
// area without moving the layout — 78 correct findings in one sweep.
// The exemption must cover exactly that and nothing wider, so this
// builds both: a child pulled out by its own margin (skip) and the same
// child pulled out FURTHER than its margin explains (report).
await p.setContent(`<!doctype html><title>t</title><body style="margin:0">
  <div id="wrap" style="display:inline-block;width:120px">
    <button id="tap" style="width:136px;height:44px;margin:0 -8px">i</button>
  </div>
  <div id="wrap2" style="display:inline-block;width:40px;border:1px solid #333">
    <button id="over" style="width:200px;height:44px;margin:0 -8px">spills</button>
  </div>
  <div id="wrap3" style="display:inline-block;width:40px">
    <span id="text" style="white-space:nowrap">no margin, nowrap, spills out</span>
  </div>
</body>`);
const esc = (await p.evaluate(probe)).findings.filter((f) => f.kind === 'escapes-parent');
const onTap = esc.filter((f) => f.detail.includes('"i"')).length;
const onOver = esc.filter((f) => f.detail.includes('"spills"')).length;
const onText = esc.filter((f) => f.detail.includes('no margin')).length;
console.log(`\nescapes-parent, tap box past a bare anchor : ${onTap} finding(s)  (want 0)`);
console.log(`escapes-parent, past a parent WITH an edge : ${onOver} finding(s)  (want 1)`);
console.log(`escapes-parent, no margin, bare parent     : ${onText} finding(s)  (want 1)`);

const ok =
  cleanOverlaps.length === 0 &&
  brokenOverlaps.length > 0 &&
  onApp === true &&
  onLogin === true &&
  onNothing === false &&
  onTap === 0 &&
  onOver === 1 &&
  onText === 1;
console.log(
  ok
    ? '\nPASS — the overlap rule is quiet because the bug is gone, not because it\n' +
        '       stopped looking; and a measured page can be told from one that was\n' +
        '       never a Skydrop page at all.'
    : '\nFAIL — one of the two checks no longer distinguishes what it claims to.',
);
await b.close();
process.exit(ok ? 0 : 1);
