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
  readonly bankAccountName: string | null;
  readonly bankAccountNumber: string | null;
  readonly bankRoutingNumber: string | null;
  readonly bankSwiftCode: string | null;
  readonly createdAt: string;
  readonly onboarding: OnboardingProgressView;
}

export interface UpdateSellerProfileRequest {
  readonly companyName?: string;
  readonly contactPersonName?: string;
  readonly phone?: string;
  readonly whatsapp?: string | null;
  readonly displayLanguage?: 'en' | 'bn';
  readonly displayCurrency?: 'INR' | 'BDT';
}

export interface UpdateSellerBankDetailsRequest {
  readonly bankName?: string | null;
  readonly bankAccountName?: string | null;
  readonly bankAccountNumber?: string | null;
  readonly bankRoutingNumber?: string | null;
  readonly bankSwiftCode?: string | null;
}
