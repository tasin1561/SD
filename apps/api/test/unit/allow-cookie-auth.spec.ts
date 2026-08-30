import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(__dirname, '../../src');
const read = (rel: string): string => readFileSync(join(SRC, rel), 'utf8');

/**
 * A browser NAVIGATION cannot authenticate with a Bearer token.
 *
 * The access token lives in JS memory (FE-1) and the ApiClient sends it
 * as a header — which works for `fetch` and for nothing else. A plain
 * `<a href>`, a window.open or a "save link as" is a navigation: the
 * browser sends cookies only. A download route that forgets this is
 * permanently unauthenticated, which is exactly how the invoice link
 * failed after being "permanently" fixed.
 */
describe('@AllowCookieAuth — the download-shaped auth path', () => {
  const guard = read('common/guards/seller-jwt.guard.ts');

  it('falls back to the cookie ONLY when the route opts in', () => {
    // Never a blanket fallback: every other route stays bearer-only, so
    // opting in is a visible decision on the one route that needs it.
    expect(guard).toContain('ALLOW_COOKIE_AUTH_KEY');
    expect(guard).toMatch(/allowsCookie === true \? readSellerRefreshCookie/);
  });

  it('validates READ-ONLY and never rotates', () => {
    // FE-4: rotating here would race the client's silent refresh and
    // burn a legitimate session through the reuse-detection family-burn.
    expect(guard).toContain('validateByPlaintext');
    expect(guard).not.toMatch(/refreshTokens\.rotate\(/);
  });

  it('both paths fall through to the SAME status and RBAC checks', () => {
    // The point of extending the guard rather than writing a second
    // one: a new way in must not be a way past the suspended-seller
    // gate or the role policy.
    const afterAuth = guard.slice(guard.indexOf('const claims'));
    expect(afterAuth).toContain('sellerUser.findFirst');
  });

  it('the invoice PDF route is the one that opts in', () => {
    const ctrl = read('modules/invoice/seller-invoice.controller.ts');
    const pdf = ctrl.slice(ctrl.indexOf("@Get('pdf')"));
    expect(pdf.slice(0, 600)).toContain('@AllowCookieAuth()');
  });
});
