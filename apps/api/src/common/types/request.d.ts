import type { SellerUserRole, StaffRole } from '@skydrop/db';

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
      staff?: AuthenticatedStaff;
      seller?: AuthenticatedSeller;
      apiKey?: AuthenticatedApiKey;
    }
  }
}

export interface AuthenticatedStaff {
  id: string;
  email: string;
  /**
   * LEGACY, and no longer consulted for authorisation — the permission
   * guard is. Kept only because `staff_users.role` and
   * `staff_invitations.role` still carry it; both go when a staff member
   * is invited against a role ROW rather than an enum value.
   */
  role: StaffRole;
  /** `staff_roles.key` — the role the person actually holds. */
  roleKey: string;
  /** `staff_roles.name` — for display and audit prose. */
  roleName: string;
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
   * for back-compat. Per-user attribution uses `userId` + `role` below.
   */
  id: string;
  email: string;
  status: string;
  emailVerifiedAt: Date | null;
  jti: string;
  /** SellerUser.id — the person who authenticated. */
  userId: string;
  /** LEGACY enum. No longer consulted for authorisation. */
  role: SellerUserRole;
  /** `seller_roles.key` — the role actually held, including custom ones. */
  roleKey: string;
  roleName: string;
  /** Effective permission keys, resolved per request from the role. */
  permissions: readonly string[];
  /** SellerUser.fullName — for audit + UI display. */
  fullName: string;
}

export interface AuthenticatedApiKey {
  id: string;
  sellerId: string;
  keyPrefix: string;
}

export {};
