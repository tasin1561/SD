#!/usr/bin/env node
/**
 * Screenshot every page of one product app — the apps restyle's before/after
 * record (feat/apps-premium-restyle).
 *
 * Lists the app's pages from the file system (every `page.tsx` under
 * `src/app`, route groups stripped), fills dynamic segments from an ids file,
 * signs in once, and captures each page at three variants:
 *   1440 light · 1440 dark · 390 light  (full page)
 *
 * It only READS pages; it never clicks anything past the sign-in form.
 * Against a LOCAL stack only (API on 127.0.0.1, `next start` of the built
 * app on localhost). Output is gitignored.
 *
 *   node scripts/screenshots/apps-capture.mjs \
 *     --app seller --base http://localhost:3003 --ids ids.json \
 *     --out screenshots/apps-restyle/seller/before \
 *     [--email seller@test.local --password Test-Seller-1234]
 *     [--only '/orders/[id],/wallet']   (re-take just these routes)
 */
import { chromium } from '@playwright/test';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1]]);
    return acc;
  }, []),
);
const APP = args.app;
const BASE = args.base;
const OUT = args.out;
const IDS = args.ids ? JSON.parse(readFileSync(args.ids, 'utf8')) : {};
if (!APP || !BASE || !OUT) throw new Error('--app, --base and --out are required');
if (!/^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(BASE)) {
  throw new Error('apps-capture runs against a local server only');
}

// Dynamic route → the id that fills it. A route with no entry (or a null
// id) is SKIPPED and reported, never guessed.
const FILL = {
  seller: {
    '/orders/[id]': () => `/orders/${IDS.order}`,
    '/orders/[id]/edit': () => `/orders/${IDS.orderEdit}/edit`,
    '/tickets/[id]': () => `/tickets/${IDS.ticket}`,
    '/products/[id]': () => `/products/${IDS.product}`,
    '/products/[id]/variants/[variantId]': () => `/products/${IDS.product}/variants/${IDS.variant}`,
    '/inbound/[id]': () => `/inbound/${IDS.consignment}`,
    '/reseller-stores/[storeId]': () => `/reseller-stores/${IDS.store}`,
  },
  admin: {
    '/orders/[id]': () => `/orders/${IDS.order}`,
    '/sellers/[id]': () => `/sellers/${IDS.sellerId}`,
    '/tickets/[id]': () => `/tickets/${IDS.ticket}`,
    '/seller-wallets/[id]': () => `/seller-wallets/${IDS.sellerId}`,
    '/warehouse/bins/[binId]': () => `/warehouse/bins/${IDS.bin}`,
    '/warehouse/consignments/[id]': () => `/warehouse/consignments/${IDS.consignment}`,
    '/warehouse/receive/[id]': () => `/warehouse/receive/${IDS.goodsReceipt}`,
    '/warehouse/manifests/[id]': () => `/warehouse/manifests/${IDS.manifest}`,
    '/reseller-stores/[storeId]': () => `/reseller-stores/${IDS.store}`,
  },
  reseller: {},
  track: {
    '/[awb]': () => `/${IDS.awb}`,
  },
};

function listRoutes(appDir) {
  const root = join(appDir, 'src', 'app');
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        if (name === 'api' || name.startsWith('_')) continue;
        walk(p);
      } else if (name === 'page.tsx') {
        const segs = relative(root, dir)
          .split(sep)
          .filter((s) => s && !(s.startsWith('(') && s.endsWith(')')));
        out.push('/' + segs.join('/'));
      }
    }
  };
  walk(root);
  return [...new Set(out)].sort();
}

const slug = (route) => (route === '/' ? 'root' : route.slice(1).replace(/[/[\]]+/g, '_'));

const VARIANTS = [
  { key: '1440-light', width: 1440, height: 900, theme: 'light' },
  { key: '1440-dark', width: 1440, height: 900, theme: 'dark' },
  { key: '390-light', width: 390, height: 844, theme: 'light' },
];

