/**
 * Seller profile + bank details. Both endpoints (PATCH /seller/profile,
 * PATCH /seller/profile/bank-details) live in the seller-profile
 * module on the API side. Bank details capture in Phase 1A is shape-
 * only — KYC + remittance live in Phase 1B's wallet/remittance flow.
 */

import type { SellerStatusValue } from './admin-sellers';

export interface OnboardingProgressView {
  readonly emailVerified: boolean;
  readonly bankDetailsCaptured: boolean;
}

/** PENDING or REJECTED only — an APPROVED change is simply the live account. */
export type SellerBankChangeStatus = 'PENDING' | 'REJECTED';

export interface SellerBankChangeProposedView {
  readonly bankName: string;
  readonly bankBranchName: string;
  readonly bankAccountName: string;
  /** MASKED — last four digits. The real number is never returned. */
  readonly bankAccountNumber: string;
  readonly bankRoutingNumber: string;
  readonly bankSwiftCode: string;
}

/**
 * A change of payable account the seller has asked for.
 *
 * Present while it is PENDING, so the seller knows the details are not
 * live and payouts still go to the old account; and while it is the most
 * recent REJECTED one, so they read the admin's reason instead of
 * resubmitting the same thing.
 */
export interface SellerBankChangeView {
  readonly id: string;
  readonly status: SellerBankChangeStatus;
  readonly submittedAt: string;
  readonly decidedAt: string | null;
  readonly decisionReason: string | null;
  readonly proposed: SellerBankChangeProposedView;
}

export interface SellerProfileView {
  readonly id: string;
  readonly email: string;
  readonly emailDisplay: string;
  readonly companyName: string;
  readonly contactPersonName: string;
  readonly phone: string;
  readonly whatsapp: string | null;
  readonly status: SellerStatusValue;
  readonly approvedAt: string | null;
  readonly displayCurrency: 'INR' | 'BDT';
  readonly displayLanguage: string;
  readonly countryCode: string;
  readonly emailVerifiedAt: string | null;
  readonly bankName: string | null;
  readonly bankBranchName: string | null;
  readonly bankAccountName: string | null;
  readonly bankAccountNumber: string | null;
  readonly bankRoutingNumber: string | null;
  readonly bankSwiftCode: string | null;
  readonly logoUrl: string | null;
  readonly logoMimeType: string | null;
  readonly createdAt: string;
  readonly onboarding: OnboardingProgressView;
  readonly latestBankChange: SellerBankChangeView | null;
}

export interface UpdateSellerProfileRequest {
  readonly companyName?: string;
  readonly contactPersonName?: string;
  readonly phone?: string;
  readonly whatsapp?: string | null;
  readonly displayLanguage?: 'en' | 'bn';
  readonly displayCurrency?: 'INR' | 'BDT';
}

/**
 * A PATCH: omit a field to leave it alone, pass null to clear it. The
 * six bank fields are ALL-OR-NOTHING on the server — a patch that would
 * leave the stored row partially filled is refused with
 * `BANK_DETAILS_INCOMPLETE`, naming the fields still needed.
 */
export interface UpdateSellerBankDetailsRequest {
  readonly bankName?: string | null;
  readonly bankBranchName?: string | null;
  readonly bankAccountName?: string | null;
  readonly bankAccountNumber?: string | null;
  readonly bankRoutingNumber?: string | null;
  readonly bankSwiftCode?: string | null;
}

export interface PresignLogoRequest {
  readonly mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
}
export interface PresignLogoResponse {
  readonly storageKey: string;
  readonly uploadUrl: string;
  readonly expiresInSeconds: number;
  readonly maxSizeBytes: number;
}
export interface RegisterLogoRequest {
  readonly storageKey: string;
  readonly mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
}
export interface LogoView {
  readonly logoUrl: string | null;
  readonly logoMimeType: string | null;
}
