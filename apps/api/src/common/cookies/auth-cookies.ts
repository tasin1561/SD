import type { CookieOptions, Response } from 'express';

export const STAFF_REFRESH_COOKIE = '__Host-staffRefresh';
export const SELLER_REFRESH_COOKIE = '__Host-sellerRefresh';

/**
 * Per the spec: __Host- cookies REQUIRE Path=/, no Domain, Secure=true,
 * SameSite=Strict. The browser rejects the cookie if any of these is wrong.
 * Most browsers exempt http://localhost from the Secure rule, so this works
 * unchanged in dev as long as the API is reached on localhost.
 */
const REFRESH_COOKIE_OPTIONS: Readonly<CookieOptions> = Object.freeze({
  httpOnly: true,
  secure: true,
  sameSite: 'strict' as const,
  path: '/',
});

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export function setStaffRefreshCookie(res: Response, plaintext: string, expiresAt: Date): void {
  res.cookie(STAFF_REFRESH_COOKIE, plaintext, {
    ...REFRESH_COOKIE_OPTIONS,
    expires: expiresAt,
    maxAge: Math.min(SEVEN_DAYS_MS, Math.max(0, expiresAt.getTime() - Date.now())),
  });
}

export function setSellerRefreshCookie(res: Response, plaintext: string, expiresAt: Date): void {
  res.cookie(SELLER_REFRESH_COOKIE, plaintext, {
    ...REFRESH_COOKIE_OPTIONS,
    expires: expiresAt,
    maxAge: Math.min(SEVEN_DAYS_MS, Math.max(0, expiresAt.getTime() - Date.now())),
  });
}

export function clearStaffRefreshCookie(res: Response): void {
  res.clearCookie(STAFF_REFRESH_COOKIE, REFRESH_COOKIE_OPTIONS);
}

export function clearSellerRefreshCookie(res: Response): void {
  res.clearCookie(SELLER_REFRESH_COOKIE, REFRESH_COOKIE_OPTIONS);
}
