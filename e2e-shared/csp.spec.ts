import { test, expect } from '@playwright/test';

/**
 * The nonce CSP, checked in a real browser — for EVERY frontend project.
 *
 * ── WHY THIS IS SHARED RATHER THAN PER-APP ───────────────────────────
 * This spec exists because of a bug it would have caught. When the
 * per-request nonce CSP landed, `apps/track`'s no-flash theme script —
 * an inline `<script>` in the root layout — carried no nonce, so the
 * browser refused to execute it. Nothing failed loudly: the page still
 * rendered, because the SSR HTML is fine and only the theme init was
 * blocked. It was found by curling production, which is not a gate.
 *
 * The reason it slipped is that the browser job only covered admin and
 * seller. So the fix is not "add a track spec" — it is to make the CSP
 * check something every project inherits, so a fourth frontend cannot
 * be added without it.
 *
 * ── WHAT IT ASSERTS ──────────────────────────────────────────────────
 * 1. Zero CSP violations in the console. This is the one that catches
 *    the real bug; a violation means something on the page was blocked.
 * 2. The page HYDRATED. A CSP that blocks all scripts still serves
 *    readable HTML, so "it looks right" proves nothing on its own.
 * 3. `script-src` carries a nonce and does NOT carry 'unsafe-inline' —
 *    the guard against someone "fixing" a future violation by widening
 *    the policy back to where it stops nothing.
 */

/** Where each project has a page worth loading. */
const ENTRY: Record<string, string> = {
  admin: '/login',
  seller: '/login',
  track: '/',
};

test.describe('nonce CSP', () => {
  test('the page loads with no CSP violations and actually hydrates', async ({
    page,
  }, testInfo) => {
    const path = ENTRY[testInfo.project.name] ?? '/';
    const violations: string[] = [];
    page.on('console', (msg) => {
      const text = msg.text();
      // Chromium words these as "Refused to …" / "… violates the
      // following Content Security Policy directive".
      if (/Content Security Policy|Refused to (execute|load|apply|connect)/i.test(text)) {
        violations.push(text);
      }
    });

    const response = await page.goto(path, { waitUntil: 'networkidle' });
    expect(response?.status(), `${path} should serve`).toBeLessThan(400);

    expect(violations, `CSP blocked something on ${path}:\n${violations.join('\n')}`).toEqual([]);

    // Next only defines these once its own scripts have run.
    const hydrated = await page.evaluate(
      () =>
        typeof (window as unknown as { __next_f?: unknown }).__next_f !== 'undefined' ||
        document.querySelector('script#__NEXT_DATA__') !== null,
    );
    expect(hydrated, 'the app did not hydrate — scripts were blocked').toBe(true);
  });

  test('script-src is nonce-based, not inline-permissive', async ({ page }, testInfo) => {
    const path = ENTRY[testInfo.project.name] ?? '/';
    const response = await page.goto(path);
    const csp = response?.headers()['content-security-policy'] ?? '';
    expect(csp, 'no CSP header at all').not.toBe('');

    const scriptSrc = /script-src ([^;]*)/.exec(csp)?.[1] ?? '';
    expect(scriptSrc, `script-src missing from: ${csp}`).not.toBe('');
    expect(scriptSrc).toMatch(/'nonce-[A-Za-z0-9_-]+'/);
    // The whole point. With 'unsafe-inline' present the directive does
    // not stop an injected <script> at all, and FE-1 keeps the access
    // token in JS memory where any executing script can read it.
    expect(scriptSrc).not.toContain("'unsafe-inline'");
  });

  test('the nonce is per-request, not per-build', async ({ page }, testInfo) => {
    // A nonce baked at build time and reused is exactly as weak as
    // 'unsafe-inline' the moment it leaks into a cached page.
    const path = ENTRY[testInfo.project.name] ?? '/';
    const nonceOf = async (): Promise<string> => {
      const res = await page.goto(path, { waitUntil: 'commit' });
      const csp = res?.headers()['content-security-policy'] ?? '';
      return /'nonce-([A-Za-z0-9_-]+)'/.exec(csp)?.[1] ?? '';
    };
    const first = await nonceOf();
    const second = await nonceOf();
    expect(first).not.toBe('');
    expect(second).not.toBe(first);
  });
});
