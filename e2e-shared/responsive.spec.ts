import { test, expect } from '@playwright/test';

/**
 * Layout at phone widths, checked in a real browser — for EVERY
 * frontend project.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────
 * Both app shells were `grid-cols-[220px_1fr]` at every width. On a
 * 360px phone that left 140px of content and EVERY page in both apps
 * overflowed the viewport by exactly 122px — for months, with nothing
 * failing. A browser job that only loads a page and asserts it rendered
 * cannot see this: the HTML is fine, the styles apply, and the page
 * simply scrolls sideways.
 *
 * So the check is not "does it render" but "does the page fit". It
 * lives in `e2e-shared/` for the same reason the CSP spec does — a
 * fourth frontend should inherit it rather than have to remember it.
 *
 * ── WHAT IT ASSERTS ──────────────────────────────────────────────────
 * 1. No horizontal document scroll, at four widths down to 320px (the
 *    narrowest phone still in real use). This is the one that catches
 *    the class of bug above.
 * 2. Every control clears 30px on a touch viewport. Inline links inside
 *    running text are exempt — WCAG 2.5.8 exempts inline targets, and
 *    inflating them would break the line box.
 * 3. Inputs render at ≥16px on a touch device. Under 16px, mobile
 *    Safari zooms the page on focus and does not zoom back out. The
 *    apps' `text-sm` is 15px (13px before the 2026-08-18 scale lift) —
 *    still under the threshold either way, which is why the coarse-
 *    pointer rule in tokens.css forces 16px rather than relying on the
 *    scale being large enough.
 *
 * ── COVERAGE, HONESTLY ───────────────────────────────────────────────
 * Unauthenticated pages only, unless credentials are supplied. Most of
 * the fix lives in shared rules (`sd-field`, the control floor, page
 * padding, the modal sheet) which the login page does exercise — but
 * the shell and the table card layout are behind auth. Set
 * `E2E_ADMIN_EMAIL` / `E2E_ADMIN_PASSWORD` (and the SELLER pair) to
 * extend the sweep over the authed routes; CI does not seed a login,
 * so there it runs the unauthenticated half.
 */

/**
 * Pages each project serves without a session.
 *
 * A list rather than one page, because marketing's two routes are
 * different layout problems: the landing page is a long scroll of
 * hand-built sections, and `/request-invite` is the only public FORM in
 * the estate — which makes it the only place the 16px iOS-zoom rule
 * below can bite outside an authenticated app.
 */
const PUBLIC_ENTRY: Record<string, readonly string[]> = {
  admin: ['/login'],
  seller: ['/login'],
  track: ['/'],
  marketing: ['/', '/request-invite'],
};

/**
 * Authed routes worth sweeping when credentials exist. One page per
 * layout shape rather than all 80 — a list, a detail, a form, a
 * settings page and a dashboard cover every primitive between them.
 */
const AUTHED_ROUTES: Record<string, readonly string[]> = {
  admin: ['/dashboard', '/orders', '/settings', '/staff', '/fx', '/reports'],
  seller: ['/dashboard', '/orders', '/orders/new', '/wallet', '/settings', '/products'],
};

const WIDTHS = [320, 360, 414, 768] as const;

type Finding = { readonly kind: string; readonly detail: string };

/**
 * Runs in the page. Returns what is wrong rather than a boolean, so a
 * failure names the element instead of just the width.
 */
