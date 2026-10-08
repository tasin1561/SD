declare global {
  namespace Express {
    interface Request {
      requestId?: string;
      staff?: AuthenticatedStaff;
      seller?: AuthenticatedSeller;
      /** RS-2 — set by StoreJwtGuard. */
      storeUser?: AuthenticatedStoreUser;
      apiKey?: AuthenticatedApiKey;
      /** RS-5 — set by StoreApiKeyGuard. */
      storeApiKey?: AuthenticatedStoreApiKey;
      /**
       * The refusal to throw for the impersonation cookie on this
       * request — set by ImpersonationAlsMiddleware, rethrown by
       * ImpersonationGuard. An `HttpException`, typed loosely here
       * because a global .d.ts should not pull Nest into every file that
       * sees an express Request.
       *
       * It is carried rather than thrown where it is found because
       * express middleware sits OUTSIDE Nest's exception filter, and a
       * 401 from there would reach the client as an HTML error page
       * instead of the `{code, message}` body every other refusal uses.
       * The exception OBJECT travels, not a copy of its words, so the
       * session service's own codes and sentences arrive unaltered.
       *
       * Note what is NOT here: the impersonation context itself. That
       * lives in AsyncLocalStorage (`currentImpersonation()`) so the
       * audit writer can read it without ~200 call sites passing it, and
       * a second copy on the request is how the two would come to
       * disagree about whether anybody was impersonating.
       */
      impersonationRejection?: unknown;
    }
  }
}

/**
 * RS-5 — a reseller store's machine key, resolved per request by
 * StoreApiKeyGuard. `storeId` is the ONLY store it may act on; it never
 * reaches the seller's account.
 */
export interface AuthenticatedStoreApiKey {
  id: string;
  storeId: string;
  sellerId: string;
  keyPrefix: string;
}

export interface AuthenticatedStaff {
  id: string;
  email: string;
  /**
   * The FIRST of the roles this person holds — a label for display and
   * audit prose, NEVER an authorisation input. Somebody may hold
   * several (a job function and an access tier, say); `roleKeys` is all
   * of them and `permissions` is what they grant between them.
   */
  roleKey: string;
  /** `staff_roles.name` of the same first role. */
  roleName: string;
  /** Every `staff_roles.key` this person holds, live ones only. */
  roleKeys: readonly string[];
  /** Every `staff_roles.name`, same order as `roleKeys`. */
  roleNames: readonly string[];
  /**
   * Effective permission keys, resolved per request from the role's
   * grants. A super-admin role carries the whole catalogue, so a
   * permission added next month reaches it with no backfill.
   *
   * Resolved server-side rather than carried in the JWT ON PURPOSE: a
   * token minted before an admin edited a role would keep the old
   * permissions until it expired, so revoking access would not take
   * effect. The cost is a cached lookup the guard was already making.
   */
  permissions: readonly string[];
  emailVerifiedAt: Date | null;
  jti: string;
}

export interface AuthenticatedSeller {
  /**
   * Seller.id — the company. Existing controllers were written when one
   * seller account had one user, so this id is kept as the COMPANY id
   * for back-compat. Per-user attribution uses `userId` + the role
   * labels below.
   */
  id: string;
  email: string;
  status: string;
  emailVerifiedAt: Date | null;
  /**
   * The ACCESS token's id — null when the request authenticated with
   * the refresh cookie instead, which a browser NAVIGATION must do
   * because it cannot send a header (see @AllowCookieAuth). Nothing
   * downstream requires it; it is attribution, not authority.
   */
  jti: string | null;
  /** SellerUser.id — the person who authenticated. */
  userId: string;
  /**
   * The FIRST role held — a label, never an authorisation input. See
   * `roleKeys` for all of them.
   */
  roleKey: string;
  roleName: string;
  /** Every `seller_roles.key` held, live ones only. */
  roleKeys: readonly string[];
  roleNames: readonly string[];
  /**
   * Effective permission keys — the UNION of every role held. An OWNER
   * role among them grants the whole catalogue.
   */
  permissions: readonly string[];
  /** SellerUser.fullName — for audit + UI display. */
  fullName: string;
}

/**
 * RS-2 — a reseller store user, resolved per request by StoreJwtGuard.
 *
 * `storeId` is the ONLY store this person may act on, and every store
 * endpoint scopes by it in the WHERE clause. `sellerId` is carried for
 * audit attribution, never as authority over the seller's account.
 */
export interface AuthenticatedStoreUser {
  /** StoreUser.id — the person who authenticated. */
  id: string;
  storeId: string;
  sellerId: string;
  email: string;
  fullName: string;
  emailVerifiedAt: Date | null;
  jti: string | null;
  /** The FIRST role held — a label, never an authorisation input. */
  roleKey: string;
  roleName: string;
  /** Every `store_roles.key` held, live ones only. */
  roleKeys: readonly string[];
  roleNames: readonly string[];
  /** The UNION of every role held. */
  permissions: readonly string[];
  /**
   * ASSOC-1 — 'OWN' narrows every order and customer read to the rows
   * this person placed; 'ALL' is the whole store, which is what every
   * role meant before associates existed. Resolved by `storeOrderScope`,
   * applied in the WHERE clause, never compared to a role key.
   */
  orderScope: 'OWN' | 'ALL';
  /**
   * ASSOC-1 — set when the store has switched this person's order
   * creation off. Everything already placed carries on and they keep
   * reading and tracking it; only placing a NEW order is refused.
   */
  ordersPausedAt: Date | null;
}

export interface AuthenticatedApiKey {
  id: string;
  sellerId: string;
  keyPrefix: string;
}

export {};
