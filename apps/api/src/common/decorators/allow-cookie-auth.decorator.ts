import { SetMetadata } from '@nestjs/common';

export const ALLOW_COOKIE_AUTH_KEY = 'auth:allow-refresh-cookie';

/**
 * Let this route authenticate with the `__Host-*Refresh` cookie when no
 * Bearer token is present.
 *
 * ── THE ONE CASE THIS EXISTS FOR: BROWSER NAVIGATION ─────────────────
 * The access token lives in JS memory and nowhere else (FE-1), and the
 * ApiClient attaches it as a header. That works for every `fetch` and
 * for nothing else — a plain `<a href>`, a `window.open`, a form POST
 * and a right-click "save link as" are NAVIGATIONS: the browser sends
 * cookies and never an Authorization header. So a download link is
 * permanently unauthenticated unless the route can read the cookie.
 *
 * Read-only, always. The cookie is validated with
 * `RefreshTokenService.validateByPlaintext`, NEVER `rotate()` — FE-4:
 * rotating here would race the client's silent refresh and burn a
 * legitimate session through the reuse-detection family-burn.
 *
 * Put it ONLY on routes a browser navigates to and that read. A
 * mutating endpoint reachable by navigation is a CSRF target: the
 * cookie is SameSite=Strict, which is the reason this is merely
 * unwise rather than a hole, but the rule is not worth testing.
 */
export const AllowCookieAuth = (): MethodDecorator & ClassDecorator =>
  SetMetadata(ALLOW_COOKIE_AUTH_KEY, true);
