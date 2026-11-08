import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { CookieOptions, Request, Response } from 'express';

/**
 * The cookie a support session is carried in, at the seller and store
 * origins.
 *
 * ── WHY A COOKIE AND NOT THE SELLER'S OWN ACCESS TOKEN ──────────────
 * The obvious shortcut is to mint the staff member an ordinary seller
 * access token for the account they are visiting. It would work on the
 * first request and be wrong for ever afterwards: that token is
 * indistinguishable from the seller's own, so nothing downstream — the
 * guards, the audit writer, the refusal list — could tell the two apart,
 * and the row it wrote would say the seller acted alone. The separate
 * credential is what makes "a support session" a fact the server can see
 * on every request rather than a story the client tells.
 *
 * ── WHY IT CARRIES ONLY AN ID ───────────────────────────────────────
 * Nothing that decides anything travels in it: not `mayWrite`, not the
 * subject, not the staff member. All of that is read from the session row
 * per request, because every one of those facts can change under the
 * cookie — an admin ends the session, the clock passes `expiresAt` — and
 * a signed copy in the client's jar would keep answering with the state
 * at exchange time. The signature exists only so an id cannot be guessed
 * or swapped for another; it is not the authority, the row is.
 *
 * ── WHY IT IS SIGNED AT ALL, GIVEN THE ROW IS CHECKED ───────────────
 * `impersonation_sessions.id` is a uuidv7, which is not a secret: it is
 * printed in the admin review screens and travels in audit metadata.
 * Unsigned, holding one would be holding the session. The HMAC makes the
 * cookie unforgeable without the signing key, so a leaked id is just an
 * id.
 */
export const IMPERSONATION_COOKIE = '__Host-impersonation';

/**
 * `__Host-` requires Path=/, no Domain and Secure — the browser drops the
 * cookie outright if any of those is wrong. Identical to the three
 * refresh cookies next door (`auth-cookies.ts`) so the session surfaces
 * cannot drift apart in their cookie rules; it is kept here rather than
 * there because nothing outside the impersonation runtime should be
 * setting this one.
 */
const COOKIE_OPTIONS: Readonly<CookieOptions> = Object.freeze({
  httpOnly: true,
  secure: true,
  sameSite: 'strict' as const,
  path: '/',
});

/** Its own audience, so a seller, store or staff token cannot be used as one. */
const AUDIENCE = 'skydrop-impersonation';
const ISSUER = 'skydrop';

interface CookieClaims {
  /** `impersonation_sessions.id`. */
  readonly sid: string;
}

/**
 * Mint the cookie value for a session.
 *
 * It expires WITH the session rather than on a fixed TTL: a cookie that
 * outlived `expiresAt` would be refused on every request anyway, and one
 * that died first would end a session early for no reason anybody could
 * explain.
 */
export function signImpersonationCookie(input: {
  readonly signingKey: string;
  readonly sessionId: string;
  readonly expiresAt: Date;
}): string {
  const ttlSeconds = Math.max(1, Math.ceil((input.expiresAt.getTime() - Date.now()) / 1000));
  return jwt.sign({ sid: input.sessionId } satisfies CookieClaims, input.signingKey, {
    algorithm: 'HS256',
    audience: AUDIENCE,
    issuer: ISSUER,
    jwtid: randomUUID(),
    expiresIn: ttlSeconds,
  });
}

/**
 * Why a request has no usable support-session cookie. Diagnostic only:
 * these codes are written to the audit trail and the process log, never
 * to the client, and never carry any part of the token.
 */
export type ImpersonationCookieReason =
  /** `req.cookies` exists but has no `__Host-impersonation` key. */
  | 'COOKIE_ABSENT'
  /** `req.cookies` is undefined: the cookie parser did not run on this path. */
  | 'COOKIES_NOT_PARSED'
  /** The key is present but its value is empty or not a string. */
  | 'COOKIE_EMPTY'
  /** Signature does not verify under the current signing key. */
  | 'BAD_SIGNATURE'
  /** Verified shape but audience or issuer is not ours. */
  | 'AUDIENCE_OR_ISSUER_MISMATCH'
  /** Signed by us, past its `exp`. */
  | 'EXPIRED'
  /** Not a parseable JWT, or an algorithm we do not accept. */
  | 'MALFORMED_TOKEN'
  /** Verified, but the payload carries no usable `sid`. */
  | 'NO_SESSION_ID';

export type ImpersonationCookieInspection =
  | { readonly ok: true; readonly sessionId: string }
  | { readonly ok: false; readonly reason: ImpersonationCookieReason };

/**
 * Same decision as `readImpersonationCookie`, with the reason kept.
 * The reason is derived from the error CLASS/message category only; the
 * token text is never copied into the result.
 */
export function inspectImpersonationCookie(input: {
  readonly signingKey: string;
  readonly req: Request;
}): ImpersonationCookieInspection {
  const cookies = (input.req as unknown as { cookies?: Record<string, unknown> }).cookies;
  if (cookies === undefined || cookies === null) return { ok: false, reason: 'COOKIES_NOT_PARSED' };
  if (!(IMPERSONATION_COOKIE in cookies)) return { ok: false, reason: 'COOKIE_ABSENT' };
  const raw = cookies[IMPERSONATION_COOKIE];
  if (typeof raw !== 'string' || raw.length === 0) return { ok: false, reason: 'COOKIE_EMPTY' };
  try {
    const decoded = jwt.verify(raw, input.signingKey, {
      algorithms: ['HS256'],
      audience: AUDIENCE,
      issuer: ISSUER,
    });
    if (typeof decoded === 'string') return { ok: false, reason: 'NO_SESSION_ID' };
    const sid = (decoded as Partial<CookieClaims>).sid;
    return typeof sid === 'string' && sid.length > 0
      ? { ok: true, sessionId: sid }
      : { ok: false, reason: 'NO_SESSION_ID' };
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) return { ok: false, reason: 'EXPIRED' };
    const message = err instanceof Error ? err.message : '';
    if (message === 'invalid signature') return { ok: false, reason: 'BAD_SIGNATURE' };
    if (message.startsWith('jwt audience invalid') || message.startsWith('jwt issuer invalid')) {
      return { ok: false, reason: 'AUDIENCE_OR_ISSUER_MISMATCH' };
    }
    return { ok: false, reason: 'MALFORMED_TOKEN' };
  }
}

/**
 * The session id this cookie names, or null if it is not ours.
 *
 * Returns null rather than throwing for every rejection — a bad
 * signature, a wrong audience and a stale cookie are all "there is no
 * support session here", and the caller treats that as an ordinary
 * request. A cookie this host did not sign must never become an error
 * the client can distinguish from any other.
 */
export function readImpersonationCookie(input: {
  readonly signingKey: string;
  readonly req: Request;
}): string | null {
  const r = inspectImpersonationCookie(input);
  return r.ok ? r.sessionId : null;
}

export function setImpersonationCookie(res: Response, value: string, expiresAt: Date): void {
  res.cookie(IMPERSONATION_COOKIE, value, {
    ...COOKIE_OPTIONS,
    expires: expiresAt,
    maxAge: Math.max(0, expiresAt.getTime() - Date.now()),
  });
}

export function clearImpersonationCookie(res: Response): void {
  res.clearCookie(IMPERSONATION_COOKIE, COOKIE_OPTIONS);
}
