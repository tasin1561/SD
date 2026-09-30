/**
 * Sign in as the demo seller and photograph one screen.
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
 *
 * It writes NOTHING and presses nothing — the one thing it does is sign
 * in, which costs one of the five attempts the seller login allows per
 * fifteen minutes. Clear the counter with `lib/clear-login-throttle.mjs`
 * if a take is refused afterwards.
 */
import { chromium } from '@playwright/test';
import { VERIFY_DIR } from './lib/paths.mjs';
import path from 'node:path';
import fs from 'node:fs/promises';

const BASE_URL = process.env.SELLER_APP_URL ?? 'http://127.0.0.1:3003';
const SELLER = {
  email: process.env.DEMO_SELLER_EMAIL ?? 'demo@rangpursilk.test',
  password: process.env.DEMO_SELLER_PASSWORD ?? 'Skydrop-Demo-2026',
};

const route = process.argv[2] ?? '/dashboard';
await fs.mkdir(VERIFY_DIR, { recursive: true });
const out = process.argv[3] ?? path.join(VERIFY_DIR, 'peek.png');

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

await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded' });
await page.getByLabel(/email/i).first().fill(SELLER.email);
await page
  .getByLabel(/password/i)
  .first()
  .fill(SELLER.password);
await page
  .getByRole('button', { name: /sign in|log in/i })
  .first()
  .click();
await page.waitForURL(/\/dashboard/, { timeout: 30_000 });

await page.goto(`${BASE_URL}${route}`, { waitUntil: 'domcontentloaded' });
await page.waitForLoadState('networkidle').catch(() => {});
await page.waitForTimeout(2500);
await page.screenshot({ path: out, fullPage: true });

console.log(await page.locator('body').innerText());
console.log(`\n  shot → ${out}`);

await context.close();
await browser.close();
