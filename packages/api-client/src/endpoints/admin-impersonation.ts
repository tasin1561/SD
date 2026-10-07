/**
 * Support impersonation — the shapes the consoles code against.
 *
 * ── READ OFF THE CONTROLLER, NOT GUESSED ────────────────────────────
 * These mirror `apps/api/src/modules/impersonation` as it stands:
 * `AdminImpersonationController` + `impersonation.dto.ts` for the admin
 * half, `ImpersonationExchangeController` for the arrival. Three things
 * about that shape are worth stating here, because every one of them is
 * a place a hand-written client would naturally get it wrong:
 *
 *  - the mode is a BOOLEAN, `mayWrite`, not an enum. There is no
 *    'READ_ONLY' string anywhere on the wire.
 *  - the list endpoints return a BARE ARRAY, not a page. `limit` caps
 *    it (200) because it is a review screen and not an export.
 *  - `Date` fields cross the wire as ISO strings, so they are typed
 *    `string` here. `expiresAt` and friends are never `Date`.
 *
 * ── THE FIVE ADMIN ROUTES ───────────────────────────────────────────
 *   POST /admin/impersonation/start      → StartImpersonationResult
 *   POST /admin/impersonation/:id/verify → VerifyImpersonationResult
 *   POST /admin/impersonation/:id/end    → ImpersonationSessionSummary
 *   GET  /admin/impersonation            → readonly Summary[]
 *   GET  /admin/impersonation/active     → readonly Summary[]
 */

/** Which kind of account a session is opened inside. */
export type ImpersonationSubjectKind = 'SELLER' | 'STORE';

/**
 * Open a session. Nothing is handed over here: the code goes to the
 * staff member's own inbox, and the session is unusable until it comes
 * back. So a request that is abandoned at the code still leaves a row,
 * which is the right way round — an abandoned attempt is a fact a
 * reviewer may want.
 */
export interface StartImpersonationRequest {
  readonly subjectKind: ImpersonationSubjectKind;
  /** `sellers.id` or `seller_stores.id`, matching `subjectKind`. */
  readonly subjectId: string;
  /**
   * WHY, in a sentence, at least `MIN_IMPERSONATION_REASON` characters
   * after trimming. The server enforces the floor; the dialog enforces
   * it too, so the refusal is not the first thing that explains the
   * rule.
   */
  readonly reason: string;
  /**
   * Ask to CHANGE things, not just look. Needs
   * `support.impersonate.write` on top of `support.impersonate`, which
   * the server checks against this field rather than the route — the
   * requirement depends on what was asked for. Omitted means look only.
   */
  readonly mayWrite?: boolean;
}

/**
 * The floor the server also applies, trimmed first so twenty spaces is
 * not a reason. A VALUE rather than a type, because the dialog counts
 * characters against it: `MIN_IMPERSONATION_REASON_LENGTH` in
 * `impersonation.dto.ts` is the same number, and the two being the same
 * is the point.
 */
export const MIN_IMPERSONATION_REASON = 20;

/** How many boxes the code field draws. `VerifyImpersonationDto` is `@Length(6, 6)`. */
export const IMPERSONATION_OTP_LENGTH = 6;

export interface StartImpersonationResult {
  readonly sessionId: string;
  /** The session deadline. It starts now and is never extended. */
  readonly expiresAt: string;
  /** So the dialog can say "check your mail" and name the address. */
  readonly otpSentTo: string;
  readonly otpExpiresAt: string;
}

export interface VerifyImpersonationRequest {
  /** The six-digit code mailed to the STAFF member, not the account holder. */
  readonly code: string;
}

/**
 * The way in: a single-use token good for sixty seconds, and the URL to
 * send the browser to. The token sits in that URL's FRAGMENT, so it
 * never reaches a server log — which is also why the console navigates
 * to `redirectUrl` as given instead of rebuilding it.
 */
export interface ImpersonationHandoff {
  readonly token: string;
  readonly expiresAt: string;
  /** `<seller|reseller app>/impersonation/handoff#token=…` */
  readonly redirectUrl: string;
}

export interface VerifyImpersonationResult {
  readonly sessionId: string;
  readonly handoff: ImpersonationHandoff;
}

/** Optional note for the review — worth filling in when closing somebody else's. */
export interface EndImpersonationRequest {
  readonly reason?: string;
}

/**
 * One session, as every admin route returns it.
 *
 * `live` is the server's own verdict (verified, not ended, not past its
 * deadline) and is what the review screen trusts rather than
 * re-deriving. The screen still watches the clock, because a row that
 * was live when it was fetched stops being live while somebody is
 * looking at it, and the only honest thing to do then is stop offering
 * to end it.
 */
export interface ImpersonationSessionSummary {
  readonly id: string;
  /** WHO: the staff member actually at the keyboard. */
  readonly staffUserId: string;
  readonly staffEmail: string;
  /** AS WHOM. */
  readonly subject: { readonly kind: ImpersonationSubjectKind; readonly id: string };
  /** The seller's company name, or the store's — already resolved. */
  readonly subjectLabel: string;
  /** WHY — verbatim, and the whole of what a reviewer will have. */
  readonly reason: string;
  readonly mayWrite: boolean;
  /** Null while the code was never answered: started, never entered. */
  readonly otpVerifiedAt: string | null;
  readonly expiresAt: string;
  readonly endedAt: string | null;
  /** The note whoever closed it left, when they left one. */
  readonly endedReason: string | null;
  readonly ipAddress: string | null;
  /** HOW MANY requests it made, and how many of them changed something. */
  readonly requestCount: number;
  readonly writeCount: number;
  /** WHEN it was opened. There is no separate `startedAt`. */
  readonly createdAt: string;
  readonly live: boolean;
}

/** Filters for `GET /admin/impersonation`. All optional; newest first. */
export interface ImpersonationSessionsQuery {
  readonly staffUserId?: string;
  readonly sellerId?: string;
  readonly storeId?: string;
  /** Capped at 200 by the server; 50 when omitted. */
  readonly limit?: number;
}

/**
 * What `POST /auth/{seller,store}/impersonation/exchange` answers with:
 * the arrival, at the seller or reseller origin, once the handoff token
 * has been spent for a session cookie.
 */
export interface ImpersonationSessionView {
  readonly sessionId: string;
  readonly subject: { readonly kind: ImpersonationSubjectKind; readonly id: string };
  readonly mayWrite: boolean;
  readonly expiresAt: string;
  readonly reason: string;
}

/** The body those two endpoints take. */
export interface ImpersonationExchangeRequest {
  readonly handoffToken: string;
}

/**
 * What the seller / reseller app needs to draw the banner.
 *
 * Deliberately NOT the review summary: the staff member inside the
 * account needs four facts and no audit figures, and the account's own
 * people must never be able to read somebody else's session off their
 * own `/me`. Attached to `SellerMe` / `StoreMe` — see the note there for
 * why its mere PRESENCE is the whole signal.
 *
 * NOTE (2026-10-07): the API does not populate this yet. The exchange
 * endpoint returns the same facts as `ImpersonationSessionView`, so the
 * data exists; what is missing is `/auth/{seller,store}/me` carrying it
 * on every subsequent request, which is what a banner on every page
 * needs. Typed optional so the console compiles and degrades to "no
 * banner" rather than to a wrong one.
 */
export interface ImpersonationBannerContext {
  readonly sessionId: string;
  readonly mayWrite: boolean;
  /** The countdown's end. The banner recomputes the remainder locally. */
  readonly expiresAt: string;
  /** Who is wearing the account — shown so the bar cannot be anonymous. */
  readonly staffEmail: string;
}
