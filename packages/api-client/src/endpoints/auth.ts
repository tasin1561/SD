/**
 * Auth endpoint shapes — mirrors the API's actual response bodies
 * captured in the M12 pre-flight. Identity-parameterized: the staff
 * and seller surfaces share request/response patterns; per-identity
 * differences (StaffMe.role vs SellerMe.companyName/status) are
 * encoded in their own types.
 */
import type { StaffRole } from '@skydrop/db';

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
  /**
   * LEGACY enum. No longer what authorisation is decided on — read
   * `permissions`. Kept because the staff list and the invite form still
   * display it.
   */
  readonly role: StaffRole;
  /** `staff_roles.key` — the role actually held, including custom ones. */
  readonly roleKey: string;
  /** Display name of that role. */
  readonly roleName: string;
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
  /** `seller_roles.key` — the role held, including ones the company made. */
  readonly roleKey: string;
  readonly roleName: string;
  /**
   * What this person may do. The seller app hides what is not in here —
   * a courtesy, not a control: the API refuses regardless of what was
   * rendered.
   */
  readonly permissions: readonly string[];
  readonly email: string;
  readonly emailDisplay: string;
  readonly companyName: string;
  readonly contactPersonName: string;
  readonly phone: string;
  readonly whatsapp: string | null;
  readonly status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';
  readonly approvedAt: string | null;
  readonly displayCurrency: string;
  readonly displayLanguage: string;
  readonly countryCode: string;
  readonly emailVerifiedAt: string | null;
  readonly createdAt: string;
  // Phase 1B — the signed-in team member identity.
  readonly sellerUserId: string;
  readonly role: 'OWNER' | 'ADMIN' | 'OPS' | 'INVENTORY' | 'FINANCE' | 'VIEWER';
  readonly fullName: string;
}

export interface LoginRequest {
  readonly email: string;
  readonly password: string;
}