function probe(): { overflowBy: number; findings: Finding[] } {
  const doc = document.documentElement;
  const vw = doc.clientWidth;
  const overflowBy = doc.scrollWidth - vw;
  const findings: Finding[] = [];

  if (overflowBy > 0) {
    // Report the OUTERMOST offenders only — a wide table reports every
    // one of its cells otherwise, and the cells are not the bug.
    for (const el of Array.from(document.querySelectorAll('*'))) {
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.right <= vw + 2) continue;
      const parent = el.parentElement;
      if (parent && parent.getBoundingClientRect().right > vw + 2) continue;
      const cls = (el.className?.toString() ?? '').split(' ').slice(0, 4).join('.');
      findings.push({
        kind: 'overflow',
        detail: `<${el.tagName.toLowerCase()} class="${cls}"> is ${Math.round(rect.width)}px wide, ending ${Math.round(rect.right - vw)}px past the viewport`,
      });
      if (findings.length >= 4) break;
    }
  }

  const touch = window.matchMedia('(pointer: coarse)').matches;
  if (touch) {
    const controls = document.querySelectorAll<HTMLElement>(
      'button, select, textarea, a[href], input:not([type=hidden]):not([type=checkbox]):not([type=radio])',
    );
    for (const el of Array.from(controls)) {
      const rect = el.getBoundingClientRect();
      if (rect.width < 3 || rect.height < 3) continue;
      // The Button primitive extends its hit area via ::after, which
      // getBoundingClientRect does not see.
      if (el.classList.contains('skydrop-hit')) continue;
      const style = getComputedStyle(el);
      // WCAG 2.5.8 exempts a target inline in a sentence.
      if (el.tagName === 'A' && style.display === 'inline') continue;
      const label = (el.textContent ?? el.getAttribute('aria-label') ?? '').trim().slice(0, 24);
      if (rect.height < 30 || rect.width < 20) {
        findings.push({
          kind: 'target',
          detail: `<${el.tagName.toLowerCase()}> "${label}" is ${Math.round(rect.width)}×${Math.round(rect.height)}px`,
        });
      }
      if (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') {
        const px = Number.parseFloat(style.fontSize);
        if (Number.isFinite(px) && px < 16) {
          findings.push({
            kind: 'ios-zoom',
            detail: `<${el.tagName.toLowerCase()}> "${label}" renders at ${px}px — under 16px, focusing it zooms mobile Safari`,
          });
        }
      }
    }
  }

  return { overflowBy, findings: findings.slice(0, 8) };
}

function credentialsFor(project: string): { email: string; password: string } | null {
  const email = process.env[`E2E_${project.toUpperCase()}_EMAIL`];
  const password = process.env[`E2E_${project.toUpperCase()}_PASSWORD`];
  return email !== undefined && password !== undefined ? { email, password } : null;
}

test.describe('responsive layout', () => {
  for (const width of WIDTHS) {
    test(`fits and stays tappable at ${width}px`, async ({ browser }, testInfo) => {
      const project = testInfo.project.name;
      const baseURL = testInfo.project.use.baseURL;
      const context = await browser.newContext({
        baseURL,
        viewport: { width, height: 780 },
        // Below the `md` breakpoint the apps are being used on a phone,
        // so the touch rules are the ones that apply.
        hasTouch: width < 768,
        isMobile: width < 768,
      });
      const page = await context.newPage();

      const routes: string[] = [...(PUBLIC_ENTRY[project] ?? ['/'])];
      const creds = credentialsFor(project);
      if (creds !== null && AUTHED_ROUTES[project] !== undefined) {
        await page.goto('/login', { waitUntil: 'networkidle' });
        await page.fill('input[type=email]', creds.email);
        await page.fill('input[type=password]', creds.password);
        await page.click('button[type=submit]');
        await page.waitForURL(/dashboard/, { timeout: 30_000 });
        routes.push(...(AUTHED_ROUTES[project] ?? []));
      }

      const problems: string[] = [];
      for (const route of routes) {
        await page.goto(route, { waitUntil: 'networkidle' });
        // Tables stamp their column labels after mount; give the
        // observer a frame before measuring.
        await page.waitForTimeout(400);
        const { overflowBy, findings } = await page.evaluate(probe);
        for (const f of findings) {
          problems.push(`  ${route} [${f.kind}] ${f.detail}`);
        }
        expect(
          overflowBy,
          `${route} scrolls horizontally by ${overflowBy}px at ${width}px wide`,
        ).toBeLessThanOrEqual(0);
      }

      expect(problems, `at ${width}px:\n${problems.join('\n')}`).toEqual([]);
      await context.close();
    });
  }
});
