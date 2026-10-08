/**
 * Auth endpoint shapes — mirrors the API's actual response bodies
 * captured in the M12 pre-flight. Identity-parameterized: the staff
 * and seller surfaces share request/response patterns; per-identity
 * differences (SellerMe.companyName/status, StoreMe.store) are encoded
 * in their own types.
 *
 * All three identities carry `roleKeys` + `roleNames` rather than one
 * role: a person holds several, and an operator can invent one, so no
 * single field could name what somebody is. `roleKey` / `roleName` are
 * the FIRST of them, a label — never the answer to what they may do,
 * which is `permissions`.
 */
import type { ImpersonationBannerContext } from './admin-impersonation';

/** Login / refresh response shape (identical for staff + seller). */
export interface AccessTokenResponse {
  readonly accessToken: string;
  readonly expiresIn: number; // seconds (5 min on the API today)
  readonly expiresAt: string; // ISO 8601
}

/** GET /auth/staff/me — staff identity (matches StaffAuthService.getMe). */
export interface StaffMe {
  readonly id: string;
  readonly email: string;
  readonly emailDisplay: string;
  /** The FIRST role held — a label. `roleKeys` is all of them. */
  readonly roleKey: string;
  readonly roleName: string;
  /** Every `staff_roles.key` held. A person may hold several. */
  readonly roleKeys: readonly string[];
  /** Their display names, same order — what a screen should show. */
  readonly roleNames: readonly string[];
  /**
   * What this person may do. The UI hides what is not in here — a
   * courtesy, not a control: FE-2 still holds and the server refuses
   * regardless of what was rendered.
   */
  readonly permissions: readonly string[];
  readonly emailVerifiedAt: string | null;
  readonly lastLoginAt: string | null;
  readonly createdAt: string;
}

/** GET /auth/seller/me — seller identity (matches SellerAuthService.SellerMe). */
export interface SellerMe {
  readonly id: string;
  /** The FIRST role held — a label. `roleKeys` is all of them. */
  readonly roleKey: string;
  readonly roleName: string;
  /** Every `seller_roles.key` held, including ones the company made. */
  readonly roleKeys: readonly string[];
  readonly roleNames: readonly string[];
  /**
   * What this person may do. The seller app hides what is not in here —
   * a courtesy, not a control: the API refuses regardless of what was
   * rendered.
   */
  readonly permissions: readonly string[];
  readonly email: string;
  readonly emailDisplay: string;
  readonly companyName: string;
  /**
   * The company's short code — "Menev Store" → "MSt". Shown as a fixed
   * prefix on recipient names, the way +91 is shown on a phone field.
   * READ-ONLY here: it is stamped on paperwork that already exists in
   * the world, so only staff may change it. Null for a seller created
   * before the column existed.
   */
  readonly initials: string | null;
  readonly contactPersonName: string;
  readonly phone: string;
  readonly whatsapp: string | null;
  readonly status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';
  readonly approvedAt: string | null;
  readonly displayCurrency: string;
  /**
   * Rupees to `displayCurrency`, so every figure in the app can be shown
   * in the money this seller thinks in. Null when they already work in
   * rupees, or when no rate could be resolved — and null means KEEP
   * SHOWING RUPEES, because a wrong rate is worse than the wrong
   * currency.
   */
  readonly displayFxRate: string | null;
  /**
   * The rate from `displayCurrency` to the OTHER currency, so every
   * figure can be shown with its equivalent beside it. Populated in
   * both directions — unlike `displayFxRate`, which is null when the
   * display currency is already the canonical one.
   */
  readonly equivalentFxRate: string | null;
  readonly displayLanguage: string;
  readonly countryCode: string;
  readonly emailVerifiedAt: string | null;
  readonly createdAt: string;
  // Phase 1B — the signed-in team member identity.
  readonly sellerUserId: string;
  readonly fullName: string;
  /**
   * Set ONLY while a staff member is inside this account on a support
   * session. Absent or null on every real seller's `/me` for ever,
   * because a real seller never has one — so the banner's condition is
   * just "is this here": nothing to get wrong, and no permission for the
   * seller app to check.
   *
   * OPTIONAL, and as of 2026-10-07 the API does not send it yet: the
   * facts exist (the exchange endpoint returns them when the handoff is
   * spent) but `/auth/seller/me` does not carry them, and a banner on
   * every page needs them on every request. A `/me` without it reads as
   * "nobody is impersonating", which is the truth for every session that
   * exists today and the safe way round for a field whose absence hides
   * a warning rather than inventing one.
   */
  readonly impersonation?: ImpersonationBannerContext | null;
}

/** A reseller store's lifecycle (RS-1). Mirrors the API's ResellerStoreStatus. */
export type ResellerStoreStatusValue =
  | 'PENDING_SELLER_APPROVAL'
  | 'ACTIVE'
  | 'PAUSED'
  | 'CLOSED'
  | 'REJECTED';

/**
 * GET /auth/store/me — a reseller store user (RS-2; matches the API's
 * StoreAuthService.StoreMe). The third identity: a person at a store that
 * resells ONE seller's stock.
 */
export interface StoreMe {
  /** StoreUser.id — the person signed in. */
  readonly id: string;
  readonly email: string;
  readonly emailDisplay: string;
  readonly fullName: string;
  readonly emailVerifiedAt: string | null;
  /** The FIRST role held — a label. `roleKeys` is all of them. */
  readonly roleKey: string;
  readonly roleName: string;
  /** Every `store_roles.key` held. */
  readonly roleKeys: readonly string[];
  readonly roleNames: readonly string[];
  /**
   * What this person may do. The reseller app hides what is not in here
   * — a courtesy, not a control (FE-2): the API refuses regardless.
   */
  readonly permissions: readonly string[];
  /**
   * ASSOC-1 — 'OWN' when this person sees only the orders and customers
   * they placed (an associate), 'ALL' for the whole store. Rendering
   * only (FE-2): the WHERE clause is what narrows the rows.
   */
  readonly orderScope: 'OWN' | 'ALL';
  /**
   * ASSOC-1 — set when the store has switched this person's order
   * creation off. Everything already placed carries on, so this gates
   * only the "place an order" surface; the API refuses it anyway with
   * `ASSOCIATE_ORDERS_PAUSED`, and this is here so the form can say so
   * before somebody fills it in.
   */
  readonly ordersPausedAt: string | null;
  readonly store: {
    readonly id: string;
    readonly name: string;
    /** What customers will see; null means `name`. */
    readonly displayName: string | null;
    readonly status: ResellerStoreStatusValue | null;
    readonly walletManagedBy: 'SELLER' | 'SKYDROP' | null;
    /** Presigned, short-lived. */
    readonly logoUrl: string | null;
    readonly contactEmail: string | null;
    readonly contactPhone: string | null;
  };
  /** The one seller this store resells for. */
  readonly seller: { readonly id: string; readonly companyName: string };
  /** The same support-session marker as `SellerMe.impersonation` — see there. */
  readonly impersonation?: ImpersonationBannerContext | null;
}

export interface LoginRequest {
  readonly email: string;
  readonly password: string;
}
