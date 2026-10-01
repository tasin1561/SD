/**
 * Sign in and photograph one screen — the seller app, or the admin one.
 *
 * WHY THIS IS A COMMITTED TOOL AND NOT A SCRATCH FILE. Every agent who
 * has added to this library has written some version of it, because the
 * library's whole discipline rests on LOOKING at the page before writing
 * a word of narration about it — the curriculum's own rule is "read what
 * a form OPENS ON before writing what the video does to it", and there is
 * no way to do that from the source alone. The throwaway version also
 * has a way of being committed by accident, which is how the B4/B5
 * commit turned CI red on `format:check` (2026-09-30).
 *
 * It signs in, goes where it is told, waits for the network to go quiet,
 * writes a FULL-PAGE png and prints the page's text so a narration line
 * can quote the screen rather than paraphrase it.
 *
 *   node scripts/tutorials/peek.mjs /orders
 *   node scripts/tutorials/peek.mjs '/orders?search=RSH-LIFE-DELIVERED' out.png
 *   node scripts/tutorials/peek.mjs --admin /system-issues
 *   node scripts/tutorials/peek.mjs --admin --routes /topups /withdrawals /pnl
 *
 * `--routes` takes SEVERAL and visits them on ONE sign-in, writing each
 * to `out/verify/peek/<slug>.png` and printing each page's text under a
 * banner. It exists for the survey a tour video needs: P5 walks ten
 * screens, and ten separate peeks would be ten sign-ins against a login
 * throttled at five per fifteen minutes.
 *
 * `--admin` drives apps/admin on :3002 as the tutorial OPS staff user
 * instead (`tutorial-ops@skydrop.local`, which `seed-demo-data.mjs`
 * creates as a SUPER_ADMIN because goods receipts are received by ops
 * rather than by the seller). The two apps are the same shape — a
 * `/login` with an Email and a Password and a Sign in button, landing on
 * `/dashboard` — so this is one flag rather than a second script; FE-5
 * is the reason, and it is the same reason `@skydrop/auth` needed no
 * changes for the second frontend.
 *
 * It writes NOTHING and presses nothing — the one thing it does is sign
 * in, which costs one of the five attempts a login allows per fifteen
 * minutes. Clear the counter with `lib/clear-login-throttle.mjs` if a
 * take is refused afterwards; that helper clears BOTH apps' counters,
 * because they are the only non-BullMQ keys in the local Redis.
 */
import { chromium } from '@playwright/test';
import { VERIFY_DIR } from './lib/paths.mjs';
import { resolveStack } from './lib/stacks.mjs';
import path from 'node:path';
import fs from 'node:fs/promises';

const args = process.argv.slice(2);
const admin = args[0] === '--admin';
if (admin) args.shift();

/** Which stack's console. Required, like everywhere else — see `lib/stacks.mjs`. */
const STACK = resolveStack();

const APP = admin
  ? {
      base: process.env.ADMIN_APP_URL ?? STACK.admin.url,
      email: process.env.TUTORIAL_OPS_EMAIL ?? 'tutorial-ops@skydrop.local',
      password: process.env.TUTORIAL_OPS_PASSWORD ?? 'Tutorial-Ops-2026',
    }
  : {
      base: process.env.SELLER_APP_URL ?? STACK.seller.url,
      email: process.env.DEMO_SELLER_EMAIL ?? 'demo@rangpursilk.test',
      password: process.env.DEMO_SELLER_PASSWORD ?? 'Skydrop-Demo-2026',
    };

const tour = args[0] === '--routes';
if (tour) args.shift();
const routes = tour ? args : [args[0] ?? '/dashboard'];
if (routes.length === 0) throw new Error('--routes needs at least one route');
await fs.mkdir(VERIFY_DIR, { recursive: true });
const tourDir = path.join(VERIFY_DIR, 'peek');
if (tour) await fs.mkdir(tourDir, { recursive: true });

/** A route as a filename: `/warehouse/bins?x=1` → `warehouse-bins`. */
function shotPath(route) {
  const slug =
    route
      .split('?')[0]
      .replace(/^\/|\/$/g, '')
      .replace(/\//g, '-') || 'root';
  return path.join(tourDir, `${slug}.png`);
}

const browser = await chromium.launch();
// The same context the recorder uses, so what this shows is what a take
// would film — a different colour scheme or locale would make the
// screenshot a picture of a page nobody records.
const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
  colorScheme: 'dark',
  locale: 'en-IN',
  timezoneId: 'Asia/Dhaka',
});
const page = await context.newPage();
page.setDefaultTimeout(30_000);

await page.goto(`${APP.base}/login`, { waitUntil: 'domcontentloaded' });
await page.getByLabel(/email/i).first().fill(APP.email);
await page
  .getByLabel(/password/i)
  .first()
  .fill(APP.password);
await page
  .getByRole('button', { name: /sign in|log in/i })
  .first()
  .click();
await page.waitForURL(/\/dashboard/, { timeout: 30_000 });

for (const route of routes) {
  const out = tour
    ? shotPath(route)
    : (args[1] ?? path.join(VERIFY_DIR, admin ? 'peek-admin.png' : 'peek.png'));
  await page.goto(`${APP.base}${route}`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(2500);
  await page.screenshot({ path: out, fullPage: true });

  if (tour) console.log(`\n${'='.repeat(70)}\n  ${route}\n${'='.repeat(70)}`);
  console.log(await page.locator('body').innerText());
  console.log(`\n  shot → ${out}`);
}

await context.close();
await browser.close();