async function main() {
  mkdirSync(OUT, { recursive: true });
  const routes = listRoutes(join(process.cwd(), 'apps', APP));
  const fill = FILL[APP] ?? {};
  const plan = [];
  const skipped = [];
  for (const r of routes) {
    if (!r.includes('[')) {
      plan.push({ route: r, url: r });
      continue;
    }
    const f = fill[r];
    const url = f ? f() : null;
    if (!url || url.includes('null') || url.includes('undefined')) skipped.push(r);
    else plan.push({ route: r, url });
  }
  if (APP === 'track') plan.push({ route: '/[awb] (not found)', url: '/NOT-A-REAL-AWB-0000' });
  // Signed-out pages are captured signed out (a signed-in visit redirects
  // them); the root only ever redirects, so it is not a page to capture.
  const signedOut = (u) => /^\/(login|password-reset|auth)(\/|$)/.test(u);
  const rootIsRedirect = APP !== 'track';
  const only = args.only ? new Set(args.only.split(',')) : null;
  const pages = plan.filter(
    (p) => !(rootIsRedirect && p.url === '/') && (!only || only.has(p.route)),
  );

  const browser = await chromium.launch();
  // Sign in ONCE per app and reuse the session for every variant: the API
  // throttles sign-ins (5 per 15 minutes per email), and three sign-ins per
  // run on top of any other local use trips it.
  let storageState;
  if (args.email) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
    await page.fill('#email', args.email);
    await page.fill('#password', args.password);
    await Promise.all([
      page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 }),
      page.click('button[type=submit]'),
    ]);
    storageState = await ctx.storageState();
    await ctx.close();
  }
  // The refresh cookie ROTATES on a client refresh, and presenting a rotated
  // one again burns the whole session (reuse detection). So the session is
  // carried FORWARD: each variant starts from the state the previous one
  // ended with, never from the state captured at sign-in.
  const results = [];
  const makeContext = async (v, state) => {
    const ctx = await browser.newContext({
      viewport: { width: v.width, height: v.height },
      deviceScaleFactor: 1,
      colorScheme: v.theme,
      ...(v.width < 500 ? { isMobile: true, hasTouch: true } : {}),
      ...(state ? { storageState: state } : {}),
    });
    await ctx.addCookies([
      { name: 'sd-theme', value: v.theme, url: BASE },
      { name: 'lang', value: 'en', url: BASE },
    ]);
    await ctx.addInitScript((t) => {
      try {
        localStorage.setItem('sd-theme', t);
      } catch {}
    }, v.theme);
    return ctx;
  };
  for (const v of VARIANTS) {
    const ctx = await makeContext(v, storageState);
    const outCtx = await makeContext(v, undefined);
    const authedPage = await ctx.newPage();
    const outPage = await outCtx.newPage();
    for (const item of pages) {
      const page = signedOut(item.url) ? outPage : authedPage;
      const file = join(OUT, `${slug(item.route)}__${v.key}.png`);
      let status = 'ok';
      try {
        const res = await page.goto(`${BASE}${item.url}`, { waitUntil: 'load', timeout: 30000 });
        // A page that polls never goes network-idle; give it a bounded wait
        // and take the picture regardless.
        await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(700);
        const landed = new URL(page.url()).pathname;
        if (res && res.status() >= 400) status = `http ${res.status()}`;
        else if (landed !== item.url && !item.url.startsWith(landed)) status = `→ ${landed}`;
        await page.screenshot({ path: file, fullPage: true });
      } catch (e) {
        status = `error ${String(e.message).split('\n')[0].slice(0, 120)}`;
      }
      results.push({ variant: v.key, route: item.route, url: item.url, status });
    }
    if (storageState) storageState = await ctx.storageState();
    await ctx.close();
    await outCtx.close();
  }
  await browser.close();
  // A partial re-take (--only) leaves the full run's index alone.
  if (!only) {
    writeFileSync(join(OUT, 'index.json'), JSON.stringify({ app: APP, skipped, results }, null, 1));
  }
  const bad = results.filter((r) => r.status !== 'ok');
  console.log(
    `${APP}: ${pages.length} pages × ${VARIANTS.length} = ${results.length} shots; ` +
      `${bad.length} not ok; skipped (no local id): ${skipped.join(', ') || 'none'}`,
  );
  for (const b of bad) console.log(`  ${b.variant} ${b.route}: ${b.status}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
